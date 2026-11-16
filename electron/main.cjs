// Watson(담임 업무) 데스크톱(Windows exe) 진입점.
// 화면은 dist(웹 빌드)를 app://local 주소로 보여 주고, 백업 폴더 읽기·쓰기만 Node로 처리한다.
const { app, BrowserWindow, Menu, protocol, net, ipcMain, dialog, powerMonitor, shell, safeStorage, session } = require('electron')
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
const SHELL = 6
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
const UC = require('./updateCore.cjs')
/** 받은 판으로 켰을 때만 { name, dir, version, shell }. 내장 판이면 null(되돌리기 판정 대상 아님). */
let RUN = null
let startNotice = null
let aliveSeen = false
let failedThisRun = false
let relaunching = false
let reloadedThisRun = false
/** 종료 중(before-quit·윈도우 로그오프/끄기): 화면이 죽어도 아무것도 하지 않는다. */
let quitting = false
app.on('before-quit', () => { quitting = true })
let aliveTimer = null
/** 받은 판이 쓸 만한가: exe가 받아들이는 shell, exe에 든 화면보다 새 판, index.html 있음(내장 판보다 옛것·같은 것은 고르지 않는다). */
const usableBundle = (c, dir) => typeof c.shell === 'number' && c.shell <= SHELL && newer(c.version, app.getVersion()) && fsSync.existsSync(path.join(dir, 'index.html'))
/**
 * 켤 때 판 고르기: decideStart(두 번 연속 alive 없음 → prev/내장) + quick manifest 확인(실패면 되돌림).
 * 받은 판이 쓸 만하지 않으면 내장 판. 고른 상태(cleanExit=false: alive를 기다림)를 원자적으로 쓴다.
 */
async function pickDist() {
  const builtin = { dist: BUILT_DIST, version: app.getVersion() }
  // 두 번째 실행(곧 끝남)은 첫 실행의 판정 상태를 건드리지 않는다.
  if (!GOT_LOCK) return builtin
  const U = UPDATES_DIR()
  const cur = UC.readCurrent(U)
  if (!cur) return builtin
  let next = UC.decideStart(cur).next
  let picked = null
  for (let i = 0; i < 3 && next && next.dir; i++) {
    const dir = path.join(U, next.dir)
    if (!usableBundle(next, dir)) break
    let cache = next.cache
    let badBundle = false
    if (fsSync.existsSync(path.join(dir, 'manifest.json'))) {
      const q = await UC.quickStartCheck(dir, { cache: next.cache })
      if (q.verdict === 'ok') cache = q.cache
      else if (q.verdict === 'bad') badBundle = true
      // 'io'(백신 잠금 등): 그대로 켜고 세지 않는다. 코드만 남긴다.
      else console.warn('[update] manifest read error', (q.codes || []).join(','))
    } else if (UC.versionGte(next.version, '1.0.0')) badBundle = true
    if (badBundle) {
      // 파일이 바뀐 판(해시 틀림·빠진 파일): 실패한 실행처럼 되돌린다.
      next = UC.rollback(next, UC.MANIFEST_NOTICE).next
      continue
    }
    next = { ...next, cache }
    picked = { name: next.dir, dir, version: next.version, shell: next.shell }
    break
  }
  if (next) {
    if (next.notice) startNotice = next.notice
    delete next.notice
    if (!picked) next.cleanExit = true
    try {
      UC.writeCurrentAtomic(U, next)
    } catch {
      /* 다음에 다시 */
    }
    // 1.0 이상 exe: 되돌린 판·1.0 미만 묶음 정리(지금 쓰는 것·prev는 남김)
    if (UC.versionGte(app.getVersion(), '1.0.0')) UC.pruneBundles(U, [next.dir, next.prev && next.prev.dir], picked && picked.name)
  }
  RUN = picked
  return picked ? { dist: picked.dir, version: picked.version } : builtin
}
/** 지금 실행 중인 받은 판의 current.json만 고친다(그 사이 새 판을 설치했으면 건드리지 않음). */
function updateRunState(fn) {
  if (!RUN) return
  try {
    const c = UC.readCurrent(UPDATES_DIR())
    if (c && c.dir === RUN.name) UC.writeCurrentAtomic(UPDATES_DIR(), fn(c))
  } catch {
    /* 상태를 못 써도 앱은 계속 */
  }
}
/**
 * render-process-gone·did-fail-load 판정은 UC.onRendererGone.
 * relaunch: alive 전 받은 판 → 실패로 세고 다시 켬(두 번이면 decideStart가 prev/내장으로).
 * reload: alive 뒤 화면이 죽음 → 창만 한 번 다시 읽음. 그 밖은 아무것도 안 함.
 */
