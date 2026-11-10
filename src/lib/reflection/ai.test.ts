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

test('줄을 꽉 채우도록 용지에 맞는 글자 수를 지시한다(B4가 A4보다 길게)', async () => {
  const { lineTarget } = await import('./fit')
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { ai_enabled: true })
  const b4 = lineTarget('B4')
  const a4 = lineTarget('A4')
  expect(b4.min).toBeGreaterThan(a4.min)
  expect(b4.max).toBeGreaterThan(b4.min)
  const sent: AiRequest[] = []
  const lines = Array.from({ length: 16 }, () => '문장')
  await fillByAi(db, async (r) => (sent.push(r), JSON.stringify({ lines })), '지각', [], 'A4')
  expect(sent[0].system).toContain(`${a4.min}~${a4.max}자`)
  expect(sent[0].system).not.toContain('45~70자')
})

test('넘긴 이름 목록에 없어도 앱에 있는 학생 이름은 가린다', async () => {
  const { createClass, emptyStudent, saveStudent } = await import('../roster/roster')
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { ai_enabled: true })
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 2 })
  await saveStudent(db, c.id, emptyStudent(4, '정하린'))
  const sent: AiRequest[] = []
  await fillByAi(db, async (r) => (sent.push(r), JSON.stringify({ lines: Array(16).fill('문장') })), '정하린과 싸움', [])
  expect(JSON.stringify(sent)).not.toContain('정하린')
})
