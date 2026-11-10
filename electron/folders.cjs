// 노트 폴더 연결: 디렉터리만 열고, 목록은 이름만(최대 200개).
const fs = require('node:fs/promises')
const path = require('node:path')

async function assertDir(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('폴더를 찾지 못했습니다.')
  const st = await fs.stat(p).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error('폴더를 찾지 못했습니다.')
  return path.normalize(p)
}

async function listDir(p) {
  const dir = await assertDir(p)
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

module.exports = { assertDir, listDir, pdfPageSize }
