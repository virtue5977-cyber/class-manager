import { afterEach, beforeEach, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const V = require('../../../electron/vault.cjs') as {
  readVault: (d: string) => { vault: any; source: string; error?: string }
  writeVaultAtomic: (d: string, v: any) => void
  vaultStatus: (d: string, u: (b: string) => Promise<string | null>) => Promise<{ state: string; dekB64?: string; vault?: any }>
  readBackupPublic: (d: string) => any
  validStorePayload: (p: any) => boolean
}

const mk = (n = 'a') => ({
  v: 1, keyId: 'k-' + n, dbName: 'watson-1', dpapi: 'ZHBhcGk=',
  pass: { salt: 's', iter: 600000, iv: 'i', ct: 'c', updatedAt: 't' },
})
let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
const ok = async () => 'DEK'

test('없으면 none', async () => {
  expect((await V.vaultStatus(dir, ok)).state).toBe('none')
})
test('정상 + dpapi 풀림 → ok와 dekB64, dpapi는 공개에서 빠짐', async () => {
  V.writeVaultAtomic(dir, mk())
  const s = await V.vaultStatus(dir, ok)
  expect(s.state).toBe('ok'); expect(s.dekB64).toBe('DEK')
  expect(s.vault.dpapi).toBeUndefined(); expect(s.vault.pass.salt).toBe('s')
})
test('dpapi 풀기 실패/없음 → needs-pass', async () => {
  V.writeVaultAtomic(dir, mk())
  expect((await V.vaultStatus(dir, async () => null)).state).toBe('needs-pass')
  expect((await V.vaultStatus(dir, async () => { throw new Error('x') })).state).toBe('needs-pass')
  const { dpapi: _d, ...noDp } = mk()
  V.writeVaultAtomic(dir, noDp)
  expect((await V.vaultStatus(dir, ok)).state).toBe('needs-pass')
})
test('main 손상 → .bak로 읽고 source bak', async () => {
  V.writeVaultAtomic(dir, mk('1'))
  V.writeVaultAtomic(dir, mk('2'))
  fs.writeFileSync(path.join(dir, 'vault.json'), '{broken')
  const r = V.readVault(dir)
  expect(r.source).toBe('bak'); expect(r.vault.keyId).toBe('k-1')
  expect((await V.vaultStatus(dir, ok)).state).toBe('ok')
  expect((await V.vaultStatus(dir, async () => null)).state).toBe('needs-pass')
})
test('둘 다 손상(또는 형식 틀림) → broken', async () => {
  fs.writeFileSync(path.join(dir, 'vault.json'), 'x')
  fs.writeFileSync(path.join(dir, 'vault.json.bak'), JSON.stringify({ v: 1, keyId: 'a' }))
  expect((await V.vaultStatus(dir, ok)).state).toBe('broken')
})
test('writeVaultAtomic 뒤 .bak는 이전 내용, tmp는 남지 않음', () => {
  V.writeVaultAtomic(dir, mk('1'))
  expect(fs.existsSync(path.join(dir, 'vault.json.bak'))).toBe(false)
  V.writeVaultAtomic(dir, mk('2'))
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'vault.json'), 'utf8')).keyId).toBe('k-2')
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'vault.json.bak'), 'utf8')).keyId).toBe('k-1')
  expect(fs.existsSync(path.join(dir, 'vault.json.tmp'))).toBe(false)
  expect(V.readBackupPublic(dir).dpapi).toBeUndefined()
})
// ---- fix round 1 ----
const V2 = V as any
const b64 = (n: number) => Buffer.alloc(n, 7).toString('base64')
const UUID = '1a2b3c4d-1111-4222-8333-444455556666'
const goodPayload = (over: any = {}) => ({
  v: 1, keyId: UUID, dbName: 'watson-1a2b3c4d',
  pass: { salt: b64(16), iter: 600000, iv: b64(12), ct: b64(48), updatedAt: '2026-01-01T00:00:00Z' },
  dekB64: b64(32), ...over,
})
const fakeSafe = (o: any = {}) => ({
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (s: string) => Buffer.from('E:' + s),
  decryptStringAsync: async (b: Buffer) => ({ result: b.toString().replace(/^E:/, ''), shouldReEncrypt: false }),
  ...o,
})

