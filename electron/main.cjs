// 담임 업무 데스크톱(Windows 포터블 exe) 진입점.
// 화면은 dist(웹 빌드)를 app://local 주소로 보여 주고, 백업 폴더 읽기·쓰기만 Node로 처리한다.
const { app, BrowserWindow, Menu, protocol, net, ipcMain, dialog, powerMonitor, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const os = require('node:os')

const BUILT_DIST = path.join(__dirname, '..', 'dist')
// ---- 자동 업데이트 ----
// 화면(dist)만 GitHub에서 받아 바꾼다. exe(이 파일·preload)가 바뀌는 업데이트는 SHELL 번호를 올리고 새 exe를 받아야 한다.
const SHELL = 1
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
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.anthropic.com https://open.neis.go.kr; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: '담임 업무',
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
  const res = await net.fetch(UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' })
  if (!res.ok) throw new Error('update.json ' + res.status)
  const info = await res.json()
  if (!newer(info.version, RUNNING_VERSION)) return sendUpdate({ status: 'latest', current: RUNNING_VERSION })
  if (info.shell > SHELL) return sendUpdate({ status: 'need-exe', current: RUNNING_VERSION, version: info.version, note: info.note || '' })
  const bundleUrl = new URL(info.bundle, UPDATE_URL).toString()
  const bytes = Buffer.from(await (await net.fetch(bundleUrl, { cache: 'no-store' })).arrayBuffer())
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
function runClaude(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    fsSync.mkdirSync(AI_DIR(), { recursive: true })
    const child = spawn('claude', args, { cwd: AI_DIR(), shell: process.platform === 'win32', windowsHide: true, env: process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
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
      else reject(new Error(/login|auth|log in/i.test(err + out) ? 'Claude Code에 로그인되어 있지 않습니다. 명령 창에서 claude 를 한 번 실행해 로그인하세요.' : 'Claude Code 실행 중 오류가 났습니다. 사용량 한도(Pro 프로그램용 크레딧)를 확인하세요.'))
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
  const raw = await runClaude(['-p', '--output-format', 'json', '--max-turns', '1', '--model', 'haiku'], prompt, 180000)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error('Claude Code 응답을 읽지 못했습니다.')
  }
  if (body.is_error) throw new Error('Claude Code가 오류를 돌려주었습니다. 사용량 한도를 확인하세요.')
  return String(body.result || '')
})

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
