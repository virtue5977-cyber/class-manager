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
  expect(d('내일 15:30')).toEqual({ date: '2026-11-11', time: '15:30', used: 2, dateUsed: 1 })
})

test('교시·구분', () => {
  expect(parsePeriod('3교시')).toBe('3')
  expect(parsePeriod('5-7교시')).toBe('5~7')
  expect(parsePeriod('5~7교시')).toBe('5~7')
  expect(parsePeriod('감기')).toBeNull()
  expect(CATEGORIES['인정']).toBe('출석인정')
})

test('없는 날짜는 invalid로 알린다', () => {
  expect(parseDateWords(['31일'], 0, T)).toEqual({ used: 1, invalid: '31일' })
  expect(parseDateWords(['37.5'], 0, T)).toEqual({ used: 0 })
  expect(parseDateWords(['일'], 0, T)).toEqual({ used: 0 })
})

test('지난 날짜 우선(출결·상담): 요일·날짜·해 넘김', () => {
  const past = (s: string, today: string) => parseDateWords(s.split(' '), 0, today, 'past')
  expect(past('월요일', '2026-11-11').date).toBe('2026-11-09')
  expect(past('30일', '2026-11-02').date).toBe('2026-10-30')
  expect(past('12/22', '2027-01-05').date).toBe('2027-12-22') // 연도를 안 쓰면 올해(사용자 요청 11/11)
  expect(parseDateWords(['월요일'], 0, '2026-11-11').date).toBe('2026-11-16') // 일정·할 일은 앞으로
})

test('여러 날짜 꼴: 11월11일·11월 11일·1111·0305·연도 붙은 꼴, 연도를 안 쓰면 올해', () => {
  expect(d('11월11일')).toEqual({ date: '2026-11-11', used: 1 })
  expect(d('11월 11일')).toEqual({ date: '2026-11-11', used: 2 })
  expect(d('1111')).toEqual({ date: '2026-11-11', used: 1 })
  expect(d('0305').date).toBe('2026-03-05') // 지난 날짜여도 올해
  expect(d('3/5').date).toBe('2026-03-05')
  expect(d('2025-12-01').date).toBe('2025-12-01')
  expect(d('2027.1.5').date).toBe('2027-01-05')
  expect(d('2025년 12월 1일')).toEqual({ date: '2025-12-01', used: 3 })
  expect(d('2025년12월1일').date).toBe('2025-12-01')
  expect(d('1503').date).toBeUndefined() // 15월은 날짜가 아님(학번 등)
  expect(d('1131')).toEqual({ invalid: '1131', used: 1 })
  expect(d('2026').date).toBeUndefined()
  expect(parseDateWords(['31일'], 0, '2026-01-05', 'past').date).toBe('2026-01-31') // 해를 넘기지 않음
})
