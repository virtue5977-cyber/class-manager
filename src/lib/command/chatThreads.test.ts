import { createDb } from '../db/schema'
import { appendChat, deleteThread, listThreads, listChat } from './chatLog'
import { currentThread, newThread, setCurrentThread, LEGACY_THREAD } from './chatThreads'

const e = (input: string) => ({ input, mode: 'rule' as const, summary: 's', links: [], status: '성공' as const })

test('대화 묶음: 새 채팅이면 새 묶음, 목록은 최근 순·제목은 첫 입력, 예전 대화는 "이전 대화" 하나', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  setCurrentThread(LEGACY_THREAD)
  await appendChat(db, e('옛 대화'), new Date('2026-11-01T01:00:00Z'))
  const t1 = newThread()
  expect(currentThread()).toBe(t1)
  await appendChat(db, e('/할일 회신 걷기'), new Date('2026-11-12T01:00:00Z'))
  await appendChat(db, e('/찾기 감기'), new Date('2026-11-12T01:05:00Z'))
  const th = await listThreads(db, 2026)
  expect(th.map((x) => x.title)).toEqual(['/할일 회신 걷기', '이전 대화'])
  expect(th[0].count).toBe(2)
  expect((await listChat(db, 2026, t1)).map((c) => c.input)).toEqual(['/할일 회신 걷기', '/찾기 감기'])
  expect((await listChat(db, 2026, LEGACY_THREAD)).map((c) => c.input)).toEqual(['옛 대화'])
  await deleteThread(db, t1)
  expect((await listThreads(db, 2026)).map((x) => x.title)).toEqual(['이전 대화'])
})
