// @vitest-environment node
import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import { createMemoryFolder } from '../fs/memory'
import {
  backupFileName, setupPassphrase, getCachedKey, runBackup, rotateBackups, restoreFromBytes,
  needsAutoBackup, getLastBackupAt, BACKUP_KEEP_DEFAULT,
} from './service'
import { BackupDecryptError, BackupFormatError, BackupVersionError } from './errors'
import { exportSnapshot, serializeSnapshot } from './snapshot'
import { VAULT_MODE } from '../../test/vaultMode'
import { deriveKey, encrypt } from './crypto'
import { encodeBackupFile, encodeHeader } from './format'

const IT = { iterations: 1000 }
const PASS = '우리반암호구2026'
const testDb = () => createDb('test-' + crypto.randomUUID())
const cls = (grade: number) => newRecord({ school_year: 2026, grade, class_no: 5 })

async function ready() {
  const db = testDb()
  await setupPassphrase(db, PASS, IT)
  await db.classes.add(cls(1))
  const folder = createMemoryFolder()
  return { db, folder }
}

test('파일명 형식', () => {
  expect(backupFileName(new Date(2026, 10, 4, 9, 5), new Set())).toBe('백업_20261104_0905.enc')
})

test('같은 분 충돌 시 _2, _3', () => {
  const t = new Date(2026, 10, 4, 9, 5)
  expect(backupFileName(t, new Set(['백업_20261104_0905.enc']))).toBe('백업_20261104_0905_2.enc')
  expect(backupFileName(t, new Set(['백업_20261104_0905.enc', '백업_20261104_0905_2.enc']))).toBe('백업_20261104_0905_3.enc')
})

test('8자 미만 암호구 거부', async () => {
  await expect(setupPassphrase(testDb(), '1234567', IT)).rejects.toThrow('암호구는 8자 이상이어야 합니다.')
})

test('백업 후 같은 암호구로 복원하면 데이터가 같다', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  await db.classes.clear()
  await db.classes.add(cls(9))
  await restoreFromBytes(db, await folder.readFile(name), PASS, { safety: { folder } })
  expect((await db.classes.toArray()).map((c) => c.grade)).toEqual([1])
})

test('다른 기기 시나리오: 새 DB에서 암호구만으로 복원된다', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  const other = testDb()
  expect(await getCachedKey(other)).toBeNull()
  await restoreFromBytes(other, await folder.readFile(name), PASS)
  expect((await other.classes.toArray()).map((c) => c.grade)).toEqual([1])
})

test('틀린 암호구 복원 → BackupDecryptError, 데이터 그대로', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  await db.classes.add(cls(2))
  await expect(restoreFromBytes(db, await folder.readFile(name), '틀린암호구입니다')).rejects.toBeInstanceOf(BackupDecryptError)
  expect(await db.classes.count()).toBe(2)
})

test('잘린 파일 복원 → BackupFormatError, 데이터 그대로', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  const bytes = (await folder.readFile(name)).slice(0, 40)
  await expect(restoreFromBytes(db, bytes, PASS)).rejects.toBeInstanceOf(BackupFormatError)
  expect(await db.classes.count()).toBe(1)
})

test('복원 전에 안전 백업 파일이 하나 생긴다', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder, { now: new Date(2026, 10, 4, 9, 0) })
  const bytes = await folder.readFile(name)
  await restoreFromBytes(db, bytes, PASS, { safety: { folder }, now: new Date(2026, 10, 4, 10, 0) })
  expect((await folder.listFiles()).sort()).toEqual(['백업_20261104_0900.enc', '복원전_20261104_1000.enc'])
})

test('복원 후 device_local의 aiApiKey와 backupKey가 유지된다', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  await db.device_local.put({ id: 'aiApiKey', value: 'sk-local' })
  await restoreFromBytes(db, await folder.readFile(name), PASS, { safety: { folder } })
  expect((await db.device_local.get('aiApiKey'))?.value).toBe('sk-local')
  expect(await getCachedKey(db)).not.toBeNull()
})

