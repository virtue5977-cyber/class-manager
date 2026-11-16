// 업데이트 서명2·manifest·되돌리기의 순수 논리(Node로 시험한다). main.cjs는 연결만 한다.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const CANON_KEYS = ['bundle', 'date', 'expires', 'note', 'sha256', 'shell', 'version']
const ROLLBACK_NOTICE = '새 화면 판이 두 번 열리지 않아 이전 판으로 되돌렸습니다'
const MANIFEST_NOTICE = '화면 판 파일 확인에 실패해 이전 판으로 되돌렸습니다'
const EXPIRED_WARNING = '업데이트 서명 기한이 지났습니다'

const parts = (v) => String(v).split('.').map((x) => Number(x) || 0)
const cmp = (a, b) => {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}
const versionGte = (a, b) => cmp(a, b) >= 0

/** sig2가 덮는 정규 JSON: 일곱 키를 정렬 순서로(없으면 null). */
function canonicalUpdate(u) {
  const o = {}
  for (const k of CANON_KEYS) o[k] = u && u[k] !== undefined ? u[k] : null
  return JSON.stringify(o)
}

function verifySig2(u, publicKeyPem) {
  try {
    if (!u || typeof u.sig2 !== 'string' || !u.sig2) return false
    return crypto.verify(null, Buffer.from(canonicalUpdate(u)), publicKeyPem, Buffer.from(u.sig2, 'base64'))
  } catch {
    return false
  }
}

function verifyOldSig(u, sha, publicKeyPem) {
  try {
    if (typeof u.sig !== 'string' || !u.sig) return false
    return crypto.verify(null, Buffer.from(`${u.version}\n${u.shell}\n${sha}`), publicKeyPem, Buffer.from(u.sig, 'base64'))
  } catch {
    return false
  }
}

/**
 * 받은 묶음의 sha와 update.json을 확인한다. sha·옛 sig는 늘, sig2는 있으면(1.0 이상은 반드시).
 * expires가 지났으면 설치는 하되 경고를 돌려준다. needManifest: 묶음 안 manifest.json이 반드시 있어야 하나.
 */
function verifyInstall(info, sha, publicKeyPem, now = new Date()) {
  const fail = { ok: false, message: '업데이트 파일 확인(서명)에 실패해 적용하지 않았습니다.', needManifest: true }
  if (!info || typeof info.version !== 'string') return fail
  const v1 = versionGte(info.version, '1.0.0')
  if (sha !== info.sha256) return fail
  if (!verifyOldSig(info, sha, publicKeyPem)) return fail
  if (v1 || info.sig2 !== undefined) {
    if (!verifySig2(info, publicKeyPem)) return fail
  }
  const r = { ok: true, needManifest: v1 }
  if (info.expires) {
    const end = Date.parse(String(info.expires).length === 10 ? `${info.expires}T23:59:59Z` : info.expires)
    if (!Number.isFinite(end) || end < now.getTime()) r.warning = EXPIRED_WARNING
  } else if (v1) r.warning = EXPIRED_WARNING
  return r
}

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

/** dir 아래 모든 파일(manifest.json 제외)의 상대 경로(/) 목록. */
function listFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else out.push(path.relative(dir, p).split(path.sep).join('/'))
    }
  }
  walk(dir)
  return out.filter((n) => n !== 'manifest.json').sort()
}

function buildManifest(dir) {
  const m = {}
  for (const name of listFiles(dir)) m[name] = sha256File(path.join(dir, ...name.split('/')))
  return m
}

const IO_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOENT'])
const ENTRY_RE = /^assets\/index-[^/]*\.js$/
const isAlwaysChecked = (name) => name === 'index.html' || ENTRY_RE.test(name)

/**
 * manifest 확인. 전체: 모든 파일 해시 + 목록에 없는 파일이 없어야 한다.
 * quick: index.html·진입 파일(assets/index-*.js)은 늘 해시, 나머지는 cache와 크기·수정 시각이 다를 때만.
 * 돌려주는 cache는 해시가 맞은 파일의 { size, mtimeMs }.
 */
