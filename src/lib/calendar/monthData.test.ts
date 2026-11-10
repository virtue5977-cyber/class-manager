import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import type { SchoolCalendarRec } from '../db/types'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { saveAttendance } from '../attendance/attendance'
import { addLocalEvent } from '../events/localEvents'
import { loadMonthData, monthCells } from './monthData'

test('monthCells: 월요일부터, 그달 끝나는 주까지, 평일만', () => {
  const c = monthCells('2026-11', false)
  expect(c[0]).toBe('2026-10-26')
  expect(c).toHaveLength(30) // 11/30(월)까지 6주
  expect(c.every((d) => ![0, 6].includes(new Date(d + 'T00:00:00').getDay()))).toBe(true)
  expect(monthCells('2026-11', true)).toHaveLength(42)
})

test('loadMonthData: 학사·내 일정·출결을 날짜별로', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '가상'))
  await db.school_calendar.add(newRecord({ date: '2026-11-12', title: '체육대회', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec)
  await addLocalEvent(db, { date: '2026-11-13', title: '협의회', tag: '업무' })
  await saveAttendance(db, { student_id: s.id, date: '2026-11-10', kind: '결석', category: '질병', period: null, reason: '', evidence_type: null, memo: '' } as never)
  const r = await loadMonthData(db, c.id, '2026-10-26', '2026-12-06')
  expect(r['2026-11-12'].events[0].title).toBe('체육대회')
  expect(r['2026-11-10'].atts).toHaveLength(1)
  expect(r['2026-11-13'].local).toHaveLength(1)
})
