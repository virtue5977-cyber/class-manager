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

test('달력에 내 일정(태그) 추가·지우기, 구글로 보낼 목록에도 들어감', async () => {
  const { addLocalEvent } = await import('../../lib/events/localEvents')
  const { buildPushItems } = await import('../../lib/google/google')
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await addLocalEvent(db, { date: '2026-11-13', title: '병원', tag: '개인' })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <CalendarPage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await within(await screen.findByRole('gridcell', { name: '11월 13일' })).findByText('병원')).toHaveClass('cal-tag-개인')
  await user.click(screen.getByRole('gridcell', { name: '11월 12일' }))
  const side = screen.getByRole('complementary', { name: '고른 날' })
  await user.type(within(side).getByLabelText('일정 제목'), '학년 협의회')
  await user.type(within(side).getByLabelText('시각'), '15:30')
  await user.selectOptions(within(side).getByLabelText('태그'), '업무')
  await user.click(within(side).getByRole('button', { name: '일정 추가' }))
  const cell = screen.getByRole('gridcell', { name: '11월 12일' })
  expect(await within(cell).findByText('15:30 학년 협의회')).toHaveClass('cal-tag-업무')
  expect((await buildPushItems(db, '2026-11-01', '2026-11-30')).map((i) => i.title)).toContain('[업무] 15:30 학년 협의회')
  await user.click(within(side).getByRole('button', { name: '학년 협의회 지우기' }))
  await waitFor(() => expect(within(cell).queryByText('15:30 학년 협의회')).not.toBeInTheDocument())
})

test('일정 추가에서 날짜(와 끝 날짜)를 직접 고를 수 있다(고른 날이 기본)', async () => {
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
  const side = screen.getByRole('complementary', { name: '고른 날' })
  const day = within(side).getByLabelText('날짜')
  expect(day).toHaveValue('2026-11-12')
  await user.clear(day)
  await user.type(day, '2026-11-18')
  await user.type(within(side).getByLabelText('끝 날짜'), '2026-11-19')
  await user.type(within(side).getByLabelText('일정 제목'), '수련회')
  await user.click(within(side).getByRole('button', { name: '일정 추가' }))
  await waitFor(async () => expect((await db.local_events.toArray()).map((e) => [e.date, e.end_date, e.title])).toEqual([['2026-11-18', '2026-11-19', '수련회']]))
  expect(await within(screen.getByRole('gridcell', { name: '11월 19일' })).findByText('수련회')).toBeInTheDocument()
})

test('일정을 누르면 상세: 내 일정은 고치기·지우기, 학사일정은 보기만', async () => {
  const { addLocalEvent } = await import('../../lib/events/localEvents')
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await addLocalEvent(db, { date: '2026-11-13', title: '병원', tag: '개인' })
  await db.school_calendar.add(newRecord({ date: '2026-11-13', title: '체육대회', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec)
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <CalendarPage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  const cell = await screen.findByRole('gridcell', { name: '11월 13일' })
  await user.click(await within(cell).findByText('병원'))
  const dlg = await screen.findByRole('dialog', { name: '일정 상세' })
  await user.clear(within(dlg).getByLabelText('제목'))
  await user.type(within(dlg).getByLabelText('제목'), '치과')
  await user.type(within(dlg).getByLabelText('장소'), '연세치과')
  await user.selectOptions(within(dlg).getByLabelText('구분'), '업무')
  await user.click(within(dlg).getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '일정 상세' })).not.toBeInTheDocument())
  expect(await within(cell).findByText('치과')).toHaveClass('cal-tag-업무')
  const ev = (await db.local_events.toArray())[0]
  expect(ev.place).toBe('연세치과')
  // 지우기는 한 번 더 묻는다
  await user.click(within(cell).getByText('치과'))
  const dlg2 = await screen.findByRole('dialog', { name: '일정 상세' })
  await user.click(within(dlg2).getByRole('button', { name: '지우기' }))
  await user.click(within(dlg2).getByRole('button', { name: '정말 지우기' }))
  await waitFor(() => expect(within(cell).queryByText('치과')).not.toBeInTheDocument())
  // 학사일정: 보기만
  await user.click(within(cell).getByText('체육대회'))
  const dlg3 = await screen.findByRole('dialog', { name: '일정 상세' })
  expect(within(dlg3).getByText('학사일정')).toBeInTheDocument()
  expect(within(dlg3).queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
  expect(within(dlg3).queryByRole('button', { name: '지우기' })).not.toBeInTheDocument()
})