test('C1 손상된 main 위에 store해도 좋은 .bak를 지킨다', () => {
  V.writeVaultAtomic(dir, mk('good'))
  V.writeVaultAtomic(dir, mk('x')) // bak = good
  fs.writeFileSync(path.join(dir, 'vault.json'), '{garbage')
  V.writeVaultAtomic(dir, mk('new'))
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'vault.json.bak'), 'utf8')).keyId).toBe('k-good')
  expect(V.readVault(dir).vault.keyId).toBe('k-new')
})
test('C1 store 뒤 main은 유효, .bak는 직전 유효 main', () => {
  V.writeVaultAtomic(dir, mk('1'))
  V.writeVaultAtomic(dir, mk('2'))
  expect(V.readVault(dir)).toMatchObject({ source: 'main' })
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'vault.json.bak'), 'utf8')).keyId).toBe('k-1')
})

test('I1 queue는 순서대로 하나씩 돌고 실패해도 이어진다', async () => {
  const q = V2.makeQueue()
  const log: string[] = []
  const slow = q(async () => { await new Promise((r) => setTimeout(r, 30)); log.push('a') })
  const bad = q(async () => { log.push('b'); throw new Error('x') })
  const c = q(async () => { log.push('c'); return 5 })
  await expect(bad).rejects.toThrow()
  expect(await c).toBe(5); await slow
  expect(log).toEqual(['a', 'b', 'c'])
})
test('I1 재감싸기는 느려도 동시 store를 덮지 않는다(keyId 보호)', async () => {
  const slowSafe = fakeSafe({
    decryptStringAsync: async (b: Buffer) => ({ result: b.toString().replace(/^E:/, ''), shouldReEncrypt: true }),
    encryptStringAsync: async (s: string) => { await new Promise((r) => setTimeout(r, 40)); return Buffer.from('E:' + s) },
  })
  const h = V2.createVaultHandlers(dir, slowSafe)
  await h.store(goodPayload())
  const h2 = V2.createVaultHandlers(dir, { ...slowSafe, decryptStringAsync: slowSafe.decryptStringAsync })
  const p1 = h2.unlockDpapi()
  const newId = '9a2b3c4d-1111-4222-8333-444455556666'
  const p2 = h2.store(goodPayload({ keyId: newId, dbName: 'watson-9a2b3c4d' }))
  await Promise.all([p1, p2])
  const r = V.readVault(dir)
  expect(r.vault.keyId).toBe(newId)
})
test('I3 store는 렌더러의 dpapi를 버리고 safe로 채운다', async () => {
  const h = V2.createVaultHandlers(dir, fakeSafe())
  await h.store(goodPayload({ dpapi: 'EVIL' }))
  const v = V.readVault(dir).vault
  expect(v.dpapi).toBe(Buffer.from('E:' + b64(32)).toString('base64'))
  expect(v.dekB64).toBeUndefined()
})
test('I3 async 암호화 불가 → dpapi 없이 쓰고 needs-pass', async () => {
  const h = V2.createVaultHandlers(dir, fakeSafe({ isAsyncEncryptionAvailable: async () => false }))
  await h.store(goodPayload({ dpapi: 'EVIL' }))
  expect(V.readVault(dir).vault.dpapi).toBeUndefined()
  expect((await h.status()).state).toBe('needs-pass')
})
test('I3 status는 dpapi를 돌려주지 않고 ok면 dek를 준다', async () => {
  const h = V2.createVaultHandlers(dir, fakeSafe())
  await h.store(goodPayload())
  const s = await h.status()
  expect(s.state).toBe('ok'); expect(s.dekB64).toBe(b64(32)); expect(s.vault.dpapi).toBeUndefined()
  expect(await h.unlockDpapi()).toBe(b64(32))
  expect(h.readBackup()).toBeNull()
})
test('I3 shouldReEncrypt면 큐로 dpapi를 다시 쓴다', async () => {
  let n = 0
  const h = V2.createVaultHandlers(dir, fakeSafe({
    encryptStringAsync: async (s: string) => Buffer.from(`E${++n}:` + s),
    decryptStringAsync: async (b: Buffer) => ({ result: b.toString().replace(/^E\d*:/, ''), shouldReEncrypt: n === 1 }),
  }))
  await h.store(goodPayload())
  const before = V.readVault(dir).vault.dpapi
  expect(await h.unlockDpapi()).toBe(b64(32))
  const after = V.readVault(dir).vault.dpapi
  expect(after).not.toBe(before)
})
test('M3 오류에 경로가 없고 고정 문구', async () => {
  const h = V2.createVaultHandlers(path.join(dir, 'nofile.txt', 'sub'), fakeSafe())
  fs.writeFileSync(path.join(dir, 'nofile.txt'), 'x')
  await expect(h.store(goodPayload())).rejects.toThrow('열쇠 파일을 저장하지 못했습니다')
  await expect(h.store({ nope: 1 })).rejects.toThrow('열쇠 형식이 맞지 않습니다')
})

