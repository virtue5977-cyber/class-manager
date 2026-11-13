import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, type AppDB } from '../../lib/db/schema'
import { createMemoryFolder, createMemoryFsAdapter, type MemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { setupPassphrase, runBackup } from '../../lib/backup/service'
import BackupSettings from './BackupSettings'
import * as reloadMod from '../../lib/ui/reload'
import { SKIP_UNTIL_BACKUP_KEY_RAW } from '../../test/vaultMode'

// 복원 뒤 화면 새로 불러오기는 시험에서 막는다
beforeEach(() => void vi.spyOn(reloadMod, 'reloadApp').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

function renderWith(db: AppDB, fs: MemoryFsAdapter) {
  return render(
    <AppProviders db={db} fs={fs}>
      <BackupSettings iterations={1000} />
    </AppProviders>,
  )
}

test('경고 문구가 항상 보인다', () => {
  renderWith(createDb('test-' + crypto.randomUUID()), createMemoryFsAdapter())
  expect(screen.getByText('암호구를 잃으면 백업 파일을 복구할 수 없습니다. 종이 등에 적어 보관하세요.')).toBeInTheDocument()
})

test('암호구 불일치 문구', async () => {
  const user = userEvent.setup()
  renderWith(createDb('test-' + crypto.randomUUID()), createMemoryFsAdapter())
  await user.type(screen.getByLabelText('새 암호구'), '우리반암호구2026')
  await user.type(screen.getByLabelText('암호구 확인'), '우리반암호구2027')
  await user.click(screen.getByRole('button', { name: '암호구 저장' }))
  expect(await screen.findByText('두 암호구가 일치하지 않습니다.')).toBeInTheDocument()
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('암호구 저장 후 지금 백업 → 메모리 폴더에 백업_ 파일, 마지막 백업 시각 표시', async () => {
  const user = userEvent.setup()
  const folder = createMemoryFolder('내 백업')
  const fs = createMemoryFsAdapter(folder)
  renderWith(createDb('test-' + crypto.randomUUID()), fs)
  expect(await screen.findByText('마지막 백업: 아직 없음')).toBeInTheDocument()
  await user.type(screen.getByLabelText('새 암호구'), '우리반암호구2026')
  await user.type(screen.getByLabelText('암호구 확인'), '우리반암호구2026')
  await user.click(screen.getByRole('button', { name: '암호구 저장' }))
  expect(await screen.findByText('암호구를 저장했습니다.')).toBeInTheDocument()
  expect(await screen.findByText('백업 폴더: 내 백업')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '지금 백업' }))
  await waitFor(async () => expect((await folder.listFiles()).some((f) => f.startsWith('백업_'))).toBe(true))
  expect(await screen.findByText(/^마지막 백업: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeInTheDocument()
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('틀린 암호구로 복원 → BackupDecryptError 문구 표시', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const folder = createMemoryFolder()
  const name = await runBackup(db, folder)
  const fs = createMemoryFsAdapter(folder)
  fs.nextFileToRead = { name, bytes: await folder.readFile(name) }
  renderWith(db, fs)
  await user.click(screen.getByRole('button', { name: '백업 파일에서 복원' }))
  expect(await screen.findByText('현재 데이터가 백업 내용으로 바뀝니다. 복원 전에 현재 상태를 한 번 더 백업합니다.')).toBeInTheDocument()
  await user.type(screen.getByLabelText('백업 암호구'), '틀린암호구입니다')
  await user.click(screen.getByRole('button', { name: '복원 실행' }))
  expect(await screen.findByText('암호구가 틀렸거나 백업 파일이 손상되었습니다.')).toBeInTheDocument()
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('올바른 암호구로 복원 → 복원했습니다, 화면을 새로 불러온다', async () => {
  const spy = vi.mocked(reloadMod.reloadApp)
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const folder = createMemoryFolder()
  const name = await runBackup(db, folder)
  const fs = createMemoryFsAdapter(folder)
  fs.nextFileToRead = { name, bytes: await folder.readFile(name) }
  renderWith(db, fs)
  await user.click(screen.getByRole('button', { name: '백업 파일에서 복원' }))
  await user.type(await screen.findByLabelText('백업 암호구'), '우리반암호구2026')
  await user.click(screen.getByRole('button', { name: '복원 실행' }))
  expect(await screen.findByText('복원했습니다. 화면을 새로 불러옵니다.')).toBeInTheDocument()
  await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 3000 })
})

async function restoreSetup() {
  const db = createDb('test-' + crypto.randomUUID())
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  const { newRecord } = await import('../../lib/db/records')
  await db.classes.add(newRecord({ school_year: 2026, grade: 1, class_no: 5 }))
  const folder = createMemoryFolder()
  const name = await runBackup(db, folder)
  return { db, folder, name, bytes: await folder.readFile(name) }
}

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('폴더 권한이 필요하면 복원할 때 허용을 요청하고 그 폴더에 안전 백업한다', async () => {
  const user = userEvent.setup()
  const { db, folder, name, bytes } = await restoreSetup()
  const fs = createMemoryFsAdapter(folder)
  fs.permissionRevoked = true
  fs.nextFileToRead = { name, bytes }
  renderWith(db, fs)
  await user.click(screen.getByRole('button', { name: '백업 파일에서 복원' }))
  await user.type(await screen.findByLabelText('백업 암호구'), '우리반암호구2026')
  await user.click(screen.getByRole('button', { name: '복원 실행' }))
  expect(await screen.findByText('복원했습니다. 화면을 새로 불러옵니다.')).toBeInTheDocument()
  expect((await folder.listFiles()).some((f) => f.startsWith('복원전_'))).toBe(true)
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('폴더가 없으면 안전 백업을 내려받는다', async () => {
  const user = userEvent.setup()
  const { db, name, bytes } = await restoreSetup()
  const fs = createMemoryFsAdapter()
  fs.nextFileToRead = { name, bytes }
  renderWith(db, fs)
  await user.click(screen.getByRole('button', { name: '백업 파일에서 복원' }))
  await user.type(await screen.findByLabelText('백업 암호구'), '우리반암호구2026')
  await user.click(screen.getByRole('button', { name: '복원 실행' }))
  expect(await screen.findByText('복원했습니다. 화면을 새로 불러옵니다.')).toBeInTheDocument()
  expect(fs.downloads.map((d) => d.name)[0]).toMatch(/^복원전_/)
})

test.skipIf(SKIP_UNTIL_BACKUP_KEY_RAW)('암호구가 이미 있으면 바꿀 때 이전 백업 안내가 보이고 단추는 암호구 바꾸기', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await setupPassphrase(db, '우리반암호구2026', { iterations: 1000 })
  renderWith(db, createMemoryFsAdapter(createMemoryFolder()))
  expect(await screen.findByText(/이전 백업 파일은 예전 암호구로만 열립니다/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '암호구 바꾸기' })).toBeInTheDocument()
})

test('HTML판에서는 폴더를 고를 수 있어도 백업 파일 내려받기 단추가 있다(설치형으로 옮기기)', async () => {
  const { edition } = await import('../../lib/update/update')
  edition.single = true
  try {
    const db = createDb('test-' + crypto.randomUUID())
    const fs = createMemoryFsAdapter(createMemoryFolder())
    renderWith(db, fs)
    expect(await screen.findByRole('button', { name: '백업 파일 내려받기' })).toBeInTheDocument()
  } finally {
    edition.single = false
  }
})
