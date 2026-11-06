// @vitest-environment node
import { createDb } from '../db/schema'
import { createDesktopFsAdapter, type DesktopBackupApi } from './desktop'

test('exe 백업 폴더: 고른 폴더로 읽고 쓰고, 폴더가 없어지면 다시 고르게 한다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const files = new Map<string, Uint8Array>()
  let dir: string | null = null
  let exists = true
  const api: DesktopBackupApi = {
    pick: async () => (dir = 'D:\\백업'),
    current: async () => (dir ? (exists ? dir : { missing: dir }) : null),
    write: async (n, b) => void files.set(n, b),
    read: async (n) => files.get(n)!,
    list: async () => [...files.keys()],
    delete: async (n) => void files.delete(n),
  }
  const fs = createDesktopFsAdapter(db, api)
  expect((await fs.restoreFolder()).status).toBe('none')
  const f = (await fs.pickFolder())!
  await f.writeFile('a.enc', new Uint8Array([1]))
  const st = await fs.restoreFolder()
  expect(st.status).toBe('ready')
  if (st.status === 'ready') expect(await st.folder.listFiles()).toEqual(['a.enc'])
  exists = false
  expect((await fs.restoreFolder()).status).toBe('needs-permission')
})
