// @vitest-environment node
import { SchoolDays, FIXED_HOLIDAYS, addDays, weekday, toYmd } from './schoolDays'
import { newRecord } from './db/records'
import type { SchoolCalendarRec } from './db/types'

const cal = (date: string, is_class_day: boolean, extra: Partial<SchoolCalendarRec> = {}): SchoolCalendarRec =>
  ({ ...newRecord({ date, title: 't', type: is_class_day ? '행사' : '휴업일', is_class_day, source: 'neis', grades: null }), ...extra }) as SchoolCalendarRec

test('주말은 비수업일, 평일은 수업일', () => {
  const d = new SchoolDays([])
  expect(d.isClassDay('2026-11-05')).toBe(true) // 목
  expect(d.isClassDay('2026-11-07')).toBe(false) // 토
  expect(d.isClassDay('2026-11-08')).toBe(false) // 일
})

test('고정 공휴일(10-09)은 학사일정이 없어도 비수업일', () => {
  expect(FIXED_HOLIDAYS).toEqual(['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'])
  expect(new SchoolDays([]).isClassDay('2026-10-09')).toBe(false)
})

test('휴업일 레코드가 있는 날은 비수업일, 같은 날 행사 레코드가 함께 있어도 비수업일', () => {
  const d = new SchoolDays([cal('2026-11-10', true), cal('2026-11-10', false), cal('2026-11-11', true)])
  expect(d.isClassDay('2026-11-10')).toBe(false)
  expect(d.isClassDay('2026-11-11')).toBe(true)
})

test('삭제 표시된 휴업일 레코드는 무시', () => {
  expect(new SchoolDays([cal('2026-11-10', false, { deleted: true })]).isClassDay('2026-11-10')).toBe(true)
})

test('countClassDays: 2026-11-06(금)~2026-11-10(화) = 3', () => {
  const d = new SchoolDays([])
  expect(d.countClassDays('2026-11-06', '2026-11-10')).toBe(3)
  expect(d.countClassDays('2026-11-10', '2026-11-06')).toBe(0)
  expect(d.countClassDays('2026-11-07', '2026-11-08')).toBe(0)
})

test('nextClassDay: 금요일 다음은 월요일, 다음 월요일이 휴업일이면 화요일', () => {
  expect(new SchoolDays([]).nextClassDay('2026-11-06')).toBe('2026-11-09')
  expect(new SchoolDays([cal('2026-11-09', false)]).nextClassDay('2026-11-06')).toBe('2026-11-10')
})

test('classDaysBetween은 주말·휴업일을 뺀다', () => {
  expect(new SchoolDays([cal('2026-11-10', false)]).classDaysBetween('2026-11-06', '2026-11-11')).toEqual(['2026-11-06', '2026-11-09', '2026-11-11'])
})

test('hasCalendarFor: 그 학년도 neis 레코드가 있으면 true, 다음 해 1월도 같은 학년도로 본다', () => {
  const d = new SchoolDays([cal('2026-03-02', true)])
  expect(d.hasCalendarFor('2026-11-05')).toBe(true)
  expect(d.hasCalendarFor('2027-01-15')).toBe(true)
  expect(d.hasCalendarFor('2027-03-02')).toBe(false)
  expect(new SchoolDays([cal('2026-03-02', true, { source: 'manual' })]).hasCalendarFor('2026-11-05')).toBe(false)
})

test('weekday와 addDays는 월말·연말을 넘어 정확하다', () => {
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  expect(weekday('2026-11-02')).toBe(1)
  expect(weekday('2026-11-08')).toBe(7)
  expect(toYmd(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05')
})
