// @vitest-environment node
import { createDb } from '../lib/db/schema'
import { createMemoryFolder, createMemoryFsAdapter } from '../lib/fs/memory'
import { setupPassphrase } from '../lib/backup/service'
import { runStartup } from './startup'
import { SKIP_UNTIL_BACKUP_KEY_RAW } from '../test/vaultMode'

const testDb = () => createDb('test-' + crypto.randomUUID())
const NOW = new Date('2026-11-05T12:00:00Z')

test('runStartup: 키 없음 → needs-setup', async () => {
  const r = await runStartup(testDb(), createMemoryFsAdapter(createMemoryFolder()), NOW)
  expect(r.backup).toBe('needs-setup')
  expect(r.persisted).toBe(false)
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('runStartup: 키 있음, 폴더 없음 → needs-folder', async () => {
  const db = testDb()
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  expect((await runStartup(db, createMemoryFsAdapter(), NOW)).backup).toBe('needs-folder')
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('runStartup: 폴더 권한 필요 → needs-permission', async () => {
  const db = testDb()
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const fs = createMemoryFsAdapter(createMemoryFolder())
  fs.permissionRevoked = true
  expect((await runStartup(db, fs, NOW)).backup).toBe('needs-permission')
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('runStartup: 기한 지남 → done, 폴더에 파일 1개', async () => {
  const db = testDb()
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const folder = createMemoryFolder()
  expect((await runStartup(db, createMemoryFsAdapter(folder), NOW)).backup).toBe('done')
  expect(await folder.listFiles()).toHaveLength(1)
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('runStartup: 23시간 전 백업 → not-due, 파일 추가 없음', async () => {
  const db = testDb()
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  await db.device_local.put({ id: 'lastBackupAt', value: '2026-11-04T13:00:00.000Z' })
  const folder = createMemoryFolder()
  expect((await runStartup(db, createMemoryFsAdapter(folder), NOW)).backup).toBe('not-due')
  expect(await folder.listFiles()).toHaveLength(0)
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('runStartup: 쓰기 실패 → failed와 메시지', async () => {
  const db = testDb()
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const folder = createMemoryFolder()
  folder.writeFile = async () => { throw new Error('디스크가 가득 찼습니다') }
  const r = await runStartup(db, createMemoryFsAdapter(folder), NOW)
  expect(r.backup).toBe('failed')
  expect(r.error).toBe('디스크가 가득 찼습니다')
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('runAutoBackup: 켜 둔 채 기한이 되면 백업하고, 동시에 두 번 불러도 한 번만', async () => {
  const { runAutoBackup } = await import('./startup')
  const db = testDb()
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const folder = createMemoryFolder()
  const fs = createMemoryFsAdapter(folder)
  const [a, b] = await Promise.all([runAutoBackup(db, fs, NOW), runAutoBackup(db, fs, NOW)])
  expect([a.backup, b.backup].sort()).toEqual(['done', 'not-due'])
  expect(await folder.listFiles()).toHaveLength(1)
})