test('15번째 백업 때 가장 오래된 파일 하나가 지워지고, 이름 규칙에 안 맞는 파일은 남는다', async () => {
  const { db, folder } = await ready()
  await folder.writeFile('메모.txt', new Uint8Array(1))
  for (let i = 0; i < 15; i++) await runBackup(db, folder, { now: new Date(2026, 10, 1 + i, 9, 0) })
  const files = await folder.listFiles()
  expect(files.filter((f) => f.startsWith('백업_'))).toHaveLength(BACKUP_KEEP_DEFAULT)
  expect(files).not.toContain('백업_20261101_0900.enc')
  expect(files).toContain('백업_20261115_0900.enc')
  expect(files).toContain('메모.txt')
})

test('정리: 지난 날은 날마다 마지막 하나(_2보다 _10이 최신), 최근 날 수만큼', async () => {
  const folder = createMemoryFolder()
  for (const n of ['백업_20261104_0900_2.enc', '백업_20261104_0900.enc', '백업_20261104_0900_10.enc', '백업_20261103_2359.enc', '백업_20261105_0800.enc']) {
    await folder.writeFile(n, new Uint8Array(1))
  }
  const removed = await rotateBackups(folder, 2)
  expect(removed.sort()).toEqual(['백업_20261103_2359.enc', '백업_20261104_0900.enc', '백업_20261104_0900_2.enc'])
  expect((await folder.listFiles()).sort()).toEqual(['백업_20261104_0900_10.enc', '백업_20261105_0800.enc'])
})

test('정리: 하루에 여러 번 백업해도 지난 날 백업이 밀려나지 않는다(오늘 것은 모두 남김)', async () => {
  const folder = createMemoryFolder()
  for (let d = 1; d <= 3; d++) await folder.writeFile(`백업_2026110${d}_0900.enc`, new Uint8Array(1))
  for (let i = 0; i < 14; i++) await folder.writeFile(`백업_20261104_${String(1000 + i)}.enc`, new Uint8Array(1))
  await rotateBackups(folder, 14)
  const files = await folder.listFiles()
  expect(files).toHaveLength(17)
  expect(files).toContain('백업_20261101_0900.enc')
})

test('runBackup은 lastBackupAt을 갱신한다', async () => {
  const { db, folder } = await ready()
  expect(await getLastBackupAt(db)).toBeUndefined()
  const now = new Date('2026-11-05T00:30:00Z')
  await runBackup(db, folder, { now })
  expect(await getLastBackupAt(db)).toBe(now.toISOString())
})

test('needsAutoBackup: 없음 true, 23시간 false, 24시간 true', () => {
  const now = new Date('2026-11-05T12:00:00Z')
  expect(needsAutoBackup(undefined, now)).toBe(true)
  expect(needsAutoBackup('2026-11-04T13:00:00.000Z', now)).toBe(false)
  expect(needsAutoBackup('2026-11-04T12:00:00.000Z', now)).toBe(true)
})

test('키 없이 runBackup → 오류', async () => {
  await expect(runBackup(testDb(), createMemoryFolder())).rejects.toThrow('백업 암호구가 설정되지 않았습니다.')
})

async function fileWithSchemaVersion(db: ReturnType<typeof testDb>, schemaVersion: number) {
  const cached = (await getCachedKey(db))!
  const header = { formatVersion: 1 as const, iterations: cached.iterations, salt: cached.salt }
  const snap = { ...(await exportSnapshot(db)), schemaVersion }
  const { iv, ciphertext } = await encrypt(cached.key, serializeSnapshot(snap), encodeHeader(header))
  return encodeBackupFile(header, iv, ciphertext)
}

test('더 새로운 버전 백업은 안전 백업·정리 전에 거부되어 기존 백업 파일이 그대로다', async () => {
  const { db, folder } = await ready()
  for (let i = 0; i < 14; i++) await runBackup(db, folder, { now: new Date(2026, 10, 1 + i, 9, 0) })
  const before = (await folder.listFiles()).sort()
  const bad = await fileWithSchemaVersion(db, 99)
  await expect(restoreFromBytes(db, bad, PASS, { safety: { folder } })).rejects.toBeInstanceOf(BackupVersionError)
  expect((await folder.listFiles()).sort()).toEqual(before)
})

