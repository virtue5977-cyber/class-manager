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

function fsyncPath(file) {
  const fd = fs.openSync(file, 'r+')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function writeVaultAtomic(dir, v) {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, TMP)
  const main = path.join(dir, MAIN)
  const bak = path.join(dir, BAK)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(v))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  // 지금 main이 유효할 때만 .bak로 돌린다. 깨진 main이 좋은 .bak를 덮으면 안 된다.
  if (parseFile(main).vault) {
    fs.copyFileSync(main, bak)
    try { fsyncPath(bak) } catch { /* 플랫폼에 따라 불가 */ }
  }
  fs.renameSync(tmp, main)
  try {
    const dfd = fs.openSync(dir, 'r')
    try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
  } catch { /* Windows는 폴더를 열 수 없다 */ }
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

const B64 = /^[A-Za-z0-9+/]+={0,2}$/
const isB64 = (x) => typeof x === 'string' && x.length > 0 && x.length < 8192 && x.length % 4 === 0 && B64.test(x)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// dbName = 'watson-' + keyId 앞 8자(계획 Global Constraints). keyId는 소문자 uuid.
const DBNAME = /^watson-[0-9a-f]{8}$/
const TOP_KEYS = new Set(['v', 'keyId', 'dbName', 'pass', 'recovery', 'dekB64', 'dpapi'])
const wrapOk = (w, needUpdatedAt) => !!w && typeof w === 'object' && !Array.isArray(w) &&
  isB64(w.salt) && isB64(w.iv) && isB64(w.ct) && Number.isInteger(w.iter) && w.iter >= 100000 && w.iter <= 10000000 &&
  (!needUpdatedAt || (typeof w.updatedAt === 'string' && w.updatedAt.length > 0 && w.updatedAt.length < 64))

/** store 입력 검사: dpapi 뺀 vault + dekB64 (dpapi가 와도 무시한다) */
function validStorePayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  if (!Object.keys(p).every((k) => TOP_KEYS.has(k))) return false
  if (p.v !== 1 || typeof p.keyId !== 'string' || !UUID.test(p.keyId)) return false
  if (typeof p.dbName !== 'string' || !DBNAME.test(p.dbName) || p.dbName !== 'watson-' + p.keyId.slice(0, 8)) return false
  if (!wrapOk(p.pass, true)) return false
  if (p.recovery !== undefined && !wrapOk(p.recovery, false)) return false
  if (!isB64(p.dekB64) || Buffer.from(p.dekB64, 'base64').length !== 32) return false
  if (p.dpapi !== undefined && typeof p.dpapi !== 'string') return false
  try { if (JSON.stringify(p).length >= 16384) return false } catch { return false }
  return true
}

/** 쓰기를 한 줄로 세운다. 앞 작업이 실패해도 다음은 돈다. */
function makeQueue() {
  let tail = Promise.resolve()
  return (job) => {
    const run = tail.then(job)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}

const MSG_FORMAT = '열쇠 형식이 맞지 않습니다.'
const MSG_SAVE = '열쇠 파일을 저장하지 못했습니다.'

/** IPC 본체. safe = {isAsyncEncryptionAvailable, encryptStringAsync, decryptStringAsync} (electron safeStorage) */
function createVaultHandlers(dir, safe) {
  const queue = makeQueue()
  async function wrap(dekB64) {
    try {
      if (!(await safe.isAsyncEncryptionAvailable())) return undefined
      return Buffer.from(await safe.encryptStringAsync(dekB64)).toString('base64')
    } catch { return undefined }
  }
  // 풀기. shouldReEncrypt면 다시 풀어 새 값을 받고, 큐 안에서 같은 keyId일 때만 dpapi를 갈아 끼운다.
  async function unwrap(b64) {
    try {
      if (!(await safe.isAsyncEncryptionAvailable())) return null
      const buf = Buffer.from(b64, 'base64')
      const first = await safe.decryptStringAsync(buf)
      let dek = first.result
      if (typeof dek !== 'string' || !dek) return null
      if (first.shouldReEncrypt) {
        const startKeyId = (readVault(dir).vault || {}).keyId
        try {
          await queue(async () => {
            const cur = readVault(dir)
            if (!cur.vault || cur.source !== 'main' || cur.vault.keyId !== startKeyId) return
            const dp = await wrap(dek)
            const again = readVault(dir) // 감싸는 동안 바뀌었는지 다시 본다
            if (!dp || !again.vault || again.source !== 'main' || again.vault.keyId !== startKeyId) return
            writeVaultAtomic(dir, { ...again.vault, dpapi: dp })
          })
        } catch { /* 재감싸기 실패는 열기를 막지 않는다 */ }
      }
      return dek
    } catch { return null }
  }
  return {
    status: () => vaultStatus(dir, unwrap),
    async unlockDpapi() {
      const r = readVault(dir)
      return r.vault && typeof r.vault.dpapi === 'string' && r.vault.dpapi ? unwrap(r.vault.dpapi) : null
    },
    readBackup: () => readBackupPublic(dir),
    async store(p) {
      if (!validStorePayload(p)) throw new Error(MSG_FORMAT)
      const { dekB64, dpapi: _ignored, ...rest } = p
      try {
        await queue(async () => {
          const dpapi = await wrap(dekB64)
          writeVaultAtomic(dir, dpapi ? { ...rest, dpapi } : rest)
        })
      } catch { throw new Error(MSG_SAVE) }
      return true
    },
  }
}

module.exports = { MAIN, BAK, TMP, validVault, readVault, writeVaultAtomic, vaultStatus, readBackupPublic, publicOf, validStorePayload, makeQueue, createVaultHandlers }
