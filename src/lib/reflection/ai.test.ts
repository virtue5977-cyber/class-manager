import { createDb } from '../db/schema'
import { updateSettings } from '../settings'
import type { AiRequest } from '../ai/client'
import { fillByAi } from './ai'

test('사유만 보내고(이름 가림) 16줄을 받는다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { ai_enabled: true })
  const sent: AiRequest[] = []
  const lines = Array.from({ length: 16 }, (_, i) => `${i + 1}번째 반성 문장입니다.`)
  const out = await fillByAi(db, async (r) => (sent.push(r), JSON.stringify({ lines })), '박도윤이 수업 중 휴대폰 사용', ['박도윤'])
  expect(out).toEqual(lines)
  expect(JSON.stringify(sent)).not.toContain('박도윤')
  await expect(fillByAi(db, async () => '{"lines":["하나"]}', '지각', [])).rejects.toThrow('16줄을 받지 못했습니다.')
  await updateSettings(db, { ai_enabled: false })
  await expect(fillByAi(db, async () => '', '지각', [])).rejects.toThrow('AI가 꺼져 있습니다')
})
