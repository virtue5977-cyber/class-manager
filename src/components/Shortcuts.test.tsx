import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../lib/db/schema'
import { createMemoryFsAdapter } from '../lib/fs/memory'
import { AppProviders } from '../app/context'
import { createClass, emptyStudent, saveStudent, setCurrentClassId } from '../lib/roster/roster'
import { AppRoutes } from '../App'
import Shortcuts from './Shortcuts'

async function renderAt(path: string) {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  await saveStudent(db, c.id, emptyStudent(1, '가나'))
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <Shortcuts />
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  )
}

test('출결에서 Alt+→ 는 다음 수업일로', async () => {
  window.location.hash = '#/attendance?date=2026-11-06'
  await renderAt('/attendance?date=2026-11-06')
  await screen.findByRole('button', { name: /^1번 가나/ })
  fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
  await waitFor(() => expect(screen.getByLabelText('날짜')).toHaveValue('2026-11-09'))
  window.location.hash = ''
})

test('Ctrl+2 는 달력으로', async () => {
  await renderAt('/')
  fireEvent.keyDown(window, { key: '2', code: 'Digit2', ctrlKey: true })
  expect(await screen.findByRole('heading', { name: '달력' })).toBeInTheDocument()
})