function checkManifest(dir, manifest, opts = {}) {
  const quick = !!opts.quick
  const old = (opts.cache && typeof opts.cache === 'object') ? opts.cache : {}
  const bad = []
  const ioErrors = []
  const cache = {}
  const root = path.resolve(dir)
  if (!manifest || typeof manifest !== 'object') return { ok: false, bad: ['manifest.json'], ioErrors, cache }
  for (const [name, hash] of Object.entries(manifest)) {
    const file = path.resolve(root, ...String(name).split('/'))
    if (!file.startsWith(root + path.sep) || name === 'manifest.json') { bad.push(name); continue }
    let st
    try {
      st = fs.statSync(file)
    } catch (e) {
      // 목록의 파일이 없으면 bad. 백신 잠금 같은 읽기 오류는 따로(세지 않게).
      if (IO_CODES.has(e && e.code) && e.code !== 'ENOENT') ioErrors.push({ name, code: e.code })
      else bad.push(name)
      continue
    }
    if (!st.isFile()) { bad.push(name); continue }
    const stamp = { size: st.size, mtimeMs: Math.trunc(st.mtimeMs) }
    const c = old[name]
    if (quick && !isAlwaysChecked(name) && c && c.size === stamp.size && c.mtimeMs === stamp.mtimeMs) {
      cache[name] = stamp
      continue
    }
    let h
    try {
      h = sha256File(file)
    } catch (e) {
      if (IO_CODES.has(e && e.code)) ioErrors.push({ name, code: e.code })
      else bad.push(name)
      continue
    }
    if (h !== hash) bad.push(name)
    else cache[name] = stamp
  }
  try {
    for (const name of listFiles(dir)) if (!Object.prototype.hasOwnProperty.call(manifest, name)) bad.push(name)
  } catch (e) {
    if (IO_CODES.has(e && e.code)) ioErrors.push({ name: '.', code: e.code })
    else bad.push('.')
  }
  return { ok: bad.length === 0 && ioErrors.length === 0, bad, ioErrors, cache }
}

/**
 * 켤 때 quick 확인. 해시 틀림·빠진 파일·깨진 manifest만 'bad'(실패로 세고 되돌림).
 * 읽기 오류(백신 잠금 등 EBUSY/EPERM/EACCES/ENOENT)는 retryMs 뒤 한 번 더 보고, 그래도면 'io'(그대로 켜고 세지 않음, 코드만).
 */
async function quickStartCheck(dir, opts = {}) {
  const check = opts.check || checkManifest
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'))
  const retryMs = opts.retryMs ?? 500
  const once = () => {
    let manifest
    try {
      manifest = JSON.parse(readFile(path.join(dir, 'manifest.json')))
    } catch (e) {
      if (IO_CODES.has(e && e.code)) return { ok: false, bad: [], ioErrors: [{ name: 'manifest.json', code: e.code }] }
      return { ok: false, bad: ['manifest.json'], ioErrors: [] }
    }
    return check(dir, manifest, { quick: true, cache: opts.cache })
  }
  let r = once()
  for (let i = 0; ; i++) {
    if (r.ok) return { verdict: 'ok', cache: r.cache }
    if (r.bad && r.bad.length) return { verdict: 'bad', bad: r.bad }
    if (i >= 1) break
    await sleep(retryMs)
    r = once()
  }
  return { verdict: 'io', codes: [...new Set((r.ioErrors || []).map((x) => x.code))] }
}

/**
 * 화면(렌더러)이 죽거나 못 읽었을 때 할 일. reason: render-process-gone의 reason 또는 'did-fail-load'.
 * - 종료 중(로그오프·before-quit)·killed·clean-exit: 아무것도 안 함.
 * - alive 전 + 받은 판: 'relaunch'(실패로 세고 다시 켬, 한 실행에 한 번).
 * - alive 뒤: 앱을 다시 켜지 않는다. 화면이 죽었으면 창을 한 번만 'reload', 그 뒤는 그대로 둔다(OOM 무한 재시작 막기).
 */
function onRendererGone(s) {
  if (!s || s.quitting) return 'none'
  if (s.reason === 'killed' || s.reason === 'clean-exit') return 'none'
  if (!s.alive) return s.bundle && !s.relaunchedThisRun ? 'relaunch' : 'none'
  if (s.reason === 'did-fail-load') return 'none'
  return s.reloadedThisRun ? 'none' : 'reload'
}

/** current.json을 새 모양으로 맞춘다(옛 {version, shell, dir} 포함). 모양이 아니면 null. */
function normalizeCurrent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const prev = raw.prev && typeof raw.prev === 'object' && typeof raw.prev.dir === 'string' ? raw.prev : null
  const out = {
    ...raw,
    version: typeof raw.version === 'string' ? raw.version : null,
    shell: typeof raw.shell === 'number' ? raw.shell : null,
    dir: typeof raw.dir === 'string' ? raw.dir : null,
    prev,
    failedStarts: Number.isInteger(raw.failedStarts) && raw.failedStarts >= 0 ? raw.failedStarts : 0,
    cleanExit: raw.cleanExit !== false,
    skip: Array.isArray(raw.skip) ? raw.skip.filter((s) => typeof s === 'string') : [],
  }
  return out
}

