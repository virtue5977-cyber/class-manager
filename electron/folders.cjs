// 노트 폴더 연결: 디렉터리만 열고, 목록은 이름만(최대 200개).
const fs = require('node:fs/promises')
const path = require('node:path')

/** 이 컴퓨터의 경로만: Windows는 'C:\…' 꼴(드라이브 문자)만. \\서버·\\?\·\??\ 경로는 열면
 * 윈도가 그 서버에 로그인 정보를 보낼 수 있어 막는다. 상대 경로도 막는다. */
function isLocalPath(p, platform = process.platform) {
  if (typeof p !== 'string' || !p) return false
  if (/^[\\/]{2}|^\\\?\?\\/.test(p)) return false
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(p)
  return path.posix.isAbsolute(p)
}

/** network: 메인이 허용 목록(사용자가 고른 폴더)으로 이미 확인한 경로면 네트워크 공유(학교 NAS)도 연다. */
async function assertDir(p, { network = false } = {}) {
  if (network) {
    if (!require('./security.cjs').isUserAbsPath(p)) throw new Error('폴더를 찾지 못했습니다.')
  } else {
    if (typeof p === 'string' && (/^[\\/]{2}/.test(p) || /^\\\?\?\\/.test(p))) throw new Error('네트워크 폴더는 연결할 수 없습니다.')
    if (!isLocalPath(p)) throw new Error('폴더를 찾지 못했습니다.')
  }
  const st = await fs.stat(p).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error('폴더를 찾지 못했습니다.')
  return path.normalize(p)
}

async function listDir(p, opts) {
  const dir = await assertDir(p, opts)
  const ents = await fs.readdir(dir, { withFileTypes: true })
  return ents
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'ko'))
    .slice(0, 200)
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
}

/** printToPDF 용지: A4 기본, B4는 257×364mm(인치) */
function pdfPageSize(opts) {
  return opts && opts.pageSize === 'B4' ? { width: 257 / 25.4, height: 364 / 25.4 } : 'A4'
}

module.exports = { isLocalPath, assertDir, listDir, pdfPageSize }
