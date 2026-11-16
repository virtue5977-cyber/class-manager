import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { BASE_SCOPES, CALENDAR_SCOPES, GoogleApiError, type GoogleStatus } from '../../lib/google/google'
import { readGoogleError, recordGoogleError } from '../../lib/google/syncError'
import GoogleSettings from './GoogleSettings'

type G = { status: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn>; setClient: ReturnType<typeof vi.fn>; api: ReturnType<typeof vi.fn> }
function fakeDesktop(st: Partial<GoogleStatus>): G {
  const g: G = {
    status: vi.fn(async () => ({ client: true, connected: false, email: null, scopes: [], ...st })),
    login: vi.fn(async () => true),
    logout: vi.fn(async () => true),
    setClient: vi.fn(async () => true),
    api: vi.fn(async () => ({ status: 200, json: {} })),
  }
  ;(globalThis as { desktop?: unknown }).desktop = { google: g }
  return g
}
afterEach(() => {
  delete (globalThis as { desktop?: unknown }).desktop
})
function setup(db = createDb('test-' + crypto.randomUUID())) {
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <GoogleSettings />
      </AppProviders>
    </MemoryRouter>,
  )
  return db
}

test('미연결 → 구글로 시작 단추가 login(BASE_SCOPES, {incremental:false})', async () => {
  const g = fakeDesktop({})
  setup()
  await userEvent.click(await screen.findByRole('button', { name: '구글로 시작' }))
  await waitFor(() => expect(g.login).toHaveBeenCalledWith(BASE_SCOPES, { incremental: false }))
})

test('연결(base만) → 캘린더 영역 숨김, 캘린더도 연결 → login(CALENDAR_SCOPES, {incremental:true})', async () => {
  const g = fakeDesktop({ connected: true, email: 'teacher@example.com', scopes: BASE_SCOPES })
  setup()
  expect(await screen.findByText(/teacher@example\.com/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '지금 동기화' })).toBeNull()
  expect(screen.queryByRole('button', { name: '구글로 시작' })).toBeNull()
  expect(screen.getByText(/구글이 확인되지 않은 앱 경고를 보일 수 있습니다/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '캘린더도 연결' }))
  await waitFor(() => expect(g.login).toHaveBeenCalledWith(CALENDAR_SCOPES, { incremental: true }))
})

test('캘린더까지 연결되면 동기화 단추가 보이고 캘린더도 연결은 없다 · 끊기', async () => {
  const g = fakeDesktop({ connected: true, email: null, scopes: [...BASE_SCOPES, ...CALENDAR_SCOPES] })
  setup()
  expect(await screen.findByRole('button', { name: '지금 동기화' })).toBeInTheDocument()
  expect(screen.getByText(/연결됨/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '캘린더도 연결' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: '연결 끊기' }))
  await waitFor(() => expect(g.logout).toHaveBeenCalled())
})

test('sessionOnly 안내', async () => {
  fakeDesktop({ connected: true, email: 'a@example.com', scopes: BASE_SCOPES, sessionOnly: true })
  setup()
  expect(await screen.findByText('이 PC에 로그인 정보를 저장할 수 없어 앱을 다시 켜면 다시 연결해야 합니다')).toBeInTheDocument()
})

test('admin_policy_enforced 오류 문구', async () => {
  const g = fakeDesktop({})
  g.login.mockRejectedValue(new GoogleApiError(403, 'admin_policy_enforced', 'x'))
  setup()
  await userEvent.click(await screen.findByRole('button', { name: '구글로 시작' }))
  expect(await screen.findByText('학교 구글 계정은 관리자가 막았을 수 있습니다. 개인 Gmail을 쓰거나 학교 관리자에게 앱 등록을 부탁하세요.')).toBeInTheDocument()
})

