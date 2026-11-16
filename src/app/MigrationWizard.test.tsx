import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import MigrationWizard, { type WizardDeps } from './MigrationWizard'
import { AppDB } from '../lib/db/schema'
import { setupPassphrase } from '../lib/backup/service'
import { decodeBackupFile } from '../lib/backup/format'
import { decrypt, deriveKey } from '../lib/backup/crypto'
import { parseSnapshot } from '../lib/backup/snapshot'
import { createMemoryFolder, createMemoryFsAdapter } from '../lib/fs/memory'
import { createNewVaultDb } from '../lib/vault/migrate'
import { newDek, type VaultPayload } from '../lib/vault/keys'
import type { DesktopVaultApi } from '../lib/desktop/bridge'

const OLD = 'class-manager'
const PASS = '가상시험암호구2026'
const ITER = 1000
const T = '2025-03-02T01:02:03.000Z'

async function seed(withKey = true) {
  const db = new AppDB(OLD)
  await db.open()
  await db.classes.add({ id: 'c1', school_year: 2026, grade: 3, class_no: 5, created_at: T, updated_at: T, deleted: false })
  await db.students.add({
    id: 's1', class_id: 'c1', number: 1, name: '가상학생', address: '', birth_date: '', prev_school: '', phone: '010-0000-0000',
    hobby: '', talent: '', commute: '', friends: '', memo: '', guardian_name: '', guardian_phone: '', active: true,
    created_at: T, updated_at: T, deleted: false,
  })
  if (withKey) await setupPassphrase(db, PASS, { iterations: ITER })
  db.close()
}

function fakeApi(over: Partial<DesktopVaultApi> = {}) {
  const stored: VaultPayload[] = []
  const api = {
    status: vi.fn(async () => ({ state: 'none' as const })),
    unlockDpapi: vi.fn(async () => null),
    readBackup: vi.fn(async () => null),
    store: vi.fn(async (p: VaultPayload) => { stored.push(p); return true }),
    reset: vi.fn(async () => true),
    ...over,
  }
  return { api, stored }
}

function deps(api: DesktopVaultApi, fs = createMemoryFsAdapter(createMemoryFolder()), over: Partial<WizardDeps> = {}): WizardDeps {
  return {
    api, fsFor: () => fs, iterations: { pass: ITER, recovery: ITER },
    estimate: async () => ({ usage: 1000, quota: 1e9 }), ...over,
  }
}

const watsonDbs = async () => (await Dexie.getDatabaseNames()).filter((n) => n.startsWith('watson-'))

afterEach(async () => {
  for (const n of await Dexie.getDatabaseNames()) await Dexie.delete(n)
})

async function toPassStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '시작' }))
}

test('안내·암호구 단계에 \'나중에\' 단추가 없다', async () => {
  await seed()
  const { api } = fakeApi()
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={vi.fn()} deps={deps(api)} />)
  expect(await screen.findByText(/끝까지 창을 닫지 마세요/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /나중에/ })).toBeNull()
  await toPassStep(user)
  expect(await screen.findByLabelText('백업 암호구')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /나중에/ })).toBeNull()
  await user.click(screen.getByRole('button', { name: '잊었어요' }))
  expect(await screen.findByLabelText(/새 암호구/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /나중에/ })).toBeNull()
})

