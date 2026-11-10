// Watson(담임 업무) 데스크톱(Windows exe) 진입점.
// 화면은 dist(웹 빌드)를 app://local 주소로 보여 주고, 백업 폴더 읽기·쓰기만 Node로 처리한다.
const { app, BrowserWindow, Menu, protocol, net, ipcMain, dialog, powerMonitor, shell, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const os = require('node:os')
const { pickUserDataDir } = require('./paths.cjs')

// 이름을 Watson으로 바꿔도 옛 자료 폴더(담임업무)를 그대로 쓴다. ready 전에 정해야 한다.
app.setPath('userData', pickUserDataDir(app.getPath('appData'), fsSync.existsSync))

const BUILT_DIST = path.join(__dirname, '..', 'dist')
// ---- 자동 업데이트 ----
// 화면(dist)만 GitHub에서 받아 바꾼다. exe(이 파일·preload)가 바뀌는 업데이트는 SHELL 번호를 올리고 새 exe를 받아야 한다.
const SHELL = 5
const UPDATE_URL = (!app.isPackaged && process.env.DAMIM_UPDATE_URL) || 'https://raw.githubusercontent.com/virtue5977-cyber/class-manager/updates/update.json'
const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjiLbLA7jnUY/fIBXaBuyVwSPkFupzLAVU4WXXGemyQs=
-----END PUBLIC KEY-----`
const UPDATES_DIR = () => path.join(app.getPath('userData'), 'app-updates')
const newer = (a, b) => {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}
/** 받아 둔 화면 중 exe 버전보다 새 것이 있으면 그것을, 없으면 exe에 든 화면을 쓴다. */
function pickDist() {
  try {
    const cur = JSON.parse(fsSync.readFileSync(path.join(UPDATES_DIR(), 'current.json'), 'utf8'))
    const dir = path.join(UPDATES_DIR(), cur.dir)
    if (cur.shell <= SHELL && newer(cur.version, app.getVersion()) && fsSync.existsSync(path.join(dir, 'index.html'))) return { dist: dir, version: cur.version }
  } catch {
    /* 받은 업데이트 없음 */
  }
  return { dist: BUILT_DIST, version: app.getVersion() }
}
let DIST = BUILT_DIST
let RUNNING_VERSION = app.getVersion()
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

if (!app.requestSingleInstanceLock()) app.quit()

let win
// 화면이 부를 수 있는 바깥 주소는 AI와 NEIS뿐이다.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.anthropic.com https://open.neis.go.kr https://raw.githubusercontent.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Watson',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  })
  win.setMenuBarVisibility(false)
  win.loadURL('app://local/index.html')
  // 바깥 링크는 기본 브라우저로 연다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  const picked = pickDist()
  DIST = picked.dist
  RUNNING_VERSION = picked.version
  // 메뉴를 아예 없애 새로고침(Ctrl+R)·개발자 도구 단축키를 막는다(PIN 우회 방지).
  Menu.setApplicationMenu(null)
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url)
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)))
    if (!file.startsWith(DIST + path.sep) || !fsSync.existsSync(file)) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString())
    if (!file.endsWith('.html')) return res
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', CSP)
    return new Response(res.body, { status: res.status, headers })
  })
  createWindow()
  const lock = () => win && win.webContents.send('app-lock')
  powerMonitor.on('resume', lock)
  powerMonitor.on('lock-screen', lock)
  setTimeout(() => checkForUpdate().catch(() => {}), 8000)
})

let updateState = { status: 'idle' }
function sendUpdate(state) {
  updateState = state
  if (win) win.webContents.send('update:state', state)
}
async function checkForUpdate() {
  sendUpdate({ status: 'checking', current: RUNNING_VERSION })
  const { fetchCapped } = require('./fetchcap.cjs')
  const info = JSON.parse((await fetchCapped((u, i) => net.fetch(u, i), UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' }, { timeoutMs: 20000, maxBytes: 1024 * 1024 })).toString('utf8'))
  if (!newer(info.version, RUNNING_VERSION)) return sendUpdate({ status: 'latest', current: RUNNING_VERSION })
  if (info.shell > SHELL) return sendUpdate({ status: 'need-exe', current: RUNNING_VERSION, version: info.version, note: info.note || '' })
  const bundleUrl = new URL(info.bundle, UPDATE_URL).toString()
  const bytes = await fetchCapped((u, i) => net.fetch(u, i), bundleUrl, { cache: 'no-store' }, { timeoutMs: 180000, maxBytes: 60 * 1024 * 1024 })
  const crypto = require('node:crypto')
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')
  const signed = `${info.version}\n${info.shell}\n${sha}`
  // 서명이 맞지 않으면(위조·손상) 절대 적용하지 않는다.
  if (sha !== info.sha256 || !crypto.verify(null, Buffer.from(signed), UPDATE_PUBLIC_KEY, Buffer.from(info.sig, 'base64'))) {
    return sendUpdate({ status: 'error', current: RUNNING_VERSION, message: '업데이트 파일 확인(서명)에 실패해 적용하지 않았습니다.' })
  }
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const dirName = `v${info.version}-${Date.now()}`
  const target = path.join(UPDATES_DIR(), dirName)
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const out = path.normalize(path.join(target, name))
    if (!out.startsWith(target + path.sep)) continue
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, await entry.async('nodebuffer'))
  }
  if (!fsSync.existsSync(path.join(target, 'index.html'))) throw new Error('bundle without index.html')
  await fs.writeFile(path.join(UPDATES_DIR(), 'current.json'), JSON.stringify({ version: info.version, shell: info.shell, dir: dirName }))
  // 예전에 받은 폴더 정리(지금 쓰는 것과 새것만 남김)
  for (const d of await fs.readdir(UPDATES_DIR())) {
    const full = path.join(UPDATES_DIR(), d)
    if (d !== dirName && d !== 'current.json' && full !== DIST) await fs.rm(full, { recursive: true, force: true }).catch(() => {})
  }
  sendUpdate({ status: 'ready', current: RUNNING_VERSION, version: info.version, note: info.note || '' })
}
app.on('window-all-closed', () => app.quit())

// ---- 백업 폴더(사용자가 고른 실제 폴더) ----
// 폴더 경로는 메인 프로세스가 기억하고, 화면은 파일 이름만 넘긴다(화면이 다른 폴더를 지정할 수 없게).
const FOLDER_FILE = () => path.join(app.getPath('userData'), 'backup-folder.json')
let folder = null
function loadFolder() {
  try {
    folder = JSON.parse(fsSync.readFileSync(FOLDER_FILE(), 'utf8')).dir || null
  } catch {
    folder = null
  }
}
app.whenReady().then(loadFolder)
const safeName = (name) => {
  if (typeof name !== 'string' || !/^[^\\/:*?"<>|]+$/.test(name) || name.includes('..')) throw new Error('잘못된 파일 이름입니다.')
  return name
}
const fromApp = (e) => {
  if (!e.senderFrame || !e.senderFrame.url.startsWith('app://')) throw new Error('허용되지 않은 호출입니다.')
}
const dirOrThrow = () => {
  if (!folder) throw new Error('백업 폴더를 먼저 고르세요.')
  return folder
}
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...args) => {
  fromApp(e)
  return fn(...args)
})
handle('backup:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: '백업 폴더 고르기', properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  folder = r.filePaths[0]
  await fs.writeFile(FOLDER_FILE(), JSON.stringify({ dir: folder }))
  return folder
})
handle('backup:current', async () => {
  if (!folder) return null
  try {
    return (await fs.stat(folder)).isDirectory() ? folder : { missing: folder }
  } catch {
    return { missing: folder }
  }
})
handle('backup:write', async (name, bytes) => {
  await fs.writeFile(path.join(dirOrThrow(), safeName(name)), Buffer.from(bytes))
})
handle('backup:read', async (name) => new Uint8Array(await fs.readFile(path.join(dirOrThrow(), safeName(name)))))
handle('backup:list', async () => (await fs.readdir(dirOrThrow(), { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name))
handle('backup:delete', async (name) => {
  await fs.unlink(path.join(dirOrThrow(), safeName(name)))
})

// ---- AI: 노트북에 설치·로그인된 Claude Code에 맡기기(Pro 구독의 프로그램용 크레딧 사용) ----
// 지시문·메모는 표준 입력으로만 넘기고, 빈 작업 폴더에서 도구 없이 한 번만 답하게 한다.
const AI_DIR = () => path.join(os.tmpdir(), 'damim-ai')
/** 시간 초과 때: Windows에서는 셸(cmd.exe)만 끝내면 그 아래 node·claude·agy가 학생 글을 든 채 남으므로 프로세스 나무째 끝낸다. */
function killTree(child) {
  const k = require('./agy.cjs').killCommand(process.platform, child.pid)
  if (!k) return child.kill()
  try {
    require('node:child_process').execFileSync(k[0], k[1], { windowsHide: true, stdio: 'ignore' })
  } catch {
    child.kill()
  }
}
function runClaude(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    fsSync.mkdirSync(AI_DIR(), { recursive: true })
    const child = spawn('claude', args, { cwd: AI_DIR(), shell: process.platform === 'win32', windowsHide: true, env: process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      killTree(child)
      reject(new Error('Claude Code 응답이 너무 늦습니다. 잠시 뒤 다시 시도하세요.'))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Claude Code를 찾지 못했습니다. 노트북에 Claude Code를 설치하고 로그인했는지 확인하세요.'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(/login|auth|log in/i.test(err + out) ? 'Claude Code에 로그인되어 있지 않습니다. 명령 창에서 claude 를 한 번 실행해 로그인하세요.' : 'Claude Code 실행 중 오류가 났습니다. Pro 사용 한도를 확인하세요.'))
    })
    if (input !== null) child.stdin.end(input, 'utf8')
    else child.stdin.end()
  })
}
handle('ai:status', async () => {
  try {
    const v = await runClaude(['--version'], null, 20000)
    return { installed: true, version: v.trim().split(/\s+/)[0] }
  } catch {
    return { installed: false }
  }
})
handle('ai:ask', async (req) => {
  const system = String(req && req.system || '')
  const user = String(req && req.user || '')
  const prompt = `${system}\n\n# 입력\n${user}\n\n위 지시와 출력 형식만 따르고, 도구를 쓰거나 다른 설명을 붙이지 마세요.`
  const raw = await runClaude(require('./agy.cjs').claudeAskArgs(process.platform), prompt, 180000)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error('Claude Code 응답을 읽지 못했습니다.')
  }
  if (body.is_error) throw new Error('Claude Code가 오류를 돌려주었습니다. 사용량 한도를 확인하세요.')
  return String(body.result || '')
})