test('메인이 던진 문자열 속 admin_policy_enforced도 같은 문구', async () => {
  const g = fakeDesktop({})
  g.login.mockRejectedValue(new Error("Error invoking remote method 'google:login': Error: access_denied admin_policy_enforced"))
  setup()
  await userEvent.click(await screen.findByRole('button', { name: '구글로 시작' }))
  expect(await screen.findByText(/학교 구글 계정은 관리자가 막았을 수 있습니다/)).toBeInTheDocument()
})

test('401 → 다시 연결 단추', async () => {
  const g = fakeDesktop({ connected: true, email: 'a@example.com', scopes: [...BASE_SCOPES, ...CALENDAR_SCOPES] })
  g.api.mockResolvedValue({ status: 401, json: { error: { status: 'UNAUTHENTICATED' } } })
  setup()
  await userEvent.click(await screen.findByRole('button', { name: '지금 동기화' }))
  const re = await screen.findByRole('button', { name: '다시 연결' })
  g.login.mockClear()
  await userEvent.click(re)
  await waitFor(() => expect(g.login).toHaveBeenCalled())
})

test('자동 동기화 실패가 마지막 오류로 보임', async () => {
  fakeDesktop({ connected: true, email: 'a@example.com', scopes: [...BASE_SCOPES, ...CALENDAR_SCOPES] })
  const db = createDb('test-' + crypto.randomUUID())
  await recordGoogleError(db, new GoogleApiError(429, undefined, 'x'), new Date('2026-11-14T03:00:00Z'))
  setup(db)
  expect(await screen.findByText(/마지막 오류/)).toBeInTheDocument()
  expect(screen.getByText(/구글 요청이 너무 많습니다/)).toBeInTheDocument()
})

test('연결 정보가 없으면 연결 파일 올리기가 보인다', async () => {
  fakeDesktop({ client: false })
  setup()
  expect(await screen.findByText(/연결 정보가 없습니다/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '연결 파일(JSON) 올리기' })).toBeInTheDocument()
})

test('데스크톱이 아니면 설치형 안내', async () => {
  setup()
  expect(await screen.findByText(/설치형\(Windows 앱\)에서만/)).toBeInTheDocument()
})

test('로그인 성공 · 연결 끊기 · 다시 연결은 묵은 마지막 오류를 지운다', async () => {
  const g = fakeDesktop({})
  const db = createDb('test-' + crypto.randomUUID())
  await recordGoogleError(db, new GoogleApiError(429, undefined, 'x'))
  setup(db)
  expect(await screen.findByText(/마지막 오류/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '구글로 시작' }))
  await waitFor(() => expect(screen.queryByText(/마지막 오류/)).toBeNull())
  expect(await readGoogleError(db)).toBeNull()
  void g
})

test('연결 끊기도 묵은 마지막 오류를 지운다', async () => {
  fakeDesktop({ connected: true, email: 'a@example.com', scopes: BASE_SCOPES })
  const db = createDb('test-' + crypto.randomUUID())
  await recordGoogleError(db, new GoogleApiError(429, undefined, 'x'))
  setup(db)
  await screen.findByText(/마지막 오류/)
  await userEvent.click(screen.getByRole('button', { name: '연결 끊기' }))
  await waitFor(() => expect(screen.queryByText(/마지막 오류/)).toBeNull())
})

test('다시 연결 성공도 묵은 마지막 오류를 지운다', async () => {
  fakeDesktop({ connected: true, email: 'a@example.com', scopes: BASE_SCOPES })
  const db = createDb('test-' + crypto.randomUUID())
  await recordGoogleError(db, new GoogleApiError(401, undefined, 'x'))
  setup(db)
  await userEvent.click(await screen.findByRole('button', { name: '다시 연결' }))
  await waitFor(() => expect(screen.queryByText(/마지막 오류/)).toBeNull())
})

test('설명은 지금 되는 것(캘린더)만 말한다', async () => {
  fakeDesktop({})
  setup()
  await screen.findByRole('button', { name: '구글로 시작' })
  expect(screen.queryByText(/드라이브/)).toBeNull()
  expect(screen.getByText(/구글 계정을 연결합니다\. 캘린더도 연결하면/)).toBeInTheDocument()
})