test('틀린 암호구 → 다시 묻는다(아무것도 만들지 않음)', async () => {
  await seed()
  const { api } = fakeApi()
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={vi.fn()} deps={deps(api)} />)
  await toPassStep(user)
  await user.type(await screen.findByLabelText('백업 암호구'), '틀린암호구입니다')
  await user.click(screen.getByRole('button', { name: '확인' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('암호구가 맞지 않습니다')
  expect(screen.getByLabelText('백업 암호구')).toHaveValue('')
  expect(api.store).not.toHaveBeenCalled()
  expect(await watsonDbs()).toEqual([])
})

test('\'잊었어요\' → 새 암호구 + 확인 체크가 있어야 정할 수 있다', async () => {
  await seed()
  const { api } = fakeApi()
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={vi.fn()} deps={deps(api)} />)
  await toPassStep(user)
  await user.click(await screen.findByRole('button', { name: '잊었어요' }))
  await user.type(screen.getByLabelText(/새 암호구/), '새가상암호구2026')
  await user.type(screen.getByLabelText('한 번 더'), '새가상암호구2026')
  const go = screen.getByRole('button', { name: '정하기' })
  expect(go).toBeDisabled()
  await user.click(screen.getByLabelText('이전 백업 파일은 이전 암호구로만 열립니다'))
  expect(go).toBeEnabled()
  await user.click(go)
  expect(await screen.findByTestId('recovery-code')).toBeInTheDocument()
})

test('새 암호구는 8자 이상·두 칸이 같아야 한다(옛 열쇠 없음)', async () => {
  await seed(false)
  const { api } = fakeApi()
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={vi.fn()} deps={deps(api)} />)
  await toPassStep(user)
  expect(screen.queryByRole('button', { name: '잊었어요' })).toBeNull()
  const go = await screen.findByRole('button', { name: '정하기' })
  await user.type(screen.getByLabelText(/새 암호구/), 'short')
  await user.type(screen.getByLabelText('한 번 더'), 'short')
  expect(go).toBeDisabled()
  await user.clear(screen.getByLabelText(/새 암호구/))
  await user.type(screen.getByLabelText(/새 암호구/), '가상암호구길게')
  expect(go).toBeDisabled()
  expect(screen.queryByLabelText('이전 백업 파일은 이전 암호구로만 열립니다')).toBeNull()
})

test('저장 공간 부족 → 이유를 보이고 아무것도 만들지 않는다', async () => {
  await seed()
  const { api } = fakeApi()
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={vi.fn()} deps={deps(api, undefined, { estimate: async () => ({ usage: 100, quota: 150 }) })} />)
  await toPassStep(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('저장 공간')
  expect(api.store).not.toHaveBeenCalled()
  expect(await watsonDbs()).toEqual([])
  expect(await Dexie.exists(OLD)).toBe(true)
})

test('옮기기 전체(백업 폴더 있음): 옛 백업 → 암호구 → 복구 코드 → 옮기기 → 새 백업 → 옛 DB 지움 → BitLocker 안내', async () => {
  await seed()
  const folder = createMemoryFolder()
  const { api, stored } = fakeApi()
  const done = vi.fn()
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={done} deps={deps(api, createMemoryFsAdapter(folder))} />)
  await toPassStep(user)
  await user.type(await screen.findByLabelText('백업 암호구'), PASS)
  await user.click(screen.getByRole('button', { name: '확인' }))
  expect(await screen.findByTestId('recovery-code')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '인쇄' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '파일로 저장' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /적어 두었습니다/ }))
  expect(await screen.findByText(/BitLocker/, undefined, { timeout: 5000 })).toBeInTheDocument()
  expect(folder.files.size).toBe(2) // 옛 DB 백업 1 + 새 DB 백업 1
  expect(stored).toHaveLength(1)
  expect(stored[0].recovery).toBeTruthy()
  expect(await Dexie.exists(OLD)).toBe(false)
  await user.click(screen.getByRole('button', { name: '시작하기' }))
  expect(done).toHaveBeenCalledTimes(1)
  expect(await watsonDbs()).toEqual([stored[0].dbName])
})

test('백업 폴더가 없으면 \'내려받기\'를 해야 계속할 수 있다', async () => {
  await seed()
  const fs = createMemoryFsAdapter()
  const { api } = fakeApi()
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={vi.fn()} deps={deps(api, fs)} />)
  await toPassStep(user)
  await user.type(await screen.findByLabelText('백업 암호구'), PASS)
  await user.click(screen.getByRole('button', { name: '확인' }))
  await user.click(await screen.findByRole('button', { name: '건너뛰기(권장하지 않음)' }))
  const go = await screen.findByRole('button', { name: '계속' }, { timeout: 5000 })
  expect(go).toBeDisabled()
  expect(await Dexie.exists(OLD)).toBe(true)
  await user.click(screen.getByRole('button', { name: '내려받기' }))
  await waitFor(() => expect(fs.downloads).toHaveLength(1))
  expect(go).toBeEnabled()
  await user.click(go)
  expect(await screen.findByText(/BitLocker/)).toBeInTheDocument()
  expect(await Dexie.exists(OLD)).toBe(false)
})

