// @vitest-environment node
import { createAiCaller, createRoutedAiCaller, extractJson, AI_MODEL } from './client'

test('키·헤더·모델을 담아 호출하고 글자만 돌려준다', async () => {
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = []
  const call = createAiCaller(async () => ' sk-test ', async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '안녕' }] }) }
  })
  expect(await call({ system: 's', user: 'u' })).toBe('안녕')
  expect(calls[0].init.headers['x-api-key']).toBe('sk-test')
  expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: AI_MODEL, system: 's', messages: [{ role: 'user', content: 'u' }] })
})

test('키 없음·401·429·네트워크 오류는 한국어 문구', async () => {
  await expect(createAiCaller(async () => '')({ system: '', user: '' })).rejects.toThrow('설정에서 AI 키를 먼저 입력하세요.')
  const st = (status: number) => createAiCaller(async () => 'k', async () => ({ ok: false, status, json: async () => ({}) }))
  await expect(st(401)({ system: '', user: '' })).rejects.toThrow('AI 키가 올바르지 않습니다')
  await expect(st(429)({ system: '', user: '' })).rejects.toThrow('AI 사용 한도')
  await expect(createAiCaller(async () => 'k', async () => { throw new Error('x') })({ system: '', user: '' })).rejects.toThrow('AI에 연결하지 못했습니다')
})

test('extractJson: 코드 블록·앞뒤 설명 허용', () => {
  expect(extractJson('설명\n```json\n{"items":[1]}\n```')).toEqual({ items: [1] })
  expect(extractJson('결과: [{"a":1}] 끝')).toEqual([{ a: 1 }])
  expect(() => extractJson('없음')).toThrow('AI 응답 형식')
})

test('Claude Code 경로: exe면 기본 Claude Code, 키 선택 시 키, 브리지 없으면 안내, IPC 오류 문구 정리', async () => {
  const key = async () => '키 결과'
  const bridge = { status: async () => ({ installed: true }), ask: async () => 'CC 결과' }
  expect(await createRoutedAiCaller(async () => undefined, key, () => bridge)({ system: '', user: '' })).toBe('CC 결과')
  expect(await createRoutedAiCaller(async () => 'api-key', key, () => bridge)({ system: '', user: '' })).toBe('키 결과')
  expect(await createRoutedAiCaller(async () => undefined, key, () => undefined)({ system: '', user: '' })).toBe('키 결과')
  await expect(createRoutedAiCaller(async () => 'claude-code', key, () => undefined)({ system: '', user: '' })).rejects.toThrow('exe 버전에서만')
  const bad = { status: async () => ({ installed: true }), ask: async () => { throw new Error("Error invoking remote method 'ai:ask': Error: Claude Code에 로그인되어 있지 않습니다.") } }
  await expect(createRoutedAiCaller(async () => 'claude-code', key, () => bad)({ system: '', user: '' })).rejects.toThrow(/^Claude Code에 로그인되어 있지 않습니다\.$/)
})
