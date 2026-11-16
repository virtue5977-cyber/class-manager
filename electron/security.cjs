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

module.exports = { CSP, permissionAllowed, createPathRoots, isUserAbsPath }
