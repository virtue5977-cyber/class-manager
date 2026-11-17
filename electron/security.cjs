// 메인 보안 설정(시험됨): 화면 CSP, 권한 허용 목록, 경로 통로(대화상자로 고른 폴더·놓은 파일만).
const path = require('node:path')
const fs = require('node:fs')

/**
 * 사용자가 고른(놓은) 경로로 받을 수 있는 절대 경로인가.
 * Windows: 드라이브 경로(C:\…) 또는 네트워크 공유(\\서버\공유\…, 학교 NAS). \\?\·\\.\·\??\ 장치 경로와 상대·드라이브 상대 경로는 거부.
 * posix: / 로 시작(// 제외).
 */
function isUserAbsPath(p, platform = process.platform) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false
  if (platform === 'win32') {
    if (/^[A-Za-z]:[\\/]/.test(p)) return true
    return /^[\\/]{2}(?![?.][\\/])[^\\/?*:<>|"]+[\\/][^\\/?*:<>|"]+/.test(p)
  }
  return p.startsWith('/') && !p.startsWith('//')
}

// 화면이 직접 부르는 바깥 주소는 AI(Anthropic·Gemini)와 NEIS뿐이다. 구글 API·업데이트는 메인만 부른다.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.anthropic.com https://generativelanguage.googleapis.com https://open.neis.go.kr",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** 노트·누가기록 복사(클립보드 쓰기)만. 마이크·위치·알림 등은 모두 거부. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])
const permissionAllowed = (permission) => ALLOWED_PERMISSIONS.has(permission)

/**
 * 경로 통로. 비교는 실제 경로(realpath, 링크·정션·연결된 드라이브를 따라간 것)끼리 한다. realpath가 실패하면(없는 경로 등) 거부.
 * 네트워크 폴더(UNC·Z:)도 사용자가 대화상자로 고르거나 끌어 놓았으면 허용한다(학교 NAS). 루트(대화상자로 고른 폴더) 안의 폴더와, 따로 등록한 파일(대화상자·끌어 놓기)만 허용한다.
 * 드라이브·UNC 절대 경로만(\\?\·\\.\·상대 경로 거부), `..` 조각이 있으면 정규화 전에 거부한다.
 * Windows는 대소문자를 가리지 않고 / 와 \ 를 같게 본다.
 */
function createPathRoots({ platform = process.platform, roots = [], realpath = (p) => fs.realpathSync.native(p) } = {}) {
  const P = platform === 'win32' ? path.win32 : path.posix
  const win = platform === 'win32'
  const lexical = (p) => {
    if (!isUserAbsPath(p, platform)) return null
    if (p.split(/[\\/]+/).includes('..')) return null
    let n = P.normalize(p)
    if (n.length > P.parse(n).root.length) n = n.replace(/[\\/]+$/, '')
    return n
  }
  // 글자로 확인한 뒤 실제 경로로 바꾸고, 실제 경로도 다시 확인한다(Z:가 \\nas\share로 풀리면 그 UNC로 비교).
  const norm = (p) => {
    const n = lexical(p)
    if (!n) return null
    let real
    try {
      real = realpath(n)
    } catch {
      return null
    }
    return lexical(typeof real === 'string' ? real : '')
  }
  const key = (n) => (win ? n.toLowerCase() : n)
  const under = (k, set) => {
    for (const r of set) {
      if (k === r) return true
      const rel = P.relative(r, k)
      if (rel && !rel.startsWith('..') && !P.isAbsolute(rel)) return true
    }
    return false
  }
  // given: 사용자가 고른 표기(저장·다시 켤 때 다시 풀기용), real: 실제 경로 열쇠, gate: 글자 거르기용(고른 표기 + 실제 경로)
  const given = new Map()
  const realRoots = new Set()
  const rootGate = new Set()
  const files = new Set()
  const fileGate = new Set()
  const addRoot = (dir) => {
    const n = lexical(dir)
    const r = n && norm(n)
    if (!r) return false
    given.set(key(n), n)
    realRoots.add(key(r))
    rootGate.add(key(n)).add(key(r))
    return true
  }
  const addFile = (p) => {
    const n = lexical(p)
    const r = n && norm(n)
    if (!r) return false
    files.add(key(r))
    fileGate.add(key(n)).add(key(r))
    return true
  }
  /** 글자로만: 고른 루트(또는 그 실제 경로) 안인가. 디스크·네트워크에 닿지 않는다. */
  const knownDir = (p) => {
    const n = lexical(p)
    return !!n && under(key(n), rootGate)
  }
  // 글자로 먼저 거른 뒤에만 realpath를 부른다(화면이 보낸 임의의 \\서버 경로에 접속하지 않게).
  const allowDir = (p) => {
    if (!knownDir(p)) return false
    const r = norm(p)
    return !!r && under(key(r), realRoots)
  }
  const allowFile = (p) => {
    const n = lexical(p)
    if (!n || !fileGate.has(key(n))) return false
    const r = norm(n)
    return !!r && files.has(key(r))
  }
  for (const r of Array.isArray(roots) ? roots : []) addRoot(r)
  return { addRoot, addFile, allowDir, allowFile, knownDir, roots: () => [...given.values()] }
}