test('실패 → 새 DB·vault 지움, 옛 DB 그대로, \'다시 시도\'·\'백업 파일 내려받기\'(옛 암호구로 열림)', async () => {
  await seed()
  const fs = createMemoryFsAdapter()
  const { api } = fakeApi({ store: vi.fn(async () => { throw new Error('열쇠 파일을 저장하지 못했습니다.') }) })
  const user = userEvent.setup()
  render(<MigrationWizard reason="migrate" done={vi.fn()} deps={deps(api, fs)} />)
  await toPassStep(user)
  await user.type(await screen.findByLabelText('백업 암호구'), PASS)
  await user.click(screen.getByRole('button', { name: '확인' }))
  await user.click(await screen.findByRole('button', { name: '건너뛰기(권장하지 않음)' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('열쇠 파일을 저장하지 못했습니다')
  expect(api.reset).toHaveBeenCalled()
  expect(await watsonDbs()).toEqual([])
  expect(await Dexie.exists(OLD)).toBe(true)
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '백업 파일 내려받기' }))
  await waitFor(() => expect(fs.downloads).toHaveLength(1))
  const { header, headerBytes, iv, ciphertext } = decodeBackupFile(fs.downloads[0].bytes)
  const key = await deriveKey(PASS, header.salt, header.iterations)
  const snap = parseSnapshot(await decrypt(key, iv, ciphertext, headerBytes))
  expect((snap.tables.students as { name: string }[]).map((s) => s.name)).toEqual(['가상학생'])
  await user.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('button', { name: '시작' })).toBeInTheDocument()
})

test('첫 설치: 암호구 → 복구 코드 건너뛰기 → 빈 새 DB, done', async () => {
  const { api, stored } = fakeApi()
  const done = vi.fn()
  const user = userEvent.setup()
  render(<MigrationWizard reason="first-install" done={done} deps={deps(api)} />)
  await toPassStep(user)
  await user.type(await screen.findByLabelText(/새 암호구/), '가상암호구2026')
  await user.type(screen.getByLabelText('한 번 더'), '가상암호구2026')
  await user.click(screen.getByRole('button', { name: '정하기' }))
  await user.click(await screen.findByRole('button', { name: '건너뛰기(권장하지 않음)' }))
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
  expect(stored).toHaveLength(1)
  expect(stored[0].recovery).toBeUndefined()
  const db = new AppDB(stored[0].dbName, { vault: true })
  expect((await db.meta.get('vault'))?.complete).toBe(true)
  expect(await db.students.count()).toBe(0)
  db.close()
})

test('끝나지 않은 옮기기(옛 DB 있음) → 새 DB·vault를 지우고 처음부터', async () => {
  await seed()
  const { dek, keyId } = newDek()
  const nd = await createNewVaultDb(dek, keyId, { migration: true })
  await nd.students.add({ id: 'x', class_id: 'c1', number: 1, name: '가상', created_at: T, updated_at: T, deleted: false } as never)
  nd.close()
  const { api } = fakeApi({ status: vi.fn(async () => ({ state: 'ok' as const, vault: { dbName: nd.name, keyId } as never })) })
  render(<MigrationWizard reason="incomplete" done={vi.fn()} deps={deps(api)} />)
  expect(await screen.findByText(/끝까지 창을 닫지 마세요/)).toBeInTheDocument()
  expect(screen.getByText(/처음부터 다시/)).toBeInTheDocument()
  expect(api.reset).toHaveBeenCalledTimes(1)
  expect(await Dexie.exists(nd.name)).toBe(false)
  expect(await Dexie.exists(OLD)).toBe(true)
})

test('끝나지 않은 옮기기(옛 DB 없음, 새 DB에 자료) → 지우지 않고 \'백업 파일에서 복원\' 안내', async () => {
  const { dek, keyId } = newDek()
  const nd = await createNewVaultDb(dek, keyId, { migration: true })
  await nd.students.add({ id: 'x', class_id: 'c1', number: 1, name: '가상', created_at: T, updated_at: T, deleted: false } as never)
  nd.close()
  const { api } = fakeApi({ status: vi.fn(async () => ({ state: 'ok' as const, vault: { dbName: nd.name, keyId } as never })) })
  render(<MigrationWizard reason="incomplete" done={vi.fn()} deps={deps(api)} />)
  const card = await screen.findByRole('alert')
  expect(card).toHaveTextContent('지우지 않았습니다')
  expect(screen.getByRole('button', { name: '백업 파일에서 복원' })).toBeInTheDocument()
  expect(api.reset).not.toHaveBeenCalled()
  expect(await Dexie.exists(nd.name)).toBe(true)
  void within
})
