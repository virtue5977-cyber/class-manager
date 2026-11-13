import { EXPORT_WAIT, requestExport, takeExport } from './exportRequest'

test('내보내기 부탁: 그 화면 주소에서만, 기다리는 동안만, 한 번만', async () => {
  window.location.hash = '#/calendar'
  const done = requestExport('/attendance/stats', 'xlsx')
  expect(takeExport()).toBeNull() // 다른 화면은 못 받는다
  window.location.hash = '#/attendance/stats?x=1'
  const t = takeExport()!
  expect(t.f).toBe('xlsx')
  expect(takeExport()).toBeNull()
  t.settle({ ok: true })
  await expect(done).resolves.toEqual({ ok: true })
})

test('아무 화면도 받지 않으면 실패로 알린다(내보냈다고 말하지 않게)', async () => {
  const keep = EXPORT_WAIT.ms
  EXPORT_WAIT.ms = 30
  window.location.hash = '#/calendar'
  await expect(requestExport('/attendance/stats', 'pdf')).resolves.toMatchObject({ ok: false })
  expect(takeExport()).toBeNull() // 오래된 부탁은 버린다
  EXPORT_WAIT.ms = keep
})
