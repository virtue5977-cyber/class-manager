// @vitest-environment node
import { createDb } from '../db/schema'
import type { AiRequest } from '../ai/client'
import { runBriefing, getBriefing, saveBriefingItems, BRIEFING_OUTPUT_FORMAT } from './briefing'

test('정리 결과를 조례·종례에 덧붙이고 이름은 가렸다가 되돌린다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await saveBriefingItems(db, '2026-11-05', '조례', [{ text: '기존', order: 0, done: true }])
  let sent: AiRequest | undefined
  const ai = async (req: AiRequest) => {
    sent = req
    const p = req.user.match(/학생[A-Z]/)![0]
    return JSON.stringify({ 조례: [`${p}는 상장 받으러 교무실`, '3교시 후 강당'], 종례: ['동의서 내일까지'] })
  }
  const n = await runBriefing(db, ai, '김지훈 상장 수령. 3교시 후 강당 교육. 동의서 회수', '2026-11-05', ['김지훈'])
  expect(n).toEqual({ 조례: 2, 종례: 1 })
  expect(sent!.system).toContain(BRIEFING_OUTPUT_FORMAT)
  expect(sent!.system).toContain('11월 5일')
  expect(sent!.user).not.toContain('김지훈')
  expect((await getBriefing(db, '2026-11-05', '조례'))!.items.map((i) => i.text)).toEqual(['기존', '김지훈은 상장 받으러 교무실', '3교시 후 강당'])
  expect((await getBriefing(db, '2026-11-05', '종례'))!.items).toMatchObject([{ text: '동의서 내일까지', done: false, order: 0 }])
  expect(await db.notices.count()).toBe(1)
})
