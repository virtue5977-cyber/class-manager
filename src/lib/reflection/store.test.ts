import { createDb } from '../db/schema'
import { listPhrases, listReflections, saveReflection, starPhrase, DEFAULT_LINES } from './store'

test('모음은 처음에 기본 16문장, 별표 추가; 반성문 저장', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  expect(DEFAULT_LINES).toHaveLength(16)
  expect((await listPhrases(db)).length).toBe(16)
  await starPhrase(db, '새 문장')
  expect((await listPhrases(db)).length).toBe(17)
  await starPhrase(db, '새 문장')
  expect((await listPhrases(db)).length).toBe(17)
  await saveReflection(db, { student_id: 's', date: '2026-11-10', reason: '지각', lines: DEFAULT_LINES, t1: 'a', t2: 'b', mode: 'B4' })
  expect((await listReflections(db, 's')).length).toBe(1)
})
