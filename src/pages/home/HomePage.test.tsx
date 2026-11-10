import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { addLocalEvent } from '../../lib/events/localEvents'
import { addNotice } from '../../lib/notices/notices'
import { createNote } from '../../lib/notes/notes'
import { newRecord } from '../../lib/db/records'
import type { SchoolCalendarRec } from '../../lib/db/types'
import HomePage from './HomePage'

async function home(today = '2026-11-10') {
  const db = createDb('test-' + crypto.randomUUID())
  const { createClass, setCurrentClassId } = await import('../../lib/roster/roster')
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  await db.school_calendar.add(newRecord({ date: '2026-11-12', title: '체육대회', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec)
  const show = () =>
    render(
      <MemoryRouter>
        <AppProviders db={db} fs={createMemoryFsAdapter()}>
          <HomePage today={today} />
        </AppProviders>
      </MemoryRouter>,
    )
  return { db, show }
}

test('새 홈: 제목·입력 막대·할 일·다가오는 일정(학사·내 일정 태그)', async () => {
  const { db, show } = await home()
  await addLocalEvent(db, { date: '2026-11-13', title: '협의회', tag: '업무' })
  show()
  expect(await screen.findByText(/11월 10일\(화\)/)).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '명령 입력' })).toBeInTheDocument()
  const up = screen.getByRole('region', { name: '다가오는 일정' })
  expect(await within(up).findByText('체육대회')).toBeInTheDocument()
  expect(within(up).getByText('협의회')).toBeInTheDocument()
  expect(within(up).getByText('업무')).toBeInTheDocument()
  expect(within(up).getByText('학사')).toBeInTheDocument()
})

test('전달사항이 없는 날엔 탭이 없고, 있으면 "전달사항 2"', async () => {
  const { db, show } = await home()
  const a = show()
  await screen.findByRole('combobox', { name: '명령 입력' })
  expect(screen.queryByRole('tab', { name: /전달사항/ })).not.toBeInTheDocument()
  a.unmount()
  await addNotice(db, { text: '체육복', start_date: '2026-11-10' })
  await addNotice(db, { text: '동의서', start_date: '2026-11-09', end_date: '2026-11-11' })
  show()
  expect(await screen.findByRole('tab', { name: '전달사항 2' })).toBeInTheDocument()
})

test('할 일에 @노트 → 링크, 체크하면 완료', async () => {
  const user = userEvent.setup()
  const { db, show } = await home()
  const n = await createNote(db, '2026 공문서')
  show()
  const todo = await screen.findByRole('region', { name: '할 일' })
  const input = within(todo).getByRole('combobox', { name: '할 일 추가' })
  await user.type(input, '회신 @2026')
  await user.click(await within(todo).findByRole('option', { name: /2026 공문서/ }))
  await user.keyboard('{Enter}')
  const link = await within(todo).findByRole('link', { name: '2026 공문서' })
  expect(link).toHaveAttribute('href', `/notes?id=${n.id}`)
  await user.click(within(todo).getByRole('checkbox', { name: /회신/ }))
  await waitFor(async () => expect((await db.todos.toArray())[0].done).toBe(true))
})

test('처음에는 시작하기 단계가 보이고, 학급을 만들면 체크된다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const { createClass } = await import('../../lib/roster/roster')
  await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <HomePage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByText('시작하기 · 남은 단계 4개')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '✓. 학급 만들기' })).toHaveClass('done')
})
