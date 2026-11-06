import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb } from '../lib/db/schema'
import { createMemoryFsAdapter } from '../lib/fs/memory'
import { AppProviders } from '../app/context'
import { setPin } from '../lib/pin'
import PinGate, { RESUME_LOCK_MS } from './PinGate'

const setVisibility = (v: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
  document.dispatchEvent(new Event('visibilitychange'))
}

test('PIN이 없으면 바로, 있으면 잠금 → 틀리면 안내 → 맞으면 열림, 오래 가려졌다 돌아오면 다시 잠금', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await setPin(db, '2468', 10)
  let t = 1_000_000
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <PinGate now={() => t}>
        <p>본문</p>
      </PinGate>
    </AppProviders>,
  )
  const input = await screen.findByLabelText('PIN')
  await user.type(input, '1111')
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('PIN이 맞지 않습니다.')
  await user.type(screen.getByLabelText('PIN'), '2468')
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText('본문')).toBeInTheDocument()
  act(() => setVisibility('hidden'))
  t += 60_000
  act(() => setVisibility('visible'))
  expect(screen.getByText('본문')).toBeInTheDocument()
  act(() => setVisibility('hidden'))
  t += RESUME_LOCK_MS
  act(() => setVisibility('visible'))
  expect(await screen.findByLabelText('PIN')).toBeInTheDocument()
})

test('PIN을 안 쓰면 잠그지 않는다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <PinGate>
        <p>본문</p>
      </PinGate>
    </AppProviders>,
  )
  expect(await screen.findByText('본문')).toBeInTheDocument()
})

test('잠가도 쓰던 글은 남고, 틀린 횟수는 새로고침해도 이어진다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await setPin(db, '2468', 10)
  let t = 1_000_000
  const { unmount } = render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <PinGate now={() => t}>
        <textarea aria-label="메모" />
      </PinGate>
    </AppProviders>,
  )
  await user.type(await screen.findByLabelText('PIN'), '2468')
  await user.click(screen.getByRole('button', { name: '열기' }))
  await user.type(await screen.findByLabelText('메모'), '쓰던 글')
  act(() => setVisibility('hidden'))
  t += RESUME_LOCK_MS
  act(() => setVisibility('visible'))
  await screen.findByLabelText('PIN')
  for (let i = 0; i < 5; i++) {
    await user.type(screen.getByLabelText('PIN'), '0000')
    await user.click(screen.getByRole('button', { name: '열기' }))
  }
  expect(await screen.findByRole('alert')).toHaveTextContent('5번 틀렸습니다')
  await user.type(screen.getByLabelText('PIN'), '2468')
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('초 뒤에 다시 시도하세요')
  t += 30_000
  await user.clear(screen.getByLabelText('PIN'))
  await user.type(screen.getByLabelText('PIN'), '2468')
  await user.click(screen.getByRole('button', { name: '열기' }))
  await waitFor(() => expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument())
  expect(screen.getByLabelText('메모')).toHaveValue('쓰던 글')
  unmount()
})
