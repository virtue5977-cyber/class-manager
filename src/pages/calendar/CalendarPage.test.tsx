import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { saveAttendance } from '../../lib/attendance/attendance'
import { saveLog } from '../../lib/counseling/counseling'
import { newRecord } from '../../lib/db/records'
import type { SchoolCalendarRec } from '../../lib/db/types'
import CalendarPage from './CalendarPage'

test('한 달에 학사일정·출결·상담이 함께 보이고, 날짜를 누르면 자세히', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(3, '가나'))
  await db.school_calendar.add(newRecord({ date: '2026-11-12', title: '체육대회', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec)
  await saveAttendance(db, { student_id: s.id, date: '2026-11-12', kind: '지각', category: '미인정', period: '1', reason: '늦잠', evidence_type: null, memo: '' })
  await saveLog(db, { student_id: s.id, date: '2026-11-12', place: '교실', content: '진로 고민', target: '보호자', method: '전화', topic: '진로' })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <CalendarPage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  const day = await screen.findByRole('gridcell', { name: '11월 12일' })
  expect(await within(day).findByText('체육대회')).toBeInTheDocument()
  expect(await within(day).findByText('출결 1')).toBeInTheDocument()
  expect(within(day).getByText('상담 1')).toBeInTheDocument()
  expect(screen.queryByRole('columnheader', { name: '토' })).not.toBeInTheDocument()
  await user.click(day)
  const side = screen.getByRole('complementary', { name: '고른 날' })
  expect(within(side).getByText('11월 12일(목)')).toBeInTheDocument()
  expect(within(side).getByText(/지각\(1교시\)·미인정 - 늦잠/)).toBeInTheDocument()
  expect(within(side).getByText(/보호자 · 전화 · 진로/)).toBeInTheDocument()
  await user.click(screen.getByLabelText('주말 보기'))
  expect(screen.getByRole('columnheader', { name: '토' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '다음 달' }))
  expect(await screen.findByText('2026. 12')).toBeInTheDocument()
})
