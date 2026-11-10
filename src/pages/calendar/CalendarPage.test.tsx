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
import { pickExport } from '../../test/exportMenu'
import { waitFor } from '@testing-library/react'

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
  expect(within(day).getByText('출결 1')).toHaveAttribute('title', '3번 가나 지각')
  expect(within(day).getByText('상담 1')).toHaveAttribute('title', '3번 가나')
  expect(screen.queryByRole('columnheader', { name: '토' })).not.toBeInTheDocument()
  await user.click(day)
  const side = screen.getByRole('complementary', { name: '고른 날' })
  expect(within(side).getByText('11월 12일(목)')).toBeInTheDocument()
  expect(within(side).getByText(/지각\(1교시\)·미인정 - 늦잠/)).toBeInTheDocument()
  expect(within(side).getByText(/보호자 · 전화 · 진로/)).toBeInTheDocument()
  await user.click(screen.getByLabelText('주말 보기'))
  expect(screen.getByRole('columnheader', { name: '토' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '다음 달' }))
  expect(await screen.findByText('2026년 12월')).toBeInTheDocument()
})

test('구글에서 가져온 일정도 달력과 고른 날에 보인다(여러 날 일정은 날마다)', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await db.google_events.bulkPut([
    { id: 'g1', date: '2026-11-12', end_date: '2026-11-12', time: '15:30', title: '학부모 상담', calendar: 'primary', updated: '' },
    { id: 'g2', date: '2026-11-17', end_date: '2026-11-18', time: '', title: '연수', calendar: 'primary', updated: '' },
  ])
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <CalendarPage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await within(await screen.findByRole('gridcell', { name: '11월 12일' })).findByText('15:30 학부모 상담')).toBeInTheDocument()
  expect(within(screen.getByRole('gridcell', { name: '11월 18일' })).getByText('연수')).toBeInTheDocument()
  await user.click(screen.getByRole('gridcell', { name: '11월 12일' }))
  expect(within(screen.getByRole('complementary', { name: '고른 날' })).getByText('15:30 학부모 상담')).toBeInTheDocument()
})

test('고른 날의 "출결 입력"·"상담 기록" 링크는 그 날짜를 넘긴다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <CalendarPage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('gridcell', { name: '11월 12일' }))
  expect(screen.getByRole('link', { name: '출결 입력' })).toHaveAttribute('href', '/attendance?date=2026-11-12')
  expect(screen.getByRole('link', { name: '상담 기록' })).toHaveAttribute('href', '/counseling?date=2026-11-12')
})

test('달력 내보내기: 이 달 일정·출결·상담을 엑셀·한글로', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(3, '가나'))
  await db.school_calendar.add(newRecord({ date: '2026-11-12', title: '체육대회', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec)
  await saveAttendance(db, { student_id: s.id, date: '2026-11-12', kind: '지각', category: '미인정', period: '1', reason: '', evidence_type: null, memo: '' })
  const fs = createMemoryFsAdapter()
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={fs}>
        <CalendarPage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  await within(await screen.findByRole('gridcell', { name: '11월 12일' })).findByText('출결 1')
  await pickExport(user, '엑셀(xlsx)')
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['달력_2026-11.xlsx', '달력_2026-11.hwpx']))
})
