import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../lib/db/schema'
import { createMemoryFsAdapter } from '../lib/fs/memory'
import { AppProviders } from '../app/context'
import { BASE_SCOPES, CALENDAR_SCOPES, GoogleApiError } from '../lib/google/google'
import { readGoogleError } from '../lib/google/syncError'
import GoogleAutoSync from './GoogleAutoSync'
import GoogleErrorBanner from './GoogleErrorBanner'
import { recordGoogleError } from '../lib/google/syncError'

afterEach(() => {
  delete (globalThis as { desktop?: unknown }).desktop
  vi.useRealTimers()
})

/** 가짜 시계 아래서 비동기(IndexedDB·liveQuery)가 끝나도록 여러 번 흘려 준다 */
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => { await vi.advanceTimersByTimeAsync(50) })
}

test('자동 동기화 실패는 저장되고 다음 성공에 지워진다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
  let status = 500
  const g = {
    status: async () => ({ client: true, connected: true, email: 'a@example.com', scopes: [...BASE_SCOPES, ...CALENDAR_SCOPES] }),
    setClient: async () => true,
    login: async () => true,
    logout: async () => true,
    api: async () => (status === 200 ? { status: 200, json: { id: 'cal1', items: [] } } : { status, json: { error: { status: 'INTERNAL' } } }),
  }
  ;(globalThis as { desktop?: unknown }).desktop = { google: g }
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <GoogleAutoSync />
      </AppProviders>
    </MemoryRouter>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5100)
  })
  await settle()
  expect((await readGoogleError(db))!.message).toContain('구글 오류(500)')
  // 다음 성공
  status = 200
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 100)
  })
  await settle()
  expect(await readGoogleError(db)).toBeNull()
})

test('홈 띠: 저장된 실패가 보이고 닫으면 사라지며, 새 실패는 다시 보인다(개인정보 없음)', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await recordGoogleError(db, new GoogleApiError(500, undefined, 'a@example.com 때문에'), new Date('2026-11-14T03:00:00Z'))
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <GoogleErrorBanner />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByText(/구글 동기화에 실패했습니다: 구글 오류\(500\)/)).toBeInTheDocument()
  expect(screen.queryByText(/example\.com/)).toBeNull()
  expect(screen.getByRole('link', { name: '설정으로 이동' })).toHaveAttribute('href', '/settings?tab=google')
  await userEvent.click(screen.getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  await recordGoogleError(db, new GoogleApiError(500, undefined, 'x'), new Date('2026-11-15T03:00:00Z'))
  expect(await screen.findByRole('status')).toBeInTheDocument()
})
