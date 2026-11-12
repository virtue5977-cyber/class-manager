import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import type { SchoolCalendarRec } from '../db/types'
import { saveAttendance } from './attendance'
import { planAbsenceRange, saveAbsenceRange } from './range'

const base = { student_id: 's1', kind: '결석' as const, category: '질병' as const, period: null, reason: '독감', evidence_type: null, memo: '' }

test('결석 기간: 주말·휴업일을 빼고 수업일마다, 이미 기록 있는 날은 덮어쓸지 고른다', async () => {
  const db = createDb('t-' + crypto.randomUUID())
  // 11/13(금) 재량휴업일, 11/14·15 주말
  await db.school_calendar.add(newRecord({ date: '2026-11-13', title: '재량휴업일', type: '휴업일', is_class_day: false, source: 'manual' }) as SchoolCalendarRec)
  await saveAttendance(db, { ...base, date: '2026-11-16', kind: '지각', category: '미인정', period: '1', reason: '' })
  const plan = await planAbsenceRange(db, 's1', '2026-11-11', '2026-11-17')
  expect(plan.days).toEqual(['2026-11-11', '2026-11-12', '2026-11-16', '2026-11-17'])
  expect(plan.taken).toEqual(['2026-11-16'])
  // 있는 날 빼고
  expect(await saveAbsenceRange(db, { ...base, date: '2026-11-11' }, plan.days, false)).toBe(3)
  const by = async () => (await db.attendance.toArray()).filter((r) => !r.deleted).map((r) => `${r.date} ${r.kind}`).sort()
  expect(await by()).toEqual(['2026-11-11 결석', '2026-11-12 결석', '2026-11-16 지각', '2026-11-17 결석'])
  // 덮어쓰기
  expect(await saveAbsenceRange(db, { ...base, date: '2026-11-11' }, plan.days, true)).toBe(4)
  expect(await by()).toEqual(['2026-11-11 결석', '2026-11-12 결석', '2026-11-16 결석', '2026-11-17 결석'])
  await expect(planAbsenceRange(db, 's1', '2026-11-12', '2026-11-11')).rejects.toThrow('끝날이 시작날보다 앞입니다.')
})
