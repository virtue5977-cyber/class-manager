/** Claude API 호출(사용자가 넣은 키, 브라우저/exe에서 직접). 키·본문은 오류 문구에 넣지 않는다. */

export const AI_MODEL = 'claude-haiku-5-5'
export const AI_URL = 'https://api.anthropic.com/v1/messages'

export interface AiRequest {
  system: string
  user: string
  maxTokens?: number
}
/** 테스트에서 바꿔 끼우는 호출 함수. 키는 안에서 읽는다. */
export type AiCaller = (req: AiRequest) => Promise<string>

export class AiError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'AiError'
  }
}

type PostFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export function createAiCaller(getKey: () => Promise<string>, doFetch: PostFetch = (u, i) => globalThis.fetch(u, i)): AiCaller {
  return async ({ system, user, maxTokens = 2000 }) => {
    const key = (await getKey()).trim()
    if (!key) throw new AiError('설정에서 AI 키를 먼저 입력하세요.', 'NO-KEY')
    let res
    try {
      res = await doFetch(AI_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      })
    } catch {
      throw new AiError('AI에 연결하지 못했습니다. 인터넷 연결을 확인하세요.', 'NETWORK')
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new AiError('AI 키가 올바르지 않습니다. 설정에서 확인하세요.', 'AUTH')
      if (res.status === 429) throw new AiError('AI 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도하거나 콘솔에서 한도를 확인하세요.', 'LIMIT')
      if (res.status >= 500) throw new AiError('AI 서버가 바쁩니다. 잠시 뒤 다시 시도하세요.', 'SERVER')
      throw new AiError(`AI 요청 오류(${res.status})`, 'HTTP')
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
    if (!text) throw new AiError('AI 응답이 비어 있습니다.', 'EMPTY')
    return text
  }
}

/** 응답에서 JSON 덩어리만 꺼낸다(```json 감싸기·앞뒤 설명 허용). */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.search(/[[{]/)
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  if (start < 0 || end < start) throw new AiError('AI 응답 형식을 읽지 못했습니다. 다시 시도하세요.', 'FORMAT')
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    throw new AiError('AI 응답 형식을 읽지 못했습니다. 다시 시도하세요.', 'FORMAT')
  }
}

/** exe의 preload가 넣어 주는 Claude Code 연결 */
export interface ClaudeCodeApi {
  /** loggedIn·message: 짧은 시험 질문 결과(새 exe). 옛 exe는 installed·version만. */
  status(): Promise<{ installed: boolean; version?: string; loggedIn?: boolean; message?: string }>
  ask(req: AiRequest): Promise<string>
}

export function getClaudeCode(): ClaudeCodeApi | undefined {
  return (globalThis as { desktop?: { ai?: ClaudeCodeApi } }).desktop?.ai
}

/** exe(SHELL 3)의 preload가 넣어 주는 Antigravity CLI 연결(구글 로그인) */
export interface AntigravityApi {
  /** loggedIn·message: 짧은 시험 질문 결과(새 exe). 옛 exe는 installed·version만. */
  status(): Promise<{ installed: boolean; version?: string; loggedIn?: boolean; message?: string }>
  ask(prompt: string): Promise<string>
}
export function getAntigravity(): AntigravityApi | undefined {
  return (globalThis as { desktop?: { agy?: AntigravityApi } }).desktop?.agy
}

/** IPC 오류 앞에 붙는 "Error invoking remote method ..." 를 떼어 낸다. */
const cleanIpcError = (e: unknown) => new AiError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace('사용량 한도(Pro 프로그램용 크레딧)', 'Pro 사용 한도'), 'CLAUDE-CODE')

/** 설정에 따라 Claude Code(Pro 구독) 또는 API 키로 부른다. 기본값: exe면 Claude Code, 아니면 키. */
export function createRoutedAiCaller(
  getProvider: () => Promise<'claude-code' | 'api-key' | 'antigravity' | undefined>,
  keyCaller: AiCaller,
  cc: () => ClaudeCodeApi | undefined = getClaudeCode,
  agy: () => AntigravityApi | undefined = getAntigravity,
): AiCaller {
  return async (req) => {
    const bridge = cc()
    const provider = (await getProvider()) ?? (bridge ? 'claude-code' : 'api-key')
    if (provider === 'api-key') return keyCaller(req)
    if (provider === 'antigravity') {
      const g = agy()
      if (!g) throw new AiError('Antigravity 연결은 새 Watson exe에서만 됩니다. 설정 > AI에서 다른 연결을 고르세요.', 'NO-BRIDGE')
      try {
        const text = await g.ask(`${req.system}\n\n# 입력\n${req.user}\n\n위 지시와 출력 형식만 따르고, 도구를 쓰거나 다른 설명을 붙이지 마세요.`)
        if (!text.trim()) throw new AiError('AI 응답이 비어 있습니다.', 'EMPTY')
        return text
      } catch (e) {
        throw e instanceof AiError ? e : cleanIpcError(e)
      }
    }
    if (!bridge) throw new AiError('Claude Code 연결은 exe 버전에서만 됩니다. 설정 > AI에서 "API 키"를 고르거나 exe 버전을 쓰세요.', 'NO-BRIDGE')
    try {
      const text = await bridge.ask(req)
      if (!text.trim()) throw new AiError('AI 응답이 비어 있습니다.', 'EMPTY')
      return text
    } catch (e) {
      throw e instanceof AiError ? e : cleanIpcError(e)
    }
  }
}
