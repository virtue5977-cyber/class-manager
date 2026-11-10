import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import HideNamesBar from './HideNames'
import Shortcuts from './Shortcuts'

beforeEach(() => {
  localStorage.removeItem('cm.hideNames')
  document.body.classList.remove('hide-names')
})

const renderBar = () =>
  render(
    <MemoryRouter>
      <Shortcuts />
      <HideNamesBar />
    </MemoryRouter>,
  )

test('꺼져 있으면 띠가 없고, Ctrl+Shift+H로 켜면 이름이 가려지고 띠가 보인다', async () => {
  renderBar()
  expect(screen.queryByText(/이름 가림 중/)).not.toBeInTheDocument()
  act(() => void fireEvent.keyDown(window, { key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }))
  expect(await screen.findByText(/이름 가림 중/)).toBeInTheDocument()
  expect(document.body).toHaveClass('hide-names')
})

test('띠의 끄기를 누르면 다시 보인다', async () => {
  localStorage.setItem('cm.hideNames', '1')
  renderBar()
  await userEvent.setup().click(await screen.findByRole('button', { name: '끄기' }))
  expect(screen.queryByText(/이름 가림 중/)).not.toBeInTheDocument()
  expect(document.body).not.toHaveClass('hide-names')
})
