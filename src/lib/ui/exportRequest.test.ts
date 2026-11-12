import { requestExport, takeExport } from './exportRequest'

test('내보내기 부탁: 그 화면 주소에서만, 5초 안에만, 한 번만', () => {
  vi.useFakeTimers()
  window.location.hash = '#/calendar'
  requestExport('/attendance/stats', 'xlsx')
  expect(takeExport()).toBeNull() // 다른 화면은 못 받는다
  window.location.hash = '#/attendance/stats?x=1'
  expect(takeExport()).toBe('xlsx')
  expect(takeExport()).toBeNull()
  requestExport('/attendance/stats', 'pdf')
  vi.advanceTimersByTime(6000)
  expect(takeExport()).toBeNull() // 오래된 부탁은 버린다
  vi.useRealTimers()
})