function readCurrent(updatesDir) {
  try {
    return normalizeCurrent(JSON.parse(fs.readFileSync(path.join(updatesDir, 'current.json'), 'utf8')))
  } catch {
    return null
  }
}

function writeCurrentAtomic(updatesDir, cur) {
  fs.mkdirSync(updatesDir, { recursive: true })
  const file = path.join(updatesDir, 'current.json')
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, JSON.stringify(cur))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

const withoutRun = (c) => {
  const { alive: _a, ...rest } = c
  return rest
}

/** 지금 판을 건너뛰고 prev(없으면 내장 판)로. */
function rollback(cur, notice = ROLLBACK_NOTICE) {
  const c = withoutRun(cur)
  const skip = c.version && !c.skip.includes(c.version) ? [...c.skip, c.version] : [...c.skip]
  const bad = c.version
  if (c.prev && c.prev.dir) {
    const { cache: _c, ...rest } = c
    return {
      use: 'prev',
      skip: bad,
      next: { ...rest, version: c.prev.version, shell: c.prev.shell ?? c.shell, dir: c.prev.dir, prev: null, failedStarts: 0, cleanExit: false, skip, notice },
    }
  }
  const { cache: _c, ...rest } = c
  return { use: 'builtin', skip: bad, next: { ...rest, version: null, shell: null, dir: null, prev: null, failedStarts: 0, cleanExit: true, skip, notice } }
}

/**
 * 켤 때 판정. failedStarts = 받은 판으로 켰는데 alive가 오지 않은 횟수.
 * 지난 실행이 alive도 정상 종료(cleanExit)도 없이 끝났으면 하나 더한다. 2가 되면 prev(없으면 내장)로 가고 그 판을 skip.
 * next는 이번 실행을 위해 쓸 상태(cleanExit=false: alive나 정상 종료를 기다림).
 */
function decideStart(curIn) {
  const cur = normalizeCurrent(curIn)
  if (!cur || !cur.dir) return { use: 'builtin', next: cur ? { ...withoutRun(cur), cleanExit: true } : null }
  const lastFailed = curIn.alive !== true && cur.cleanExit === false
  const failedStarts = curIn.alive === true ? 0 : cur.failedStarts + (lastFailed ? 1 : 0)
  if (failedStarts >= 2) return rollback(cur)
  return { use: 'current', next: { ...withoutRun(cur), failedStarts, cleanExit: false } }
}

const markAlive = (cur) => ({ ...withoutRun(cur), failedStarts: 0, cleanExit: true })
/** 사용자가 닫은 실행: 세지 않는다. */
const markClean = (cur) => ({ ...withoutRun(cur), cleanExit: true })
/** 실행 중 실패(render-process-gone·did-fail-load·alive 시간 넘김): 지금 세고, 다음 켤 때 또 세지 않게 cleanExit=true. */
const recordFailure = (cur) => ({ ...withoutRun(cur), failedStarts: (cur.failedStarts || 0) + 1, cleanExit: true })

const BUNDLE_RE = /^v(\d+\.\d+\.\d+)-\d+$/
const bundleVersion = (name) => {
  const m = BUNDLE_RE.exec(name)
  return m ? m[1] : null
}

/**
 * 받은 묶음 폴더 정리: 1.0 미만 묶음과 keep에 없는 묶음을 지운다. protect(지금 쓰는 폴더)는 남긴다.
 * 묶음 폴더(v<버전>-<시각>)가 아닌 것(current.json 등)은 건드리지 않는다. 지운 이름을 돌려준다.
 */
function pruneBundles(updatesDir, keep, protect = null) {
  const keepSet = new Set((keep || []).filter(Boolean))
  const removed = []
  let names = []
  try {
    names = fs.readdirSync(updatesDir)
  } catch {
    return removed
  }
  for (const name of names) {
    const v = bundleVersion(name)
    if (!v || name === protect) continue
    if (keepSet.has(name) && versionGte(v, '1.0.0')) continue
    try {
      fs.rmSync(path.join(updatesDir, name), { recursive: true, force: true })
      removed.push(name)
    } catch {
      /* 다음에 다시 */
    }
  }
  return removed
}

module.exports = {
  CANON_KEYS,
  ROLLBACK_NOTICE,
  MANIFEST_NOTICE,
  EXPIRED_WARNING,
  canonicalUpdate,
  verifySig2,
  verifyInstall,
  buildManifest,
  checkManifest,
  quickStartCheck,
  onRendererGone,
  normalizeCurrent,
  readCurrent,
  writeCurrentAtomic,
  decideStart,
  rollback,
  markAlive,
  markClean,
  recordFailure,
  pruneBundles,
  bundleVersion,
  versionGte,
}