test('안전 백업은 복원전_ 이름이고 보관 정리로 지워지지 않는다', async () => {
  const { db, folder } = await ready()
  for (let i = 0; i < 14; i++) await runBackup(db, folder, { now: new Date(2026, 10, 1 + i, 9, 0) })
  const name = '백업_20261114_0900.enc'
  await restoreFromBytes(db, await folder.readFile(name), PASS, { safety: { folder }, now: new Date(2026, 10, 20, 8, 0) })
  const files = await folder.listFiles()
  expect(files.filter((f) => f.startsWith('백업_'))).toHaveLength(14)
  expect(files).toContain('복원전_20261120_0800.enc')
  expect(await rotateBackups(folder, 1)).not.toContain('복원전_20261120_0800.enc')
})

test('폴더가 없으면 안전 백업을 download로 넘긴다', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  const downloads: string[] = []
  await restoreFromBytes(db, await folder.readFile(name), PASS, { safety: { download: (n) => downloads.push(n) } })
  expect(downloads).toHaveLength(1)
  expect(downloads[0]).toMatch(/^복원전_\d{8}_\d{4}\.enc$/)
})

test('데이터가 있는데 안전 백업할 곳이 없으면 복원 거부, 데이터 그대로', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  await db.classes.add(cls(2))
  await expect(restoreFromBytes(db, await folder.readFile(name), PASS)).rejects.toThrow('복원 전에 현재 데이터를 백업할 곳이 없습니다.')
  expect(await db.classes.count()).toBe(2)
})

test('데이터가 있는데 백업 키가 없으면 복원 거부, 데이터 그대로', async () => {
  const { db, folder } = await ready()
  const name = await runBackup(db, folder)
  const other = testDb()
  await other.classes.add(cls(7))
  await expect(restoreFromBytes(other, await folder.readFile(name), PASS, { safety: { folder } })).rejects.toThrow('먼저 이 기기에서 백업 암호구를 설정하세요.')
  expect((await other.classes.toArray()).map((c) => c.grade)).toEqual([7])
})

test('보관 개수가 0 이하여도 최소 1개는 남는다', async () => {
  const folder = createMemoryFolder()
  await folder.writeFile('백업_20261104_0900.enc', new Uint8Array(1))
  await folder.writeFile('백업_20261105_0900.enc', new Uint8Array(1))
  await rotateBackups(folder, 0)
  expect(await folder.listFiles()).toEqual(['백업_20261105_0900.enc'])
})

test('설정의 보관 개수가 0이어도 방금 만든 백업은 남는다', async () => {
  const { db, folder } = await ready()
  await db.app_settings.put({ id: 'app', backup_keep_count: 0 } as never)
  const name = await runBackup(db, folder)
  expect(await folder.listFiles()).toContain(name)
})

test('마지막 백업 시각이 미래면 자동 백업이 필요하다', () => {
  expect(needsAutoBackup('2027-01-01T00:00:00.000Z', new Date('2026-11-05T12:00:00Z'))).toBe(true)
})

test('setupPassphrase는 backupKeyRaw(salt·iter·raw·check)를 두고 CryptoKey 행은 두지 않는다', async () => {
  const db = testDb()
  await setupPassphrase(db, PASS, IT)
  const v = (await db.device_local.get('backupKeyRaw'))?.value as { salt: string; iter: number; raw: string; check: string }
  expect(typeof v.salt).toBe('string')
  expect(v.iter).toBe(1000)
  expect(atob(v.raw).length).toBe(32)
  expect(typeof v.check).toBe('string')
  expect(await db.device_local.get('backupKey')).toBeUndefined()
  const c = await getCachedKey(db)
  expect(c?.iterations).toBe(1000)
  expect(c?.key.extractable).toBe(false)
})

// 옛 평문 DB 전용: vault DB는 CryptoKey를 봉인하지 못한다(spec §5.3)
test.skipIf(VAULT_MODE)('옛 backupKey(CryptoKey) 행만 있어도 getCachedKey가 그대로 쓴다', async () => {
  const db = testDb()
  const salt = new Uint8Array(16)
  const key = await deriveKey(PASS, salt, 1000)
  await db.device_local.put({ id: 'backupKey', value: { key, salt, iterations: 1000, check: 'x' } })
  expect((await getCachedKey(db))?.check).toBe('x')
})
