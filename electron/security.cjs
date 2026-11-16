// 메인 보안 설정(시험됨): 화면 CSP, 권한 허용 목록, 경로 통로(대화상자로 고른 폴더·놓은 파일만).
const path = require('node:path')
const fs = require('node:fs')
const { isLocalPath } = require('./folders.cjs')

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
 * 경로 통로. 비교는 실제 경로(realpath, 링크·정션을 따라간 것)로 한다. realpath가 실패하면(없는 경로 등) 거부. 루트(대화상자로 고른 폴더) 안의 폴더와, 따로 등록한 파일(대화상자·끌어 놓기)만 허용한다.
 * 이 컴퓨터의 절대 경로만(UNC·\\?\·상대 경로 거부), `..` 조각이 있으면 정규화 전에 거부한다.
 * Windows는 대소문자를 가리지 않고 / 와 \ 를 같게 본다.
 */
function createPathRoots({ platform = process.platform, roots = [], realpath = (p) => fs.realpathSync.native(p) } = {}) {
  const P = platform === 'win32' ? path.win32 : path.posix
  const win = platform === 'win32'
  const lexical = (p) => {
    if (!isLocalPath(p, platform)) return null
    if (p.split(/[\\/]+/).includes('..')) return null
    let n = P.normalize(p)
    if (n.length > P.parse(n).root.length) n = n.replace(/[\\/]+$/, '')
    return n
  }
  // 글자로 확인한 뒤 실제 경로로 바꾸고, 실제 경로도 다시 확인한다(네트워크 드라이브가 UNC로 풀리면 거부).
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
  const rootList = new Map() // key → 원래 표기
  const files = new Set()
  const addRoot = (dir) => {
    const n = norm(dir)
    if (!n) return false
    rootList.set(key(n), n)
    return true
  }
  const addFile = (p) => {
    const n = norm(p)
    if (!n) return false
    files.add(key(n))
    return true
  }
  const allowDir = (p) => {
    const n = norm(p)
    if (!n) return false
    const k = key(n)
    for (const r of rootList.keys()) {
      if (k === r) return true
      const rel = P.relative(r, k)
      if (rel && !rel.startsWith('..') && !P.isAbsolute(rel)) return true
    }
    return false
  }
  const allowFile = (p) => {
    const n = norm(p)
    return !!n && files.has(key(n))
  }
  for (const r of Array.isArray(roots) ? roots : []) addRoot(r)
  return { addRoot, addFile, allowDir, allowFile, roots: () => [...rootList.values()] }
}

module.exports = { CSP, permissionAllowed, createPathRoots }
