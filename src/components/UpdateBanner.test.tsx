import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import UpdateBanner from './UpdateBanner'

afterEach(() => { delete (window as { desktop?: unknown }).desktop })
const fake = (st: unknown) => {
  ;(window as { desktop?: unknown }).desktop = { update: { get: async () => st, check: async () => st, restart: async () => {}, onState: () => () => {} } }
}

test('되돌림 알림(notice)은 상태와 상관없이 띠로 보인다', async () => {
  fake({ status: 'latest', current: '1.0.0', notice: '새 화면 판이 두 번 열리지 않아 이전 판으로 되돌렸습니다' })
  render(<UpdateBanner />)
  expect(await screen.findByText(/새 화면 판이 두 번 열리지 않아 이전 판으로 되돌렸습니다/)).toBeInTheDocument()
})

test('받아 둔 판의 서명 기한 경고(warning)를 함께 보인다', async () => {
  fake({ status: 'ready', current: '1.0.0', version: '1.0.1', warning: '업데이트 서명 기한이 지났습니다' })
  render(<UpdateBanner />)
  expect(await screen.findByText(/새 버전 1.0.1/)).toBeInTheDocument()
  expect(screen.getByText(/업데이트 서명 기한이 지났습니다/)).toBeInTheDocument()
})

test('다시 시작: 미뤄 둔 저장(flushAll)이 끝난 뒤에 restart를 부른다', async () => {
  const { registerFlush } = await import('../lib/ui/flush')
  const { default: userEvent } = await import('@testing-library/user-event')
  const order: string[] = []
  const off = registerFlush(() => new Promise<void>((r) => setTimeout(() => { order.push('saved'); r() }, 50)))
  ;(window as { desktop?: unknown }).desktop = {
    update: { get: async () => ({ status: 'ready', current: '1.0.0', version: '1.0.1' }), check: async () => ({}), restart: async () => { order.push('restart') }, onState: () => () => {} },
  }
  render(<UpdateBanner />)
  await userEvent.setup().click(await screen.findByRole('button', { name: /다시 시작/ }))
  await waitFor(() => expect(order).toEqual(['saved', 'restart']))
  off()
})

test('다시 시작: 저장이 3초 안에 안 끝나도 restart는 부른다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const { registerFlush } = await import('../lib/ui/flush')
  const off = registerFlush(() => new Promise<void>(() => {}))
  const restart = vi.fn(async () => {})
  ;(window as { desktop?: unknown }).desktop = {
    update: { get: async () => ({ status: 'ready', current: '1.0.0', version: '1.0.1' }), check: async () => ({}), restart, onState: () => () => {} },
  }
  render(<UpdateBanner />)
  fireEvent.click(await screen.findByRole('button', { name: /다시 시작/ }))
  await vi.advanceTimersByTimeAsync(3100)
  expect(restart).toHaveBeenCalled()
  off()
  vi.useRealTimers()
})
