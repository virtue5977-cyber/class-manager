import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, setCurrentClassId } from '../../lib/roster/roster'
import HomePage from './HomePage'

// 다른 시험의 '보내는 중' 말풍선이 섞이지 않게 따로 둔다
test('대화가 비었으면 자주 쓰는 명령 칩, 누르면 입력칸에 채우고 커서를 둔다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <HomePage today="2026-11-10" />
      </AppProviders>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByLabelText('명령 입력')).toBeEnabled(), { timeout: 4000 })
  const chips = await screen.findByRole('group', { name: '자주 쓰는 명령' })
  await user.click(within(chips).getByRole('button', { name: '/출결' }))
  const box = screen.getByLabelText('명령 입력')
  expect(box).toHaveValue('/출결 ')
  await waitFor(() => expect(box).toHaveFocus())
})
