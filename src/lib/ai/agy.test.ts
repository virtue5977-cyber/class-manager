import { expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { createRoutedAiCaller } from './client'
import { effectiveMask } from '../settings'

const require = createRequire(import.meta.url)
const { agyArgs, parseAgyOutput } = require('../../../electron/agy.cjs') as {
  agyArgs: (p: string) => string[]
  parseAgyOutput: (s: string) => { text?: string; error?: string }
}

test('agy는 한 번만 답하는 계획 모드·샌드박스로 부른다', () => {
  expect(agyArgs('안녕')).toEqual(['-p', '안녕', '--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands'])
})

test('프롬프트가 20,000자를 넘으면 보내지 않는다', () => {
  expect(() => agyArgs('가'.repeat(20001))).toThrow('AI에 보낼 글이 너무 깁니다')
})

test('응답 JSON에서 response를 꺼내고, 인증·빈 응답은 한국어 안내', () => {
  expect(parseAgyOutput('{"status":"OK","response":"안녕"}')).toEqual({ text: '안녕' })
  expect(parseAgyOutput('ERROR: authentication required')).toEqual({ error: 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.' })
  expect(parseAgyOutput('{"status":"ERROR","error":"authentication required"}').error).toMatch(/로그인이 필요/)
  expect(parseAgyOutput('')).toEqual({ error: 'Antigravity 응답이 없습니다.' })
})

test('공급자가 antigravity면 agy 브리지로 보낸다(지시문과 입력을 한 글로)', async () => {
  const sent: string[] = []
  const call = createRoutedAiCaller(async () => 'antigravity', async () => 'key', () => undefined, () => ({ status: async () => ({ installed: true }), ask: async (prompt: string) => (sent.push(prompt), '결과') }))
  expect(await call({ system: '지시', user: '메모' })).toBe('결과')
  expect(sent[0]).toContain('지시')
  expect(sent[0]).toContain('메모')
})

test('Antigravity를 쓰면 이름 가림 설정과 상관없이 늘 가린다', () => {
  expect(effectiveMask({ mask_names: false, ai_provider: 'antigravity' })).toBe(true)
  expect(effectiveMask({ mask_names: false, ai_provider: 'claude-code' })).toBe(false)
})