// ---- AI: Antigravity CLI(agy, 구글 계정 로그인) ----
// 프롬프트는 인자로만 받으므로 셸을 거치지 않고 부른다(.cmd면 cmd.exe 규칙대로 인용).
const agyLib = require('./agy.cjs')
function findAgy() {
  if (process.platform !== 'win32') return { file: 'agy', viaCmd: false }
  try {
    return agyLib.pickAgyPath(require('node:child_process').execFileSync('where', ['agy'], { encoding: 'utf8', windowsHide: true, cwd: (fsSync.mkdirSync(AI_DIR(), { recursive: true }), AI_DIR()) }))
  } catch {
    return null
  }
}
function runAgy(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const found = findAgy()
    if (!found) return reject(new Error('Antigravity CLI(agy)를 찾지 못했습니다. 설치 후 명령 창에서 agy 를 한 번 실행해 로그인하세요.'))
    fsSync.mkdirSync(AI_DIR(), { recursive: true })
    const line = agyLib.cmdLine(found.file, args)
    // cmd.exe 한 줄은 8,191자까지라 그보다 길면 나눠 달라고 한다.
    if (found.viaCmd && line.length > 8000) return reject(new Error('AI에 보낼 글이 너무 깁니다. 내용을 나눠서 정리하세요.'))
    const child = found.viaCmd
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { cwd: AI_DIR(), windowsHide: true, windowsVerbatimArguments: true, env: process.env })
      : spawn(found.file, args, { cwd: AI_DIR(), windowsHide: true, env: process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      killTree(child)
      reject(new Error('Antigravity 응답이 너무 늦습니다. 잠시 뒤 다시 시도하세요.'))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Antigravity CLI(agy)를 실행하지 못했습니다.'))
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve({ out, err })
    })
    child.stdin.end()
  })
}
handle('ai:agy:status', async () => {
  try {
    const { out } = await runAgy(['--version'], 20000)
    if (!out.trim()) return { installed: false }
    // 버전만으로는 로그인 여부를 모르므로 아주 짧은 시험 질문을 한 번 보낸다(학생 자료 없음).
    let probe
    try {
      const r = await runAgy(agyLib.agyArgs(agyLib.PROBE_PROMPT), 45000)
      probe = agyLib.parseAgyOutput(r.out || r.err)
    } catch (e) {
      probe = { error: e instanceof Error ? e.message : String(e) }
    }
    return agyLib.statusFrom(out, probe)
  } catch {
    return { installed: false }
  }
})
handle('ai:agy:ask', async (prompt) => {
  const { out, err } = await runAgy(agyLib.agyArgs(String(prompt || '')), 60000)
  const r = agyLib.parseAgyOutput(out || err)
  if (r.error) throw new Error(r.error)
  return r.text
})

