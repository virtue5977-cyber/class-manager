import { createDb } from '../db/schema'
import { addLocalEvent, listLocalEvents } from './localEvents'

test('기간이 겹치는 내 일정만', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await addLocalEvent(db, { date: '2026-11-12', title: '협의회', tag: '업무' })
  await addLocalEvent(db, { date: '2026-11-09', end_date: '2026-11-11', title: '연수', tag: '업무' })
  await addLocalEvent(db, { date: '2026-12-01', title: '병원', tag: '개인' })
  expect((await listLocalEvents(db, '2026-11-11', '2026-11-30')).map((e) => e.title).sort()).toEqual(['연수', '협의회'])
})

test('내 일정 고치기: 제목·날짜·시각·장소·메모·태그, 빈 제목과 거꾸로 날짜는 막음', async () => {
  const { updateLocalEvent } = await import('./localEvents')
  const db = createDb('test-' + crypto.randomUUID())
  const e = await addLocalEvent(db, { date: '2026-11-12', title: '협의회', tag: '업무', place: '회의실' })
  expect(e.place).toBe('회의실')
  const u = await updateLocalEvent(db, e.id, { title: '학년 협의회', time: '15:30', place: '3층 시청각실', memo: '자료 챙기기', tag: '개인', end_date: '2026-11-13' })
  expect([u.title, u.time, u.place, u.memo, u.tag, u.end_date]).toEqual(['학년 협의회', '15:30', '3층 시청각실', '자료 챙기기', '개인', '2026-11-13'])
  await expect(updateLocalEvent(db, e.id, { title: '  ' })).rejects.toThrow('일정 제목을 입력하세요.')
  await expect(updateLocalEvent(db, e.id, { end_date: '2026-11-01' })).rejects.toThrow('끝 날짜가 시작 날짜보다 앞입니다.')
})
