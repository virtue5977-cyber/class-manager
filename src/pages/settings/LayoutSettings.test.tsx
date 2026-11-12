import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Nav from '../../components/Nav'
import LayoutSettings from './LayoutSettings'
import { resetPrefs } from '../../lib/ui/layoutPrefs'

beforeEach(() => {
  localStorage.clear()
  resetPrefs()
})

test('메뉴 기본 순서는 홈·달력·학급·출결·상담일지·노트함, 설정에서 옮기고 숨기면 메뉴가 따라간다', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <Nav />
      <LayoutSettings />
    </MemoryRouter>,
  )
  const nav = screen.getByRole('navigation', { name: '메뉴' })
  const names = () => within(nav).getAllByRole('link').map((a) => a.textContent)
  expect(names()).toEqual(['홈', '달력', '학급', '출결', '누가기록', '노트함'])
  const card = screen.getByRole('region', { name: '메뉴와 홈 배치' })
  await user.click(within(card).getByRole('button', { name: '노트함 위로' }))
  await user.click(within(card).getByRole('checkbox', { name: '누가기록 보이기' }))
  expect(names()).toEqual(['홈', '달력', '학급', '출결', '노트함'])
  expect(within(card).getByRole('checkbox', { name: '홈 보이기' })).toBeDisabled()
  await user.click(within(card).getByRole('button', { name: '메뉴·배치 기본으로' }))
  expect(names()).toEqual(['홈', '달력', '학급', '출결', '누가기록', '노트함'])
})

test('홈 칸 자리: 오른쪽 / 왼쪽 탭 / 숨김을 고르면 저장된다', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter><LayoutSettings /></MemoryRouter>)
  const sel = screen.getByRole('combobox', { name: '홈 노트함 자리' })
  expect(sel).toHaveValue('side')
  await user.selectOptions(sel, 'tab')
  expect(JSON.parse(localStorage.getItem('watson.layout')!).panels.find((x: { key: string }) => x.key === 'notes').place).toBe('tab')
  await user.selectOptions(screen.getByRole('combobox', { name: '홈 오늘 급식 자리' }), 'hidden')
  expect(JSON.parse(localStorage.getItem('watson.layout')!).panels.find((x: { key: string }) => x.key === 'meal').hidden).toBe(true)
})