const ROOTS_MAGIC = Buffer.from('WATSON-ROOTS-DPAPI1\n', 'utf8')

/**
 * path-roots.json(고른 폴더 경로 = 학생 이름이 들어 있을 수 있음) 저장소. safeStorage 비동기 암호화를 쓸 수 있으면
 * 머리표 + 암호문으로 쓰고, 쓸 수 없으면 평문 {roots}로 두고 encrypted: false로 알린다(메인이 코드만 로그).
 * 옛 평문 파일은 읽은 뒤 (암호화할 수 있으면) 곧바로 암호화해 다시 쓴다. 풀 수 없으면 빈 목록(폴더를 다시 고르면 된다).
 */
function createRootsStore({ file, safe, fsp = fs.promises }) {
  let chain = Promise.resolve()
  const queue = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
  const avail = async () => {
    try { return !!(safe && (await safe.isAsyncEncryptionAvailable())) } catch { return false }
  }
  const clean = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  async function writeAtomic(buf) {
    const tmp = file + '.tmp'
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, file)
  }
  async function persist(roots) {
    const json = JSON.stringify({ roots: clean(roots) })
    if (await avail()) {
      try {
        const enc = await safe.encryptStringAsync(json)
        await writeAtomic(Buffer.concat([ROOTS_MAGIC, Buffer.from(enc)]))
        return { encrypted: true }
      } catch { /* 아래: 평문으로 */ }
    }
    await writeAtomic(Buffer.from(json, 'utf8'))
    return { encrypted: false }
  }
  async function load() {
    return queue(async () => {
      let buf
      try { buf = await fsp.readFile(file) } catch { return { roots: [], encrypted: false } }
      if (buf.length >= ROOTS_MAGIC.length && buf.subarray(0, ROOTS_MAGIC.length).equals(ROOTS_MAGIC)) {
        try {
          if (!(await avail())) return { roots: [], encrypted: false }
          const r = await safe.decryptStringAsync(buf.subarray(ROOTS_MAGIC.length))
          const roots = clean(JSON.parse(r && r.result).roots)
          if (r && r.shouldReEncrypt) await persist(roots).catch(() => {})
          return { roots, encrypted: true }
        } catch {
          return { roots: [], encrypted: false }
        }
      }
      let roots
      try { roots = clean(JSON.parse(buf.toString('utf8')).roots) } catch { return { roots: [], encrypted: false } }
      // 옛 평문 파일: 암호화할 수 있으면 곧바로 바꿔 쓴다
      let encrypted = false
      try { encrypted = (await persist(roots)).encrypted } catch { encrypted = false }
      return { roots, encrypted }
    })
  }
  return { load, save: (roots) => queue(() => persist(roots)) }
}

module.exports = { CSP, permissionAllowed, createPathRoots, isUserAbsPath, createRootsStore }
