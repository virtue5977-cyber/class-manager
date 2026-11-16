import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppearanceSettings from './AppearanceSettings'

afterEach(() => { delete (globalThis as { desktop?: unknown }).desktop })

test('웹에서는 자동 실행·바로가기가 보이지 않는다', () => {
  render(<AppearanceSettings />)
  expect(screen.queryByLabelText('컴퓨터를 켜면 Watson 열기')).toBeNull()
  expect(screen.queryByRole('button', { name: '바탕화면 바로가기 만들기' })).toBeNull()
})

test('exe: 체크하면 autostart.set(true), 단추는 shortcut.create, 결과 문구', async () => {
  const set = vi.fn(async () => ({ on: true }))
  const create = vi.fn(async () => ({ ok: true, name: 'Watson.lnk' }))
  ;(globalThis as { desktop?: unknown }).desktop = { autostart: { get: async () => ({ on: false, path: 'x' }), set }, shortcut: { create } }
  render(<AppearanceSettings />)
  const user = userEvent.setup()
  const cb = await screen.findByLabelText('컴퓨터를 켜면 Watson 열기')
  await user.click(cb)
  await waitFor(() => expect(set).toHaveBeenCalledWith(true))
  await user.click(screen.getByRole('button', { name: '바탕화면 바로가기 만들기' }))
  expect(create).toHaveBeenCalled()
  expect(await screen.findByText('바탕화면에 바로가기를 만들었습니다')).toBeTruthy()
})

test('바로가기 실패 문구, .cmd 도우미 문구 없음', async () => {
  ;(globalThis as { desktop?: unknown }).desktop = { autostart: { get: async () => ({ on: true, path: 'x' }), set: async () => ({}) }, shortcut: { create: async () => ({ ok: false }) } }
  render(<AppearanceSettings />)
  await userEvent.setup().click(await screen.findByRole('button', { name: '바탕화면 바로가기 만들기' }))
  expect(await screen.findByText(/만들지 못했습니다/)).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/\.cmd|도우미/)
})

test('autostart.set이 돌려준 on으로 체크를 맞춘다(개발용이면 꺼진 채)', async () => {
  ;(globalThis as { desktop?: unknown }).desktop = { autostart: { get: async () => ({ on: false, path: null }), set: async () => ({ on: false }) }, shortcut: { create: async () => ({ ok: true }) } }
  render(<AppearanceSettings />)
  const cb = (await screen.findByLabelText('컴퓨터를 켜면 Watson 열기')) as HTMLInputElement
  await userEvent.setup().click(cb)
  await waitFor(() => expect(cb.checked).toBe(false))
})