// ---- PDF: 지금 화면을 A4 PDF로 저장(인쇄용 CSS 적용) ----
const foldersLib = require('./folders.cjs')
handle('pdf:save', async (name, opts) => {
  const base = String(name || 'Watson.pdf').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
  const r = await dialog.showSaveDialog(win, { title: 'PDF로 저장', defaultPath: path.join(app.getPath('documents'), base.endsWith('.pdf') ? base : base + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (r.canceled || !r.filePath) return false
  const data = await win.webContents.printToPDF({ pageSize: foldersLib.pdfPageSize(opts), printBackground: true, margins: { marginType: 'default' } })
  await fs.writeFile(r.filePath, data)
  return true
})

// ---- 노트 폴더 연결: 고른 폴더 경로만 기억(복사 안 함), 열기는 디렉터리만 ----
handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: '노트에 연결할 폴더', properties: ['openDirectory'] })
  return r.canceled || !r.filePaths[0] ? null : { path: r.filePaths[0] }
})
handle('folder:open', async (p) => {
  const dir = await foldersLib.assertDir(p)
  const err = await shell.openPath(dir)
  if (err) throw new Error('폴더를 열지 못했습니다.')
})
handle('folder:list', async (p) => foldersLib.listDir(p))

handle('update:get', async () => ({ ...updateState, current: RUNNING_VERSION }))
handle('update:check', async () => {
  try {
    await checkForUpdate()
  } catch {
    sendUpdate({ status: 'error', current: RUNNING_VERSION, message: '업데이트를 확인하지 못했습니다. 인터넷 연결을 확인하세요.' })
  }
  return updateState
})
handle('update:restart', async () => {
  app.relaunch()
  app.exit(0)
})

