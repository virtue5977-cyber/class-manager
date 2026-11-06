// @vitest-environment node
import { createDb } from '../db/schema'
import type { ClassPeriod } from '../neis/timetable'
import { coveredWeekdays, classLabelOf, subjectsForClasses, estimateSlots, applyEstimate, saveManualSlot, listMyTimetable } from './estimate'

// 2026-11-02(월)~06(금)
const p = (date: string, grade: number, classNo: string, period: number, subject: string): ClassPeriod => ({ date, grade, classNo, period, subject })
const WEEK: ClassPeriod[] = [
  p('2026-11-02', 1, '1', 1, '수학'), p('2026-11-02', 1, '1', 2, '과학'),
  p('2026-11-02', 1, '2', 1, '국어'), p('2026-11-02', 1, '2', 3, '수학'),
  p('2026-11-03', 1, '1', 4, '수학'), p('2026-11-03', 1, '2', 4, '수학'),
  p('2026-11-04', 1, '3', 1, '공통수학2'), p('2026-11-04', 2, '1', 1, '영어'),
]

test('subjectsForClasses는 고른 학급의 과목만 가나다순으로', () => {
  expect(classLabelOf(1, '3')).toBe('1-3')
  expect(subjectsForClasses(WEEK, ['1-1', '1-2'])).toEqual(['과학', '국어', '수학'])
})

test('estimateSlots: 1-1·1-2 수학 → 해당 요일·교시만, 과학은 제외', () => {
  const { slots } = estimateSlots(WEEK, ['수학'], ['1-1', '1-2'])
  expect(slots).toEqual([
    { weekday: 1, period: 1, subject: '수학', class_label: '1-1' },
    { weekday: 1, period: 3, subject: '수학', class_label: '1-2' },
    { weekday: 2, period: 4, subject: '수학', class_label: '1-1' },
    { weekday: 2, period: 4, subject: '수학', class_label: '1-2' },
  ])
})

test('같은 교시 두 학급이면 conflicts에 기록', () => {
  expect(estimateSlots(WEEK, ['수학'], ['1-1', '1-2']).conflicts).toEqual([{ weekday: 2, period: 4, labels: ['1-1', '1-2'] }])
})

test('과목명은 정확히 일치만(수학 ≠ 공통수학2)', () => {
  expect(estimateSlots(WEEK, ['수학'], ['1-3']).slots).toEqual([])
})

test('applyEstimate 두 번 해도 추정 칸이 중복되지 않는다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const { slots } = estimateSlots(WEEK, ['수학'], ['1-1'])
  await applyEstimate(db, slots, [1, 2, 3, 4, 5])
  await applyEstimate(db, slots, [1, 2, 3, 4, 5])
  const list = await listMyTimetable(db)
  expect(list.map((s) => `${s.weekday}-${s.period}-${s.class_label}`)).toEqual(['1-1-1-1', '2-4-1-1'])
  expect(list.every((s) => s.source === 'estimated')).toBe(true)
})

test('수동으로 고친 칸과 "수업 없음" 칸은 다시 추정해도 유지된다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const { slots } = estimateSlots(WEEK, ['수학'], ['1-1', '1-2'])
  await applyEstimate(db, slots, [1, 2, 3, 4, 5])
  await saveManualSlot(db, { weekday: 1, period: 1, subject: '수학(보강)', class_label: '1-1' })
  await saveManualSlot(db, { weekday: 1, period: 3, subject: '', class_label: '' })
  await applyEstimate(db, slots, [1, 2, 3, 4, 5])
  const list = await listMyTimetable(db)
  const at = (w: number, pr: number) => list.filter((s) => s.weekday === w && s.period === pr)
  expect(at(1, 1)).toEqual([expect.objectContaining({ subject: '수학(보강)', source: 'manual' })])
  expect(at(1, 3)).toEqual([expect.objectContaining({ subject: '', source: 'manual' })])
  expect(at(2, 4)).toHaveLength(2)
})

test('시간표가 없는 요일(휴업일 등)의 추정 칸은 다시 추정해도 지우지 않는다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const full = [p('2026-11-02', 1, '1', 1, '수학'), p('2026-11-04', 1, '1', 2, '수학')]
  await applyEstimate(db, estimateSlots(full, ['수학'], ['1-1']).slots, coveredWeekdays(full))
  const noWed = [p('2026-11-09', 1, '1', 1, '수학')] // 다음 주: 수요일 개교기념일
  await applyEstimate(db, estimateSlots(noWed, ['수학'], ['1-1']).slots, coveredWeekdays(noWed))
  expect((await listMyTimetable(db)).map((s) => `${s.weekday}-${s.period}`)).toEqual(['1-1', '3-2'])
  expect(coveredWeekdays(noWed)).toEqual([1])
})
