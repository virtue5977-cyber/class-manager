// 열쇠(vault) 보관 파일: 순수 fs 함수. DPAPI 풀기는 주입한다(시험에서 Electron 없이 돈다).
const fs = require('node:fs')
const path = require('node:path')

const MAIN = 'vault.json'
const BAK = 'vault.json.bak'
const TMP = 'vault.json.tmp'

function validVault(v) {
  return !!v && typeof v === 'object' && v.v === 1 && typeof v.keyId === 'string' && !!v.keyId &&
    typeof v.dbName === 'string' && !!v.dbName && !!v.pass && typeof v.pass === 'object'
}

function parseFile(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return validVault(v) ? { vault: v } : { error: '형식이 맞지 않습니다.' }
  } catch (e) {
    return { error: e && e.code === 'ENOENT' ? 'missing' : '읽을 수 없습니다.' }
  }
}

function readVault(dir) {
  const m = parseFile(path.join(dir, MAIN))
  if (m.vault) return { vault: m.vault, source: 'main' }
  const b = parseFile(path.join(dir, BAK))
  if (b.vault) return { vault: b.vault, source: 'bak' }
  const mainMissing = m.error === 'missing'
  const bakMissing = b.error === 'missing'
  if (mainMissing && bakMissing) return { vault: null, source: 'none' }
  return { vault: null, source: 'none', error: m.error && !mainMissing ? m.error : b.error }
}

function writeVaultAtomic(dir, v) {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, TMP)
  const main = path.join(dir, MAIN)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(v))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  if (fs.existsSync(main)) fs.copyFileSync(main, path.join(dir, BAK))
  fs.renameSync(tmp, main)
}

function publicOf(v) {
  const { dpapi, ...rest } = v
  return rest
}

async function vaultStatus(dir, unwrapDpapi) {
  const r = readVault(dir)
  if (!r.vault) return { state: r.error ? 'broken' : 'none' }
  const vault = publicOf(r.vault)
  if (typeof r.vault.dpapi === 'string' && r.vault.dpapi) {
    let dek = null
    try { dek = await unwrapDpapi(r.vault.dpapi) } catch { dek = null }
    if (dek) return { state: 'ok', dekB64: dek, vault }
  }
  return { state: 'needs-pass', vault }
}

/** .bak 파일의 공개 열쇠(없거나 깨졌으면 null) */
function readBackupPublic(dir) {
  const b = parseFile(path.join(dir, BAK))
  return b.vault ? publicOf(b.vault) : null
}

/** store 입력 검사: dpapi 뺀 vault + dekB64 */
function validStorePayload(p) {
  return validVault(p) && typeof p.dekB64 === 'string' && p.dekB64.length > 0 && p.dekB64.length < 200 &&
    !!p.pass.salt && !!p.pass.iv && !!p.pass.ct
}

module.exports = { MAIN, BAK, TMP, validVault, readVault, writeVaultAtomic, vaultStatus, readBackupPublic, publicOf, validStorePayload }