// ---- 구글 캘린더: 로그인(시스템 브라우저 + 127.0.0.1 되돌아오기 + PKCE)과 API 호출 ----
// 토큰은 메인 프로세스만 가지고 Windows 암호화(safeStorage)로 저장한다. 화면은 API 결과만 받는다.
const http = require('node:http')
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']
const G_CLIENT = () => path.join(app.getPath('userData'), 'google-client.json')
const G_TOKEN = () => path.join(app.getPath('userData'), 'google-token.bin')
const readClient = () => {
  try {
    return JSON.parse(fsSync.readFileSync(G_CLIENT(), 'utf8'))
  } catch {
    return null
  }
}
const readRefresh = () => {
  try {
    const b = fsSync.readFileSync(G_TOKEN())
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')
  } catch {
    return null
  }
}
const writeRefresh = (t) => fsSync.writeFileSync(G_TOKEN(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8'))
let gAccess = null // { token, until }

async function tokenRequest(params) {
  const c = readClient()
  if (!c) throw new Error('구글 연결 파일을 먼저 올리세요.')
  let res
  try {
    res = await net.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, ...params }).toString(),
    })
  } catch {
    throw new Error('구글에 연결하지 못했습니다. 인터넷 연결을 확인하세요.')
  }
  const body = await res.json()
  if (!res.ok) throw new Error(body.error === 'invalid_grant' ? '구글 로그인이 만료되었습니다. 다시 로그인하세요.' : '구글 인증에 실패했습니다.')
  return body
}
async function accessToken() {
  if (gAccess && gAccess.until > Date.now() + 60000) return gAccess.token
  const refresh = readRefresh()
  if (!refresh) throw new Error('구글에 로그인되어 있지 않습니다.')
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
  gAccess = { token: t.access_token, until: Date.now() + (t.expires_in || 3600) * 1000 }
  return gAccess.token
}

