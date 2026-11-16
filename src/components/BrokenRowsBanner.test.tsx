import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BrokenRowsBanner from './BrokenRowsBanner'
import QuotaBanner from './QuotaBanner'
import { createDb } from '../lib/db/schema'
import { createMemoryFsAdapter } from '../lib/fs/memory'
import { AppProviders } from '../app/context'
import BackupBanner from './BackupBanner'
import { notifyBroken } from '../lib/vault/middleware'

test('손상 행이 알려지면 개수 띠가 보인다', async () => {
  render(<BrokenRowsBanner />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => { notifyBroken('students', 1); notifyBroken('students', 2) })
  expect(await screen.findByText('손상된 기록 2개 — 백업에서 복원할 수 있습니다')).toBeInTheDocument()
})

test('같은 행은 한 번만 센다', () => {
  render(<BrokenRowsBanner />)
  act(() => { notifyBroken('students', 1); notifyBroken('students', 1) })
  expect(screen.getByText('손상된 기록 1개 — 백업에서 복원할 수 있습니다')).toBeInTheDocument()
})

const QMSG = '저장 공간이 부족합니다. 백업한 뒤 오래된 첨부를 지우세요.'
test('QuotaExceededError 거절이 오면 공간 부족 띠', async () => {
  render(<QuotaBanner />)
  expect(screen.queryByText(QMSG)).not.toBeInTheDocument()
  act(() => {
    const e = new Event('unhandledrejection') as Event & { reason?: unknown }
    e.reason = Object.assign(new Error('x'), { name: 'QuotaExceededError' })
    window.dispatchEvent(e)
  })
  expect(await screen.findByText(QMSG)).toBeInTheDocument()
})

test('Dexie 오류의 inner.name도 본다, 다른 거절은 무시', () => {
  render(<QuotaBanner />)
  act(() => {
    const e = new Event('unhandledrejection') as Event & { reason?: unknown }
    e.reason = new Error('boom')
    window.dispatchEvent(e)
  })
  expect(screen.queryByText(QMSG)).not.toBeInTheDocument()
  act(() => {
    const e = new Event('unhandledrejection') as Event & { reason?: unknown }
    e.reason = { name: 'AbortError', inner: { name: 'QuotaExceededError' } }
    window.dispatchEvent(e)
  })
  expect(screen.getByText(QMSG)).toBeInTheDocument()
})

test('vault DB에서 backupKeyRaw가 있으면 암호구 없음 띠를 안 띄운다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  ;(db as unknown as { isVault: boolean }).isVault = true
  await db.device_local.put({ id: 'backupKeyRaw', value: { k: 'x' } as never })
  render(
    <MemoryRouter><AppProviders db={db} fs={createMemoryFsAdapter()}><BackupBanner today="2026-11-10" /></AppProviders></MemoryRouter>,
  )
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByText(/백업 암호구가 설정되지 않았습니다/)).not.toBeInTheDocument()
})
