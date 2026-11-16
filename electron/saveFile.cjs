// '다른 이름으로 저장': 대화 상자(주입) → 임시 파일 쓰기 → fsync → 이름 바꾸기 → 다시 읽은 크기 확인.
// 옮기기 마법사의 '새 백업 파일 있음' 증거는 여기서 { ok: true }가 올 때만 선다(취소·실패는 { ok: false }).
const nodeFs = require('node:fs')
const path = require('node:path')

const MAX_BYTES = 1024 * 1024 * 1024
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/

function validName(n) {
  return typeof n === 'string' && n.length > 0 && n.length <= 200 && !BAD_NAME.test(n) && n !== '.' && n !== '..'
}

function toBuffer(b) {
  if (Buffer.isBuffer(b)) return b
  if (b instanceof Uint8Array) return Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  return null
}

/** deps: { showSaveDialog({ defaultName }) → { canceled, filePath }, fs? } */
function createSaveAs(deps) {
  const fs = deps.fs || nodeFs
  return async function saveAs(defaultName, bytes) {
    const buf = toBuffer(bytes)
    if (!validName(defaultName) || !buf || buf.length === 0 || buf.length > MAX_BYTES) return { ok: false }
    let target
    try {
      const r = await deps.showSaveDialog({ defaultName })
      if (!r || r.canceled || typeof r.filePath !== 'string' || !r.filePath) return { ok: false }
      target = r.filePath
    } catch { return { ok: false } }
    const tmp = target + '.tmp-' + process.pid + '-' + Date.now()
    try {
      const fd = fs.openSync(tmp, 'w')
      try {
        fs.writeFileSync(fd, buf)
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(tmp, target)
      if (fs.statSync(target).size !== buf.length) return { ok: false }
      return { ok: true, name: path.basename(target) }
    } catch {
      try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
      return { ok: false }
    }
  }
}

module.exports = { createSaveAs, validName }
