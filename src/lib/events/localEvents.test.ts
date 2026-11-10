import { createDb } from '../db/schema'
import { addLocalEvent, listLocalEvents } from './localEvents'

test('기간이 겹치는 내 일정만', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await addLocalEvent(db, { date: '2026-11-12', title: '협의회', tag: '업무' })
  await addLocalEvent(db, { date: '2026-11-09', end_date: '2026-11-11', title: '연수', tag: '업무' })
  await addLocalEvent(db, { date: '2026-12-01', title: '병원', tag: '개인' })
  expect((await listLocalEvents(db, '2026-11-11', '2026-11-30')).map((e) => e.title).sort()).toEqual(['연수', '협의회'])
})
