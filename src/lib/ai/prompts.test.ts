// @vitest-environment node
import { createDb } from '../db/schema'
import { getPrompt, savePrompt, resetPrompt, listPromptVersions, fillInstruction, DEFAULT_PROMPTS } from './prompts'

test('기본값 → 저장하면 새 버전, 이전 버전은 5개까지, 기본값으로 되돌리기', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  expect(await getPrompt(db, 'nuga')).toBe(DEFAULT_PROMPTS.nuga)
  for (let i = 1; i <= 8; i++) await savePrompt(db, 'nuga', `지시문 ${i}`)
  expect(await getPrompt(db, 'nuga')).toBe('지시문 8')
  const v = await listPromptVersions(db, 'nuga')
  expect(v.map((p) => p.instruction)).toEqual(['지시문 8', '지시문 7', '지시문 6', '지시문 5', '지시문 4', '지시문 3'])
  expect(v.filter((p) => p.active)).toHaveLength(1)
  await resetPrompt(db, 'nuga')
  expect(await getPrompt(db, 'nuga')).toBe(DEFAULT_PROMPTS.nuga)
  expect(await getPrompt(db, 'briefing')).toBe(DEFAULT_PROMPTS.briefing)
})

test('fillInstruction', () => {
  expect(fillInstruction('최대 {최대글자수}자, {날짜}', { 최대글자수: 300, 날짜: '11월 5일' })).toBe('최대 300자, 11월 5일')
  expect(fillInstruction('{최대글자수}', {})).toBe('제한 없음')
})
