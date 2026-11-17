import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb, type AppDB } from '../lib/db/schema'
import { createMemoryFsAdapter } from '../lib/fs/memory'
import { AppProviders } from '../app/context'
import BackupBanner from './BackupBanner'

const show = (db: AppDB, today: string) =>
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <BackupBanner today={today} />
      </AppProviders>
    </MemoryRouter>,
  )

test("'오늘은 그만 보기' → 그날은 다시 안 보이고, 다음 날엔 다시 보인다", async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const a = show(db, '2026-11-10')
  expect(await screen.findByText(/백업 암호구가 설정되지 않았습니다/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '오늘은 그만 보기' }))
  expect(screen.queryByText(/백업 암호구가 설정되지 않았습니다/)).not.toBeInTheDocument()
  await waitFor(async () => expect((await db.device_local.get('backupBannerHidden'))?.value).toBe('2026-11-10'))
  a.unmount()
  const b = show(db, '2026-11-10')
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByText(/백업 암호구가 설정되지 않았습니다/)).not.toBeInTheDocument()
  b.unmount()
  show(db, '2026-11-11')
  expect(await screen.findByText(/백업 암호구가 설정되지 않았습니다/)).toBeInTheDocument()
})

test('자동 백업에서 손상된 첨부를 뺐으면 그렇다고 띠로 알린다(실패 아님)', async () => {
  const { openTestVaultDb } = await import('../lib/vault/testing')
  const { attachFile, createNote } = await import('../lib/notes/notes')
  const { setupPassphrase } = await import('../lib/backup/service')
  const { createMemoryFolder } = await import('../lib/fs/memory')
  const db = openTestVaultDb()
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const n = await createNote(db)
  const f = await attachFile(db, n.id, { name: 'a.bin', mime: 'x/y', bytes: new Uint8Array([1, 2, 3, 4]) })
  await db.note_blobs.put({ id: f.id, _enc: new Uint8Array([9, 9, 9]) })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter(createMemoryFolder())}>
        <BackupBanner today="2026-11-10" />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByText('첨부 1개가 손상되어 백업에서 빠졌습니다')).toBeInTheDocument()
  expect(screen.queryByText(/실패/)).toBeNull()
})