function rendererGone(reason) {
  const act = UC.onRendererGone({ alive: aliveSeen, reason, quitting, relaunchedThisRun: relaunching, reloadedThisRun, bundle: !!RUN })
  if (act === 'relaunch') {
    relaunching = true
    failedThisRun = true
    updateRunState(UC.recordFailure)
    app.relaunch()
    app.exit(0)
  } else if (act === 'reload') {
    reloadedThisRun = true
    if (win && !win.isDestroyed()) win.webContents.reload()
  }
}
let DIST = BUILT_DIST
let RUNNING_VERSION = app.getVersion()
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

const GOT_LOCK = app.requestSingleInstanceLock()
if (!GOT_LOCK) app.quit()

let win
let closeFlow
const CloseFlow = require('./closeFlow.cjs')
// 화면 CSP·권한·경로 통로: 본체는 security.cjs(시험됨). 화면이 부를 수 있는 바깥 주소는 AI와 NEIS뿐이다.
const secLib = require('./security.cjs')
const { CSP } = secLib
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
  // 되돌리기 판정: 화면이 죽거나 못 읽으면 실패. 다 읽고도 20초 안에 alive가 없으면 실패로 센다(다시 켜지는 않음).
  win.webContents.on('render-process-gone', (_e, d) => rendererGone(d && d.reason))
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) rendererGone('did-fail-load')
  })
  // 닫기 전 저장: 화면이 준비를 알린 뒤의 첫 close를 막고 저장 끝(close-ok) 또는 3초에 닫는다.
  const w = win
  closeFlow = CloseFlow.createCloseFlow({
    send: () => { try { w.webContents.send('app:before-close') } catch { /* 화면이 이미 없음 */ } },
    destroy: () => { if (!w.isDestroyed()) w.destroy() },
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    timeoutMs: 3000,
  })
  w.on('close', (e) => closeFlow.onClose(e))
  w.webContents.on('did-start-navigation', (e, _url, _inPlace, isMainFrame) => { if ((e && e.isMainFrame) || isMainFrame) closeFlow.setReady(false) })
  // 윈도우 로그오프·끄기: 막지 않고 종료 중으로 표시하고, 저장만 곧바로 시작시킨다.
  win.on('query-session-end', () => { quitting = true; closeFlow.onSessionEnd() })
  win.on('session-end', () => { quitting = true; closeFlow.onSessionEnd() })
  win.webContents.on('did-finish-load', () => {
    if (!RUN || aliveSeen || aliveTimer) return
    aliveTimer = setTimeout(() => {
      if (aliveSeen || failedThisRun) return
      failedThisRun = true
      updateRunState(UC.recordFailure)
    }, 20000)
  })
  // 사용자가 닫은 실행은 세지 않는다(alive 전이라도 정상 종료 표시).
  win.on('closed', () => {
    clearTimeout(aliveTimer)
    if (!aliveSeen && !relaunching) updateRunState(UC.markClean)
  })
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

