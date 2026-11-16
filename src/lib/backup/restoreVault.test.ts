// @vitest-environment node
import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import { createMemoryFolder } from '../fs/memory'
import { setupPassphrase, runBackup, getCachedKey } from './service'
import { restoreIntoNewVault } from './restoreVault'
import { openVaultDb } from '../vault/vaultDb'
import { unwrapDek, passKeyRaw, recoveryKeyRaw, type VaultPayload } from '../vault/keys'
import { fromBase64 } from './crypto'
import { BackupDecryptError } from './errors'
import Dexie from 'dexie'

const PASS = '우리반암호구2026'
const cls = (grade: number) => newRecord({ school_year: 2026, grade, class_no: 5 })

async function backup() {
  const db = createDb('src-' + crypto.randomUUID())
  await setupPassphrase(db, PASS, { iterations: 1000 })
  await db.classes.add(cls(3))
  const folder = createMemoryFolder()
  const name = await runBackup(db, folder)
  return { bytes: await folder.readFile(name) }
}

test('restoreIntoNewVault: 새 vault DB에 채우고 vault.store를 부른다', async () => {
  const { bytes } = await backup()
  let payload: VaultPayload | undefined
  const r = await restoreIntoNewVault(bytes, PASS, { store: async (p) => { payload = p as VaultPayload } })
  expect(payload).toBeDefined()
  expect(r.dbName).toMatch(/^watson-/)
  expect(payload!.dbName).toBe(r.dbName)
  const dek = fromBase64(payload!.dekB64)
  // 암호구·복구 코드 모두 같은 DEK를 연다
  const pk = await passKeyRaw(PASS, fromBase64(payload!.pass.salt), payload!.pass.iter)
  expect(unwrapDek(payload!.pass, pk, payload!.keyId, 'pass')).toEqual(dek)
  const rk = await recoveryKeyRaw(r.recoveryCode, fromBase64(payload!.recovery!.salt), payload!.recovery!.iter)
  expect(unwrapDek(payload!.recovery!, rk, payload!.keyId, 'recovery')).toEqual(dek)
  const db = openVaultDb(r.dbName, dek)
  expect((await db.classes.toArray()).map((c) => c.grade)).toEqual([3])
  expect((await db.meta.get('vault'))?.complete).toBe(true)
  const cached = await getCachedKey(db)
  expect(cached?.iterations).toBe(payload!.pass.iter)
  db.close()
})

test('틀린 암호구는 거부하고 아무것도 만들지 않는다', async () => {
  const { bytes } = await backup()
  const store = vi.fn()
  const before = (await Dexie.getDatabaseNames()).length
  await expect(restoreIntoNewVault(bytes, '틀린암호구입니다만', { store })).rejects.toBeInstanceOf(BackupDecryptError)
  expect(store).not.toHaveBeenCalled()
  expect((await Dexie.getDatabaseNames()).length).toBe(before)
})

test('store가 실패하면 새 DB를 지우고 오류를 올린다', async () => {
  const { bytes } = await backup()
  const before = new Set(await Dexie.getDatabaseNames())
  await expect(restoreIntoNewVault(bytes, PASS, { store: async () => { throw new Error('boom') } })).rejects.toThrow('boom')
  const after = await Dexie.getDatabaseNames()
  expect(after.filter((n) => !before.has(n))).toEqual([])
})