handle('google:status', async () => ({ client: !!readClient(), loggedIn: !!readRefresh() }))
handle('google:setClient', async (jsonText) => {
  let j
  try {
    j = JSON.parse(String(jsonText))
  } catch {
    throw new Error('구글에서 받은 JSON 파일이 아닙니다.')
  }
  const c = j.installed || j.web
  if (!c || !c.client_id || !c.client_secret) throw new Error('"데스크톱 앱" 클라이언트의 JSON 파일을 올리세요.')
  if (!j.installed) throw new Error('클라이언트 유형이 "데스크톱 앱"이어야 합니다.')
  await fs.writeFile(G_CLIENT(), JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret }))
  return true
})
handle('google:logout', async () => {
  const refresh = readRefresh()
  gAccess = null
  await fs.rm(G_TOKEN(), { force: true })
  if (refresh) net.fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(refresh), { method: 'POST' }).catch(() => {})
  return true
})
handle('google:login', async () => {
  const c = readClient()
  if (!c) throw new Error('구글 연결 파일을 먼저 올리세요.')
  const crypto = require('node:crypto')
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')
  const { code, redirect } = await new Promise((resolve, reject) => {
    let port = 0 // 듣기 시작할 때 정해 둔다(서버를 닫은 뒤에는 주소를 읽을 수 없음)
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/callback') return res.writeHead(404).end()
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<meta charset="utf-8"><p style="font:18px sans-serif;margin:40px">${ok ? '구글 연결이 끝났습니다. 이 창을 닫고 담임 업무로 돌아가세요.' : '연결하지 못했습니다. 앱에서 다시 시도하세요.'}</p>`)
      clearTimeout(timer)
      server.close()
      if (ok) resolve({ code: u.searchParams.get('code'), redirect: `http://127.0.0.1:${port}/callback` })
      else reject(new Error(u.searchParams.get('error') === 'access_denied' ? '구글 로그인을 취소했습니다.' : '구글 로그인에 실패했습니다.'))
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('구글 로그인 시간이 지났습니다. 다시 시도하세요.'))
    }, 5 * 60000)
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({
        client_id: c.client_id,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      }).toString()
      shell.openExternal(url.toString())
    })
  })
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier })
  if (!t.refresh_token) throw new Error('구글이 로그인 유지 정보를 주지 않았습니다. 다시 시도하세요.')
  writeRefresh(t.refresh_token)
  gAccess = { token: t.access_token, until: Date.now() + (t.expires_in || 3600) * 1000 }
  if (win) win.focus()
  return true
})
// 캘린더 API만 부를 수 있다(다른 구글 주소로는 토큰을 보내지 않음).
handle('google:api', async (method, apiPath, body) => {
  if (!/^\/calendar\/v3\//.test(String(apiPath))) throw new Error('허용되지 않은 주소입니다.')
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) throw new Error('허용되지 않은 요청입니다.')
  const send = async () =>
    net.fetch('https://www.googleapis.com' + apiPath, {
      method,
      headers: { authorization: 'Bearer ' + (await accessToken()), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  let res = await send()
  if (res.status === 401) {
    gAccess = null
    res = await send()
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`구글 캘린더 오류(${res.status})${res.status === 403 ? ': 권한을 확인하세요' : ''}`)
  return text ? JSON.parse(text) : null
})
