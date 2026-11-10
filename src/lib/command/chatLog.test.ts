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

test('지운 대화는 글을 남기지 않는다(건강 사유 등)', async () => {
  const { deleteChat } = await import('./chatLog')
  const db = createDb('test-' + crypto.randomUUID())
  const c = await appendChat(db, { input: '/출결 @3 결석 질병 장염', mode: 'rule', summary: '장염', links: [{ label: 'x', to: '/' }], status: '성공' })
  await deleteChat(db, c.id)
  expect(await db.chat_log.get(c.id)).toMatchObject({ deleted: true, input: '', summary: '', links: [] })
})
