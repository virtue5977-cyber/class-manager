/** 구글 Gemini API(사용자가 넣은 API 키, 브라우저/exe에서 직접). 키·본문은 오류 문구에 넣지 않는다.
 * 모델: 구글 모델 문서(ai.google.dev/models, 2026-11)의 안정판. 무료 키는 입력이 구글 학습에 쓰일 수 있어 이름은 늘 가린다(effectiveMask). */
import { AiError, type AiCaller } from './client'

export const GEMINI_MODELS = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash(기본)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite(빠름·저렴)' },
] as const
export const GEMINI_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

type PostFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export function createGeminiCaller(getKey: () => Promise<string>, getModel: () => Promise<string | undefined>, doFetch: PostFetch = (u, i) => globalThis.fetch(u, i)): AiCaller {
  return async ({ system, user }) => {
    const key = (await getKey()).trim()
    if (!key) throw new AiError('설정 > AI에서 구글 API 키를 먼저 입력하세요.', 'NO-KEY')
    const want = await getModel()
    const model = GEMINI_MODELS.some((m) => m.id === want) ? want! : GEMINI_MODELS[0].id
    let res
    try {
      res = await doFetch(GEMINI_URL(model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }),
      })
    } catch {
      throw new AiError('구글 AI에 연결하지 못했습니다. 인터넷 연결을 확인하세요(설치형이면 새 설치형이 필요할 수 있습니다).', 'NETWORK')
    }
    if (!res.ok) {
      const err = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(err?.message ?? ''))) throw new AiError('구글 API 키가 올바르지 않습니다. 설정에서 확인하세요.', 'AUTH')
      if (res.status === 429) throw new AiError('구글 AI 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.', 'LIMIT')
      if (res.status >= 500) throw new AiError('구글 AI 서버가 바쁩니다. 잠시 뒤 다시 시도하세요.', 'SERVER')
      throw new AiError(`구글 AI 요청 오류(${res.status})`, 'HTTP')
    }
    const body = (await res.json().catch(() => {
      throw new AiError('구글 AI 응답을 읽지 못했습니다. 다시 시도하세요.', 'FORMAT')
    })) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
    const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
    if (!text.trim()) throw new AiError('AI 응답이 비어 있습니다(구글이 답을 막았을 수 있습니다).', 'EMPTY')
    return text
  }
}
