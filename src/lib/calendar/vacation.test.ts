import { vacationDday } from './vacation'

test('방학 D-day: 오늘 뒤 가장 가까운 "방학" 일정, 오늘이면 D-day, 지난 것·없으면 null', () => {
  const cal = [
    { date: '2026-07-20', title: '여름방학식' },
    { date: '2026-12-31', title: '겨울방학' },
    { date: '2026-12-24', title: '겨울방학식' },
    { date: '2026-11-20', title: '체육대회' },
  ]
  expect(vacationDday(cal, '2026-11-11')).toEqual({ title: '겨울방학식', days: 43, label: '방학 D-43' })
  expect(vacationDday(cal, '2026-12-24')!.label).toBe('방학 D-day')
  expect(vacationDday(cal, '2027-01-02')).toBeNull()
  expect(vacationDday([], '2026-11-11')).toBeNull()
})
