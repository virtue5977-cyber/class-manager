import { createDb } from '../db/schema'
import { updateSettings } from '../settings'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import type { AiRequest } from '../ai/client'
import { splitNoticesByAi } from './aiSplit'

test('전달사항 AI 나누기: 넘긴 명단에 없는(다른 반) 학생 이름도 가린다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { ai_enabled: true })
  const c = await createClass(db, { school_year: 2025, grade: 2, class_no: 1 })
  await saveStudent(db, c.id, emptyStudent(7, '오다은'))
  const sent: AiRequest[] = []
  const out = await splitNoticesByAi(db, async (r) => (sent.push(r), JSON.stringify({ 조례: ['학생A 상담'] })), '오다은 상담 일정', '2026-11-10', [])
  expect(JSON.stringify(sent)).not.toContain('오다은')
  expect(out).toEqual(['오다은 상담'])
})
