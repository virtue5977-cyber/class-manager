import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppearanceSettings from './AppearanceSettings'

beforeEach(() => {
  localStorage.clear()
  document.body.classList.remove('hide-names')
})

test('화면 설정에서 이름 가리기를 켜고, 단축키 표 12줄(노트 단축키 포함)을 본다', async () => {
  render(<AppearanceSettings />)
  await userEvent.setup().click(screen.getByLabelText(/학생 이름 가리기/))
  expect(document.body).toHaveClass('hide-names')
  const table = screen.getByRole('table', { name: '단축키' })
  expect(within(table).getAllByRole('row').slice(1)).toHaveLength(12)
})
