import { render, screen } from '@testing-library/react'
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
