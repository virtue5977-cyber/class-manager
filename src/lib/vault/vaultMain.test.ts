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
test('store 입력 검사', () => {
  const { dpapi: _d, ...p } = mk()
  expect(V.validStorePayload({ ...p, dekB64: 'abc' })).toBe(true)
  expect(V.validStorePayload(p)).toBe(false)
  expect(V.validStorePayload(null)).toBe(false)
  expect(V.validStorePayload({ ...p, dekB64: 5 })).toBe(false)
})
