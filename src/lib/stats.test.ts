// @vitest-environment node
import { computeAttendanceStats, statsTable, STATS_HEADER } from './stats'
import { SchoolDays } from './schoolDays'
import type { AttendanceRec, StudentRec } from './db/types'

const att = (student_id: string, date: string, kind: AttendanceRec['kind'], category: AttendanceRec['category'], deleted = false) =>
  ({ id: crypto.randomUUID(), student_id, date, kind, category, period: kind === '결석' ? null : '1', reason: '', evidence_type: null, memo: '', created_at: '', updated_at: '', deleted }) as AttendanceRec
const days = new SchoolDays([])

test('결석은 수업일 연속 묶음 건수와 일수, 주말 건너도 이어짐, 수업일 아닌 날은 일수 제외', () => {
  const st = computeAttendanceStats(
    [
      att('a', '2026-11-06', '결석', '질병'),
      att('a', '2026-11-09', '결석', '질병'),
      att('a', '2026-11-11', '결석', '질병'),
      att('a', '2026-11-07', '결석', '미인정'), // 토요일
      att('a', '2026-11-12', '지각', '미인정'),
      att('a', '2026-11-13', '지각', '미인정', true),
    ],
    days,
  )
  expect(st.get('a')!['결석:질병']).toEqual({ count: 2, days: 3 })
  expect(st.get('a')!['결석:미인정']).toEqual({ count: 1, days: 0 })
  expect(st.get('a')!['지각:미인정']).toEqual({ count: 1, days: 0 })
})

test('기간 필터', () => {
  const st = computeAttendanceStats([att('a', '2026-10-30', '결석', '질병'), att('a', '2026-11-02', '결석', '질병')], days, { from: '2026-11-01', to: '2026-11-30' })
  expect(st.get('a')!['결석:질병']).toEqual({ count: 1, days: 1 })
})

test('표: 결석은 일수(건수), 나머지는 건수, 합계 행', () => {
  const students = [{ id: 'a', number: 1, name: '가' }, { id: 'b', number: 2, name: '나' }] as StudentRec[]
  const st = computeAttendanceStats([att('a', '2026-11-06', '결석', '질병'), att('a', '2026-11-09', '결석', '질병'), att('b', '2026-11-10', '조퇴', '출석인정')], days)
  const t = statsTable(students, st)
  expect(t[0]).toEqual(STATS_HEADER)
  const col = (name: string) => STATS_HEADER.indexOf(name)
  expect(t[1][col('결석 질병')]).toBe('2일(1건)')
  expect(t[2][col('조퇴 출석인정')]).toBe('1')
  expect(t[2][col('결석 질병')]).toBe('')
  expect(t[3][1]).toBe('합계')
  expect(t[3][col('결석 질병')]).toBe('2일(1건)')
})
