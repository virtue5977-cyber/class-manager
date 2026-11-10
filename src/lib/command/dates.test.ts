import { parseDateWords } from './dates'
import { parsePeriod, CATEGORIES } from './lexicon'

const T = '2026-11-10' // 화
const d = (s: string) => parseDateWords(s.split(' '), 0, T)

test('날짜 말', () => {
  expect(d('오늘')).toEqual({ date: '2026-11-10', used: 1 })
  expect(d('내일').date).toBe('2026-11-11')
  expect(d('모레').date).toBe('2026-11-12')
  expect(d('어제').date).toBe('2026-11-09')
  expect(d('그제').date).toBe('2026-11-08')
  expect(d('11/12').date).toBe('2026-11-12')
  expect(d('11.12').date).toBe('2026-11-12')
  expect(d('12일').date).toBe('2026-11-12')
  expect(d('월요일').date).toBe('2026-11-16')
  expect(d('목').date).toBe('2026-11-12')
  expect(d('화요일').date).toBe('2026-11-10')
  expect(d('다음주 월')).toEqual({ date: '2026-11-16', used: 2 })
  expect(d('다음주 목').date).toBe('2026-11-19')
  expect(d('이번주 금').date).toBe('2026-11-13')
  expect(d('감기')).toEqual({ used: 0 })
})

test('시각 말', () => {
  expect(d('15:30')).toEqual({ time: '15:30', used: 1 })
  expect(d('오후 3시')).toEqual({ time: '15:00', used: 2 })
  expect(d('오후 3시 반')).toEqual({ time: '15:30', used: 3 })
  expect(d('3시 30분')).toEqual({ time: '15:30', used: 2 })
  expect(d('오전 9시')).toEqual({ time: '09:00', used: 2 })
  expect(d('내일 15:30')).toEqual({ date: '2026-11-11', time: '15:30', used: 2 })
})

test('교시·구분', () => {
  expect(parsePeriod('3교시')).toBe('3')
  expect(parsePeriod('5-7교시')).toBe('5~7')
  expect(parsePeriod('5~7교시')).toBe('5~7')
  expect(parsePeriod('감기')).toBeNull()
  expect(CATEGORIES['인정']).toBe('출석인정')
})
