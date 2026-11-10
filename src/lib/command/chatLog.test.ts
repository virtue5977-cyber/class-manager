import { createDb } from '../db/schema'
import { appendChat, clearChatOn, listChat, pruneChat, schoolYearOf } from './chatLog'

test('학년도는 3월 기준, 지난 학년도 정리, 하루 지우기', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  expect(schoolYearOf('2027-02-28')).toBe(2026)
  expect(schoolYearOf('2027-03-01')).toBe(2027)
  const e = { input: '/출결', mode: 'rule' as const, summary: 's', links: [], status: '성공' as const }
  await appendChat(db, e, new Date('2026-11-10T01:00:00Z'))
  await appendChat(db, e, new Date('2026-11-11T01:00:00Z'))
  expect((await listChat(db, 2026)).length).toBe(2)
  await clearChatOn(db, '2026-11-10')
  expect((await listChat(db, 2026)).length).toBe(1)
  expect(await pruneChat(db, '2027-03-02')).toBe(1)
  expect((await listChat(db, 2026)).length).toBe(0)
})
