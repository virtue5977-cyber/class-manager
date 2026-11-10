import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ExportMenu from './ExportMenu'
import Shortcuts from './Shortcuts'

test('내보내기 버튼 하나에 한글·엑셀·PDF가 있고, 고르면 그 일을 한다', async () => {
  const user = userEvent.setup()
  const pdf = vi.fn()
  render(<ExportMenu items={[{ format: 'hwpx', run: vi.fn() }, { format: 'xlsx', run: vi.fn() }, { format: 'pdf', run: pdf }]} />)
  await user.click(screen.getByRole('button', { name: '내보내기 ▾' }))
  expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual(['한글(hwpx)', '엑셀(xlsx)', 'PDF'])
  await user.click(screen.getByRole('menuitem', { name: 'PDF' }))
  expect(pdf).toHaveBeenCalled()
  expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
})

test('Ctrl+E로도 열린다', async () => {
  render(
    <MemoryRouter>
      <Shortcuts />
      <ExportMenu items={[{ format: 'pdf', run: vi.fn() }]} />
    </MemoryRouter>,
  )
  fireEvent.keyDown(window, { key: 'e', code: 'KeyE', ctrlKey: true })
  expect(await screen.findByRole('menuitem', { name: 'PDF' })).toBeInTheDocument()
})

test('내보내기가 실패하면 메뉴 옆에 한국어 오류를 보인다(조용히 삼키지 않음)', async () => {
  const user = userEvent.setup()
  render(<ExportMenu items={[{ format: 'pdf', run: () => Promise.reject(new Error('디스크가 가득 찼습니다')) }]} />)
  await user.click(screen.getByRole('button', { name: '내보내기 ▾' }))
  await user.click(screen.getByRole('menuitem', { name: 'PDF' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF로 내보내지 못했습니다: 디스크가 가득 찼습니다')
})