ipcMain.on('app:before-close-ready', (e) => { if (win && e.sender === win.webContents && closeFlow) closeFlow.setReady(true) })
ipcMain.on('app:close-ok', (e) => { if (win && e.sender === win.webContents && closeFlow) closeFlow.onCloseOk() })

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  // 판 고르기가 어떤 이유로든 실패해도 exe에 든 화면으로는 반드시 연다(화면 없는 상태 방지).
  const picked = await pickDist().catch(() => ({ dist: BUILT_DIST, version: app.getVersion() }))
  DIST = picked.dist
  RUNNING_VERSION = picked.version
  // 메뉴를 아예 없애 새로고침(Ctrl+R)·개발자 도구 단축키를 막는다(PIN 우회 방지).
  Menu.setApplicationMenu(null)
  // 권한: 클립보드 쓰기(노트·누가기록 복사)만. 마이크·위치·알림 등은 묻지도 않고 거부한다.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(secLib.permissionAllowed(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => secLib.permissionAllowed(permission))
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
  updateState = startNotice ? { ...state, notice: startNotice } : state
  state = updateState
  if (win) win.webContents.send('update:state', state)
}
async function checkForUpdate() {
  sendUpdate({ status: 'checking', current: RUNNING_VERSION })
  const { fetchCapped } = require('./fetchcap.cjs')
  const info = JSON.parse((await fetchCapped((u, i) => net.fetch(u, i), UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' }, { timeoutMs: 20000, maxBytes: 1024 * 1024 })).toString('utf8'))
  if (!newer(info.version, RUNNING_VERSION)) return sendUpdate({ status: 'latest', current: RUNNING_VERSION })
  const skipped = UC.readCurrent(UPDATES_DIR())
  // 두 번 열리지 않아 되돌린 판은 다시 설치하지 않는다.
  if (skipped && skipped.skip.includes(info.version)) return sendUpdate({ status: 'latest', current: RUNNING_VERSION })
  if (info.shell > SHELL) return sendUpdate({ status: 'need-exe', current: RUNNING_VERSION, version: info.version, note: info.note || '' })
  const bundleUrl = new URL(info.bundle, UPDATE_URL).toString()
  const bytes = await fetchCapped((u, i) => net.fetch(u, i), bundleUrl, { cache: 'no-store' }, { timeoutMs: 180000, maxBytes: 60 * 1024 * 1024 })
  const crypto = require('node:crypto')
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')
  // sha·옛 서명·서명2(1.0부터 필수)가 맞지 않으면(위조·손상) 절대 적용하지 않는다. 기한이 지났으면 경고만.
  const verdict = UC.verifyInstall(info, sha, UPDATE_PUBLIC_KEY)
  if (!verdict.ok) return sendUpdate({ status: 'error', current: RUNNING_VERSION, message: verdict.message })
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const dirName = `v${info.version}-${Date.now()}`
  const target = path.join(UPDATES_DIR(), dirName)
  const fail = async (message) => {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    return sendUpdate({ status: 'error', current: RUNNING_VERSION, message })
  }
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const out = path.normalize(path.join(target, name))
    if (!out.startsWith(target + path.sep)) continue
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, await entry.async('nodebuffer'))
  }
  if (!fsSync.existsSync(path.join(target, 'index.html'))) return fail('업데이트 파일에 화면이 없어 적용하지 않았습니다.')
  // 묶음 안 manifest.json: 모든 파일 해시가 맞고 목록 밖 파일이 없어야 한다(1.0부터 필수).
  let cache
  const mfPath = path.join(target, 'manifest.json')
  if (verdict.needManifest || fsSync.existsSync(mfPath)) {
    let r
    try {
      r = UC.checkManifest(target, JSON.parse(await fs.readFile(mfPath, 'utf8')))
    } catch {
      r = { ok: false }
    }
    if (!r.ok) return fail('업데이트 파일 확인(목록)에 실패해 적용하지 않았습니다.')
    cache = r.cache
  }
  const v1 = UC.versionGte(info.version, '1.0.0')
  let prev = RUN ? { version: RUN.version, shell: RUN.shell, dir: RUN.name } : null
  if (prev && v1 && !UC.versionGte(prev.version, '1.0.0')) prev = null
  const before = UC.readCurrent(UPDATES_DIR())
  UC.writeCurrentAtomic(UPDATES_DIR(), { version: info.version, shell: info.shell, dir: dirName, prev, failedStarts: 0, cleanExit: true, skip: before ? before.skip : [], cache })
  if (v1) {
    // 1.0 이상: 1.0 미만 묶음과 새 판·prev 밖 묶음을 지운다(지금 쓰는 폴더는 이번 실행 동안 남김).
    UC.pruneBundles(UPDATES_DIR(), [dirName, prev && prev.dir], RUN && RUN.name)
  } else {
    // 예전에 받은 폴더 정리(지금 쓰는 것과 새것만 남김)
    for (const d of await fs.readdir(UPDATES_DIR())) {
      const full = path.join(UPDATES_DIR(), d)
      if (d !== dirName && d !== 'current.json' && full !== DIST) await fs.rm(full, { recursive: true, force: true }).catch(() => {})
    }
  }
  sendUpdate({ status: 'ready', current: RUNNING_VERSION, version: info.version, note: info.note || '', ...(verdict.warning ? { warning: verdict.warning } : {}) })
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
// 열쇠(vault): 본체는 vault.cjs(시험됨). DEK 평문은 로그에 남기지 않는다.
let vaultHandlers = null // 쓰기 큐를 하나로 공유하려고 한 번만 만든다
const vaultH = () => (vaultHandlers ??= require('./vault.cjs').createVaultHandlers(app.getPath('userData'), safeStorage))
handle('vault:status', () => vaultH().status())
handle('vault:unlock-dpapi', () => vaultH().unlockDpapi())
handle('vault:read-backup', () => vaultH().readBackup())
handle('vault:store', (p) => vaultH().store(p))
handle('vault:reset', () => vaultH().reset())
// 다른 이름으로 저장(옮기기 마법사의 새 백업 파일): 본체는 saveFile.cjs(시험됨). 실제로 쓰고 크기를 확인했을 때만 ok.
const saveAs = require('./saveFile.cjs').createSaveAs({
  showSaveDialog: ({ defaultName }) => dialog.showSaveDialog(win, {
    title: '백업 파일 저장', defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Watson 백업', extensions: ['enc'] }],
  }),
})
handle('file:save-as', (name, bytes) => saveAs(name, bytes))
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
// 지시문·메모는 표준 입력으로만 넘기고(명령줄 인자에 넣지 않음), 앱 자료 폴더의 빈 작업 폴더(ai-work)에서 도구 없이 한 번만 답하게 한다.
// 프로그램은 where/which로 찾은 절대 경로로만 부른다(작업 폴더·상대 경로의 같은 이름 파일은 쓰지 않음).
const AI_DIR = () => path.join(app.getPath('userData'), 'ai-work')
const aiDir = () => (fsSync.mkdirSync(AI_DIR(), { recursive: true }), AI_DIR())
// 예전 임시 작업 폴더(os 임시 폴더)를 지운다.
app.whenReady().then(() => {
  fsSync.rmSync(path.join(os.tmpdir(), 'damim-ai'), { recursive: true, force: true })
})
const agyLib = require('./agy.cjs')
/** 이름 → { file, viaCmd } | null. where/which는 작업 폴더에서 돌리고 그 폴더의 결과는 버린다. */
function findProgram(name) {
  const cwd = aiDir()
  return agyLib.resolveAbs(name, {
    platform: process.platform,
    cwd,
    run: (cmd, args) => require('node:child_process').execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, cwd, timeout: 10000 }),
    exists: (f) => {
      try {
        return fsSync.statSync(f).isFile()
      } catch {
        return false
      }
    },
  })
}
/** 셸 없이 부르기. .cmd/.bat는 cmd.exe /d /s /c 에 cmd 규칙대로 인용한 한 줄로(인자에는 학생 글이 없다). */
function spawnProgram(found, args) {
  const opts = { cwd: aiDir(), windowsHide: true, env: process.env }
  if (!found.viaCmd) return spawn(found.file, args, opts)
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', agyLib.cmdLine(found.file, args)], { ...opts, windowsVerbatimArguments: true })
}
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
    const found = findProgram('claude')
    if (!found) return reject(new Error('Claude Code를 찾지 못했습니다. 노트북에 Claude Code를 설치하고 로그인했는지 확인하세요.'))
    const child = spawnProgram(found, args)
    // utf8 해독기로 모은다(조각 경계에서 한글이 깨지지 않게)
    const outText = agyLib.collectText(child.stdout)
    const errText = agyLib.collectText(child.stderr)
    const timer = setTimeout(() => {
      killTree(child)
      reject(new Error('Claude Code 응답이 너무 늦습니다. 잠시 뒤 다시 시도하세요.'))
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Claude Code를 찾지 못했습니다. 노트북에 Claude Code를 설치하고 로그인했는지 확인하세요.'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(outText())
      else reject(new Error(agyLib.claudeErrorText(errText() + outText())))
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
  const raw = await runClaude(agyLib.claudeAskArgs(process.platform), prompt, 180000)
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
// 글은 문서화된 headless 입력(stream-json)으로 표준 입력에 넘긴다. 그 인자를 모르는 예전 판만 검증된 -p 인자 방식(알려진 한계).
// 셸을 거치지 않고 부른다(.cmd면 cmd.exe 규칙대로 quoteCmdArg로 인용).
function runAgy(args, timeoutMs, input = null) {
  return new Promise((resolve, reject) => {
    const found = findProgram('agy')
    if (!found) return reject(new Error('Antigravity CLI(agy)를 찾지 못했습니다. 설치 후 명령 창에서 agy 를 한 번 실행해 로그인하세요.'))
    // cmd.exe 한 줄은 8,191자까지(예전 판 대체에서 글이 인자일 때만 해당)
    if (found.viaCmd && agyLib.cmdLine(found.file, args).length > 8000) return reject(new Error('AI에 보낼 글이 너무 깁니다. 내용을 나눠서 정리하세요.'))
    const child = spawnProgram(found, args)
    const outText = agyLib.collectText(child.stdout)
    const errText = agyLib.collectText(child.stderr)
    const timer = setTimeout(() => {
      killTree(child)
      reject(new Error('Antigravity 응답이 너무 늦습니다. 잠시 뒤 다시 시도하세요.'))
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Antigravity CLI(agy)를 실행하지 못했습니다.'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ out: outText(), err: errText(), code })
    })
    child.stdin.on('error', () => {}) // 표준 입력을 읽지 않고 끝나는 판(EPIPE)
    if (input !== null) child.stdin.end(input, 'utf8')
    else child.stdin.end()
  })
}
/** stream-json 인자를 모르는 예전 판이면(모델 호출 전 거절) 이번 실행 동안은 검증된 -p 인자 방식으로. */
let agyInputMode = 'stdin'
/** 한 번 묻기 = 모델 호출 한 번. 빈·못 읽은 응답은 다시 부르지 않고 오류로. 결과에 { via: 'stdin' | 'argv' }. */
async function agyAsk(prompt, timeoutMs) {
  if (agyInputMode === 'stdin') {
    const r = await runAgy(agyLib.agyArgs(prompt), timeoutMs, agyLib.agyStdinLine(prompt))
    // 로그인 오류는 stderr로만 올 수 있다(종료 1): 둘 다 본다.
    if (!agyLib.streamRejected(r)) return { ...agyLib.parseAgyStream(r.out, r.err), via: 'stdin' }
    agyInputMode = 'argv'
    console.warn('[agy] stream-json rejected; argv mode') // 글·출력은 남기지 않는다
  }
  const r = await runAgy(agyLib.agyArgvArgs(prompt), timeoutMs)
  return { ...agyLib.parseAgyOutput(r.out || r.err), via: 'argv' }
}
handle('ai:agy:status', async () => {
  try {
    const { out } = await runAgy(['--version'], 20000)
    if (!out.trim()) return { installed: false }
    // 버전만으로는 로그인 여부를 모르므로 아주 짧은 시험 질문을 한 번 보낸다(학생 자료 없음).
    // 확인 문자는 (기본) 표준 입력으로만 보내고, 답에 그 문자가 있어야 입력을 읽은 것이다.
    const nonce = 'W' + require('node:crypto').randomBytes(6).toString('hex')
    let probe
    try {
      probe = await agyAsk(agyLib.probePrompt(nonce), 45000)
    } catch (e) {
      probe = { error: e instanceof Error ? e.message : String(e) }
    }
    return { ...agyLib.statusFrom(out, probe, nonce), inputMode: probe.via || agyInputMode }
  } catch {
    return { installed: false }
  }
})
handle('ai:agy:ask', async (prompt) => {
  const r = await agyAsk(String(prompt || ''), 60000)
  if (r.error) throw new Error(r.error)
  if (!String(r.text || '').trim()) throw new Error('Antigravity 응답이 없습니다.')
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

// ---- 경로 통로: 대화상자로 고른 폴더(루트, 다시 켜도 기억)·고르거나 끌어 놓은 파일(이번 실행만)만 연다 ----
const ROOTS_FILE = () => path.join(app.getPath('userData'), 'path-roots.json')
let pathRootsInst = null
const pathRoots = () => {
  if (pathRootsInst) return pathRootsInst
  let saved = []
  try {
    saved = JSON.parse(fsSync.readFileSync(ROOTS_FILE(), 'utf8')).roots || []
  } catch {
    /* 처음 */
  }
  return (pathRootsInst = secLib.createPathRoots({ roots: saved }))
}
function saveRoots() {
  const roots = pathRoots().roots().slice(-200)
  const tmp = ROOTS_FILE() + '.tmp'
  fsSync.writeFileSync(tmp, JSON.stringify({ roots }))
  fsSync.renameSync(tmp, ROOTS_FILE())
}
/** 대화상자로 폴더를 골라 루트로 등록. defaultPath는 대화상자가 처음 보여 줄 곳일 뿐(허용 아님). */
async function pickFolder(defaultPath) {
  const opts = { title: '노트에 연결할 폴더', properties: ['openDirectory'] }
  if (foldersLib.isLocalPath(defaultPath)) opts.defaultPath = defaultPath
  const r = await dialog.showOpenDialog(win, opts)
  if (r.canceled || !r.filePaths[0]) return null
  const dir = r.filePaths[0]
  if (!pathRoots().addRoot(dir)) throw new Error('이 폴더는 연결할 수 없습니다.')
  try {
    saveRoots()
  } catch {
    /* 이번 실행 동안은 허용 */
  }
  return dir
}
handle('paths:pick-folder', (defaultPath) => pickFolder(defaultPath))
handle('folder:pick', async () => {
  const dir = await pickFolder()
  return dir ? { path: dir } : null
})
// preload가 놓은(고른) File에서 얻은 경로만 온다(네트워크 공유도 사용자가 놓은 것이면 받음). 실제로 있는 보통 파일이어야 한다(동기로 등록해 다음 stt:run보다 먼저 끝남).
handle('paths:register-drop', (p) => {
  let st = null
  try {
    st = secLib.isUserAbsPath(p) ? fsSync.statSync(p) : null
  } catch {
    st = null
  }
  if (!st || !st.isFile() || !pathRoots().addFile(p)) throw new Error('파일을 읽을 수 없습니다.')
  return p
})
// 화면 src/lib/notes/folders.ts NOT_ALLOWED와 같은 글
const FOLDER_NOT_ALLOWED = '이 폴더를 열려면 먼저 허용해야 합니다.'
/** 고른 루트 안(실제 경로 비교)만. 글자로 루트 밖이면 디스크·네트워크에 닿기 전에 거절한다. */
function allowedDir(p) {
  if (pathRoots().allowDir(p)) return p
  // 글자로는 고른 폴더 안인데 실제 경로를 못 구함 = 지워졌거나 옮겨짐
  if (pathRoots().knownDir(p)) throw new Error('폴더를 찾지 못했습니다.')
  throw new Error(FOLDER_NOT_ALLOWED)
}
handle('folder:open', async (p) => {
  const dir = await foldersLib.assertDir(allowedDir(p), { network: true })
  const err = await shell.openPath(dir)
  if (err) throw new Error('폴더를 열지 못했습니다.')
})
handle('folder:list', async (p) => foldersLib.listDir(allowedDir(p), { network: true }))

// ---- 음성 받아쓰기: 고른 사람만 받아 두고, 녹음은 이 컴퓨터 안에서만 글로 바꾼다 ----
const sttLib = require('./stt.cjs')
const STT_DIR = () => path.join(app.getPath('userData'), 'stt')
const STT_WORK = () => path.join(AI_DIR(), 'stt')
const sttSupported = () => process.platform === 'win32' && process.arch === 'x64'
const sttJobs = sttLib.createSttJobs((child) => killTree(child))
const sttSend = (p) => win && win.webContents.send('stt:progress', p)
const CANCELLED = '그만두었습니다.'
function sttStatus() {
  const dir = STT_DIR()
  const has = (f) => fsSync.existsSync(path.join(dir, f))
  // 실행 파일은 dll까지 다 풀린 뒤 마지막에 놓는다(중간에 끊기면 bin=false라 다시 받는다)
  return {
    supported: sttSupported(),
    bin: has('whisper-cli.exe') && has('whisper.dll'),
    models: Object.entries(sttLib.STT_FILES.models).filter(([, m]) => has(m.file)).map(([k]) => k),
  }
}
// 지난번에 끝나지 못한 받아쓰기 임시 파일(녹음·글)과 받다 만 파일을 지운다
app.whenReady().then(() => {
  fsSync.rmSync(STT_WORK(), { recursive: true, force: true })
  try {
    for (const f of fsSync.readdirSync(STT_DIR())) if (f.endsWith('.part') || f === 'whisper-bin.zip') fsSync.rmSync(path.join(STT_DIR(), f), { force: true })
  } catch {
    /* 아직 받은 적 없음 */
  }
})
// 앱을 닫으면 받아쓰던 프로그램도 끝낸다(녹음 글을 든 채 남지 않게)
app.on('before-quit', () => sttJobs.cancel())
handle('stt:status', async () => sttStatus())
handle('stt:install', async (model) => {
  if (!sttSupported()) throw new Error('이 컴퓨터(Windows 64비트가 아님)에서는 쓸 수 없습니다.')
  const m = sttLib.STT_FILES.models[model]
  if (!m) throw new Error('모델을 고르세요.')
  const job = sttJobs.start('install')
  const ctl = new AbortController()
  job.abort = () => ctl.abort()
  const dir = STT_DIR()
  const zipPath = path.join(dir, 'whisper-bin.zip')
  try {
    const f = (u, i) => net.fetch(u, i)
    // 멈춤 판단은 받는 동안 1분 넘게 아무것도 오지 않을 때(느린 학교 망에서도 끝까지 받게)
    const idle = (phase) => (r, t) => sttSend({ phase, received: r, total: t })
    if (!sttStatus().bin) {
      await sttLib.downloadVerified(f, sttLib.STT_FILES.bin.url, zipPath, sttLib.STT_FILES.bin.sha256, { maxBytes: sttLib.STT_FILES.bin.maxBytes, timeoutMs: 6 * 3600000, idleMs: 60000, signal: ctl.signal, onProgress: idle('bin') })
      const tmp = path.join(dir, 'bin-tmp')
      await fs.rm(tmp, { recursive: true, force: true })
      const got = await sttLib.extractBin(await fs.readFile(zipPath), tmp)
      if (!got.includes('whisper-cli.exe') || !got.includes('whisper.dll')) throw new Error('받은 프로그램이 올바르지 않습니다.')
      for (const n of got.filter((x) => x !== 'whisper-cli.exe')) await fs.rename(path.join(tmp, n), path.join(dir, n))
      await fs.rename(path.join(tmp, 'whisper-cli.exe'), path.join(dir, 'whisper-cli.exe'))
      await fs.rm(tmp, { recursive: true, force: true })
    }
    await sttLib.downloadVerified(f, m.url, path.join(dir, m.file), m.sha256 ?? m.sha1, { maxBytes: m.maxBytes, timeoutMs: 6 * 3600000, idleMs: 60000, signal: ctl.signal, onProgress: idle('model') })
    return sttStatus()
  } finally {
    await fs.rm(zipPath, { force: true })
    job.done()
  }
})
handle('stt:remove', async () => {
  if (sttJobs.busy()) throw new Error('받거나 받아쓰는 중에는 지울 수 없습니다.')
  await fs.rm(STT_DIR(), { recursive: true, force: true })
  return sttStatus()
})
handle('stt:cancel', async () => sttJobs.cancel())
handle('stt:run', async ({ path: input, wav, model } = {}) => {
  if (!sttSupported()) throw new Error('이 컴퓨터에서는 쓸 수 없습니다.')
  const job = sttJobs.start('run') // 동기로 자리 잡기: 이 뒤로 누른 취소는 모두 이 작업에 닿는다
  const work = path.join(STT_WORK(), require('node:crypto').randomUUID())
  try {
    const st = sttStatus()
    const key = model && st.models.includes(model) ? model : ['best', 'accurate', 'fast'].find((k) => st.models.includes(k))
    if (!st.bin || !key) throw new Error('먼저 설정에서 음성 받아쓰기를 받으세요.')
    await fs.mkdir(work, { recursive: true })
    // 받아쓰기 프로그램은 영문 경로가 안전하다: 녹음을 작업 폴더에 in.확장자로 옮겨 쓴다
    let file
    if (wav) {
      file = path.join(work, 'in.wav')
      await fs.writeFile(file, Buffer.from(wav))
    } else {
      const ext = typeof input === 'string' ? path.extname(input).toLowerCase() : ''
      if (!pathRoots().allowFile(input) || !['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) throw new Error('녹음 파일을 읽을 수 없습니다.')
      const stIn = await fs.stat(input).catch(() => null)
      if (!stIn || !stIn.isFile()) throw new Error('녹음 파일을 읽을 수 없습니다.')
      file = path.join(work, 'in' + ext)
      await fs.copyFile(input, file)
    }
    if (job.cancelled) throw new Error(CANCELLED)
    const outBase = path.join(work, 'out')
    const cli = path.join(STT_DIR(), 'whisper-cli.exe')
    const args = sttLib.whisperArgs({ model: path.join(STT_DIR(), sttLib.STT_FILES.models[key].file), input: file, outBase, threads: Math.max(1, Math.min(8, os.cpus().length - 1)) })
    const text = await new Promise((resolve, reject) => {
      const child = spawn(cli, args, { cwd: STT_DIR(), windowsHide: true })
      job.attach(child)
      let err = ''
      const onData = (d) => {
        const t = String(d)
        err = (err + t).slice(-4000)
        for (const line of t.split(/\r?\n/)) {
          const p = sttLib.parseProgress(line)
          if (p !== null) sttSend({ phase: 'run', percent: p })
        }
      }
      child.stderr.on('data', onData)
      child.stdout.on('data', onData)
      child.on('error', (e) => reject(new Error(`받아쓰기 프로그램을 열지 못했습니다: ${e.message}`)))
      child.on('close', async (code) => {
        if (job.cancelled) return reject(new Error(CANCELLED))
        if (code !== 0) return reject(new Error(`받아쓰기에 실패했습니다(${code}). ${/vcruntime|MSVCP/i.test(err) ? 'Microsoft Visual C++ 재배포 패키지가 필요할 수 있습니다.' : ''}`.trim()))
        try {
          resolve((await fs.readFile(outBase + '.txt', 'utf8')).trim())
        } catch {
          reject(new Error('받아쓴 글을 읽지 못했습니다.'))
        }
      })
    })
    if (job.cancelled) throw new Error(CANCELLED)
    return { text }
  } finally {
    job.done()
    await fs.rm(work, { recursive: true, force: true })
  }
})

handle('update:get', async () => ({ ...updateState, current: RUNNING_VERSION, ...(startNotice ? { notice: startNotice } : {}) }))
// 되돌리기 판정: 화면의 React 뿌리가 붙었다(받은 판이 열렸다).
handle('bundle:alive', async () => {
  if (aliveSeen) return true
  aliveSeen = true
  clearTimeout(aliveTimer)
  updateRunState(UC.markAlive)
  return true
})
handle('update:check', async () => {
  try {
    await checkForUpdate()
  } catch {
    sendUpdate({ status: 'error', current: RUNNING_VERSION, message: '업데이트를 확인하지 못했습니다. 인터넷 연결을 확인하세요.' })
  }
  return updateState
})
handle('update:restart', async () => {
  // app.exit는 close·before-quit를 건너뛰니, 먼저 화면에 저장 신호를 보내고 끝(또는 3초)까지 기다린다.
  try { if (closeFlow) await closeFlow.beforeRestart() } catch { /* 저장 신호 실패는 재시작을 막지 않음 */ }
  app.relaunch()
  app.exit(0)
})

// ---- 구글: 로그인(시스템 브라우저 + 127.0.0.1 되돌아오기 + PKCE)과 API 통로 ----
// 토큰은 메인 프로세스만 가지고 safeStorage 비동기로 감싸 저장한다(못 쓰면 저장하지 않음). 화면은 API 결과만 받는다.
// 본체는 googleApi.cjs(시험됨). 여기는 연결만.
const http = require('node:http')
const gLib = require('./googleApi.cjs')
const G_CLIENT = () => path.join(app.getPath('userData'), 'google-client.json')
const G_TOKEN = () => path.join(app.getPath('userData'), 'google-token.bin')
const readClient = () => {
  try {
    return JSON.parse(fsSync.readFileSync(G_CLIENT(), 'utf8'))
  } catch {
    return null
  }
}
let gClientInst = null
const gClient = () =>
  (gClientInst ??= gLib.createGoogleClient({
    // 되돌려 보내기를 따라가지 않는다(Bearer 토큰이 다른 곳으로 가지 않게). 구글 API는 되돌려 보내지 않는다.
    fetchFn: (url, init) => net.fetch(url, { ...init, redirect: 'error' }),
    store: gLib.createTokenStore({ file: G_TOKEN(), safe: safeStorage }),
    readClient,
  }))

handle('google:status', () => gClient().status())
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
handle('google:logout', () => gClient().logout())
let gLoginBusy = false
handle('google:login', async (scopesIn, opts) => {
  const scopes = gLib.validScopes(scopesIn)
  const incremental = !!(opts && opts.incremental)
  const c = readClient()
  if (!c) throw new Error('구글 연결 파일을 먼저 올리세요.')
  if (gLoginBusy) throw new Error('구글 로그인이 이미 진행 중입니다. 브라우저를 확인하세요.')
  gLoginBusy = true
  try {
    const crypto = require('node:crypto')
    const verifier = crypto.randomBytes(48).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('hex')
    const loginHint = incremental ? await gClient().loginHint().catch(() => null) : null
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
        shell.openExternal(gLib.authUrl({ clientId: c.client_id, redirect: `http://127.0.0.1:${port}/callback`, challenge, state, scopes, incremental, loginHint }))
      })
    })
    const t = await gClient().tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier })
    await gClient().completeLogin(t, scopes, incremental)
    if (win) win.focus()
    return true
  } finally {
    gLoginBusy = false
  }
})
// 허용 목록(캘린더·드라이브 파일)의 www.googleapis.com 주소만. 다른 곳으로는 토큰을 보내지 않는다.
handle('google:api', (method, url, body, opts) => gClient().api(method, url, body, opts))
handle('google:upload-resumable', (meta, bytes, fileId) => gClient().uploadResumable(meta, bytes, fileId))
handle('google:download', (fileId) => gClient().download(fileId))
