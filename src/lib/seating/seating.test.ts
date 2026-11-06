// @vitest-environment node
import { emptySeats, placeStudent, unassign, toggleDisabled, toggleFixed, randomize, resizeSeats, seatAt, unplaced, pruneMissing, createSeatingChart, listSeatingCharts } from './seating'
import { createDb } from '../db/schema'
import { createClass } from '../roster/roster'

const who = (seats: ReturnType<typeof emptySeats>) => seats.map((s) => s.student_id ?? (s.disabled ? 'X' : '.')).join('')

test('놓기: 빈자리 이동, 칸끼리 맞바꿈, 명단에서 와서 밀어내기, 책상 없음 칸 거부', () => {
  let s = emptySeats(1, 3)
  s = placeStudent(s, 'a', 0, 0)
  s = placeStudent(s, 'b', 0, 1)
  expect(who(s)).toBe('ab.')
  s = placeStudent(s, 'a', 0, 2)
  expect(who(s)).toBe('.ba')
  s = placeStudent(s, 'a', 0, 1)
  expect(who(s)).toBe('.ab')
  s = placeStudent(s, 'c', 0, 1)
  expect(who(s)).toBe('.cb')
  expect(unplaced(s, ['a', 'b', 'c'])).toEqual(['a'])
  s = toggleDisabled(s, 0, 0)
  expect(who(placeStudent(s, 'a', 0, 0))).toBe('Xcb')
  expect(who(unassign(s, 'c'))).toBe('X.b')
})

test('무작위: 고정석·책상 없음 유지, 넘치는 학생 수', () => {
  let s = emptySeats(2, 2)
  s = placeStudent(s, 'a', 1, 1)
  s = toggleFixed(s, 1, 1)
  s = toggleDisabled(s, 0, 0)
  const r = randomize(s, ['a', 'b', 'c', 'd', 'e'], () => 0.3)
  expect(seatAt(r.seats, 1, 1)!.student_id).toBe('a')
  expect(seatAt(r.seats, 0, 0)!.student_id).toBeNull()
  expect(r.overflow).toBe(2)
  expect(new Set(r.seats.map((x) => x.student_id).filter(Boolean)).size).toBe(3)
})

test('크기 바꾸기·빠진 학생 정리', () => {
  let s = placeStudent(emptySeats(2, 2), 'a', 1, 1)
  expect(resizeSeats(s, 3, 3).length).toBe(9)
  expect(seatAt(resizeSeats(s, 3, 3), 1, 1)!.student_id).toBe('a')
  expect(() => resizeSeats(s, 0, 3)).toThrow('행·열은')
  s = pruneMissing(s, [])
  expect(seatAt(s, 1, 1)!.student_id).toBeNull()
})

test('새 배치·복사: 현재 배치는 하나, 제목 기본값', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await createSeatingChart(db, c, '2026-11-05')
  expect(a.title).toBe('1학년 5반 자리배치표(11월)')
  const b = await createSeatingChart(db, c, '2026-12-01', { ...a, seats: placeStudent(a.seats, 'x', 0, 0) })
  const all = await listSeatingCharts(db, c.id)
  expect(all.map((x) => [x.id, x.active])).toEqual([[b.id, true], [a.id, false]])
  expect(seatAt(b.seats, 0, 0)!.student_id).toBe('x')
})
