// @vitest-environment node
import { createGeminiCaller, GEMINI_MODELS } from './gemini'
import { createRoutedAiCaller } from './client'
import { effectiveMask } from '../settings'

test('Gemini: 주소·키 헤더·모델·system·user를 담아 부르고 글만 돌려준다(키는 본문·주소에 없음)', async () => {
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = []
  const call = createGeminiCaller(async () => ' AIza-test ', async () => 'gemini-3.5-flash-lite', async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '안' }, { text: '녕' }] } }] }) }
  })
  expect(await call({ system: '시스템', user: '사용자' })).toBe('안녕')
  expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
  expect(calls[0].init.headers['x-goog-api-key']).toBe('AIza-test')
  const body = JSON.parse(calls[0].init.body)
  expect(body.systemInstruction.parts[0].text).toBe('시스템')
  expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: '사용자' }] })
  expect(calls[0].url + calls[0].init.body).not.toContain('AIza-test')
})

test('Gemini: 모르는 모델은 기본(gemini-3.6-flash), 키 없음·400 키 오류·429·차단·빈 답은 한국어 문구', async () => {
  expect(GEMINI_MODELS[0].id).toBe('gemini-3.6-flash')
  const urls: string[] = []
  const ok = createGeminiCaller(async () => 'k', async () => 'zzz', async (u) => (urls.push(u), { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }) }))
  await ok({ system: '', user: '' })
  expect(urls[0]).toContain('/models/gemini-3.6-flash:')
  await expect(createGeminiCaller(async () => '', async () => '')({ system: '', user: '' })).rejects.toThrow('구글 API 키')
  const st = (status: number, json: unknown = {}) => createGeminiCaller(async () => 'k', async () => '', async () => ({ ok: false, status, json: async () => json }))
  await expect(st(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid' } })({ system: '', user: '' })).rejects.toThrow('구글 API 키가 올바르지 않습니다')
  await expect(st(403)({ system: '', user: '' })).rejects.toThrow('구글 API 키가 올바르지 않습니다')
  await expect(st(429)({ system: '', user: '' })).rejects.toThrow('사용 한도')
  const blocked = createGeminiCaller(async () => 'k', async () => '', async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }))
  await expect(blocked({ system: '', user: '' })).rejects.toThrow('AI 응답이 비어 있습니다')
  await expect(createGeminiCaller(async () => 'k', async () => '', async () => { throw new TypeError('Failed to fetch') })({ system: '', user: '' })).rejects.toThrow('구글 AI에 연결하지 못했습니다')
})

test('연결 방식 gemini면 Gemini로, 구글 연결은 이름을 늘 가린다', async () => {
  const call = createRoutedAiCaller(async () => 'gemini', async () => 'claude', () => undefined, () => undefined, async () => 'gemini 답')
  expect(await call({ system: '', user: '' })).toBe('gemini 답')
  expect(effectiveMask({ mask_names: false, ai_provider: 'gemini' })).toBe(true)
  expect(effectiveMask({ mask_names: false, ai_provider: 'api-key' })).toBe(false)
})