test.each([
  ['v', { v: 2 }], ['keyId 형식', { keyId: 'abc' }], ['dbName 형식', { dbName: 'watson-XYZ' }],
  ['dek 길이', { dekB64: b64(16) }], ['dek 문자', { dekB64: '!!!' }],
  ['pass.iter 작음', { pass: { salt: b64(16), iter: 10, iv: b64(12), ct: b64(48), updatedAt: 't' } }],
  ['pass.salt 비base64', { pass: { salt: '***', iter: 600000, iv: b64(12), ct: b64(48), updatedAt: 't' } }],
  ['pass.updatedAt 없음', { pass: { salt: b64(16), iter: 600000, iv: b64(12), ct: b64(48) } }],
  ['recovery 틀림', { recovery: { salt: 'a', iter: 1.5, iv: 'b', ct: 'c' } }],
  ['알 수 없는 키', { extra: 1 }],
  ['너무 큼', { pass: { salt: b64(16), iter: 600000, iv: b64(12), ct: 'A'.repeat(20000), updatedAt: 't' } }],
])('I2 거부: %s', (_n, over) => {
  expect(V.validStorePayload(goodPayload(over))).toBe(false)
})
test('I2 올바른 payload(recovery 포함, dpapi는 허용·무시)', () => {
  expect(V.validStorePayload(goodPayload())).toBe(true)
  expect(V.validStorePayload(goodPayload({ recovery: { salt: b64(16), iter: 100000, iv: b64(12), ct: b64(48) }, dpapi: 'x' }))).toBe(true)
})

test('I2 dbName은 watson-<keyId 앞 8자>와 같아야 한다', () => {
  expect(V.validStorePayload(goodPayload({ dbName: 'watson-deadbeef' }))).toBe(false)
  expect(V.validStorePayload(goodPayload({ keyId: '9a2b3c4d-1111-4222-8333-444455556666' }))).toBe(false)
  expect(V.validStorePayload(goodPayload({ keyId: '9a2b3c4d-1111-4222-8333-444455556666', dbName: 'watson-9a2b3c4d' }))).toBe(true)
})

test('I1b decrypt가 걸린 사이 새 store가 끝나면 재감싸기는 새 dpapi를 덮지 않는다', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let hold = false
  const safe = fakeSafe({
    decryptStringAsync: async (b: Buffer) => {
      const out = { result: b.toString().replace(/^E:/, ''), shouldReEncrypt: true }
      if (hold) await gate
      return out
    },
  })
  const h = V2.createVaultHandlers(dir, safe)
  await h.store(goodPayload())
  hold = true
  const pending = h.unlockDpapi() // 옛 blob을 푸는 중
  const newId = '9a2b3c4d-1111-4222-8333-444455556666'
  const newDek = Buffer.alloc(32, 9).toString('base64')
  await h.store(goodPayload({ keyId: newId, dbName: 'watson-9a2b3c4d', dekB64: newDek }))
  const newDpapi = V.readVault(dir).vault.dpapi
  release(); await pending
  const v = V.readVault(dir).vault
  expect(v.keyId).toBe(newId)
  expect(v.dpapi).toBe(newDpapi)
})
