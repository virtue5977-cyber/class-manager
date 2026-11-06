export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const NEIS_BASE = 'https://open.neis.go.kr/hub/'
const PAGE_SIZE = 1000

export class NeisError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'NeisError'
  }
}

type Result = { CODE: string; MESSAGE: string }
type Page<T> = Record<string, [{ head: [{ list_total_count: number }, { RESULT: Result }] }, { row: T[] }]> & { RESULT?: Result }

function defaultFetch(): FetchLike {
  return (url) => globalThis.fetch(url)
}

/** NEIS Open API 호출. 1000건씩 끝까지 이어 받는다. 오류 문구에 URL·키를 넣지 않는다. */
export async function neisRequest<T>(service: string, params: Record<string, string>, opts: { key: string; fetch?: FetchLike }): Promise<T[]> {
  const key = opts.key.trim()
  if (!key) throw new NeisError('NEIS 인증키를 먼저 입력하세요.', 'NO-KEY')
  const doFetch = opts.fetch ?? defaultFetch()
  const out: T[] = []
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ Type: 'json', pIndex: String(page), pSize: String(PAGE_SIZE), KEY: key, ...params })
    let body: Page<T>
    try {
      const res = await doFetch(`${NEIS_BASE}${service}?${qs}`)
      if (!res.ok) throw new Error(String(res.status))
      body = (await res.json()) as Page<T>
    } catch {
      throw new NeisError('NEIS에 연결하지 못했습니다. 인터넷 연결을 확인하세요.', 'NETWORK')
    }
    const result = body.RESULT ?? body[service]?.[0]?.head?.[1]?.RESULT
    if (body.RESULT) {
      if (result!.CODE === 'INFO-200') return out
      if (result!.CODE === 'ERROR-290') throw new NeisError('NEIS 인증키가 올바르지 않습니다.', result!.CODE)
      throw new NeisError(`NEIS 요청 오류: ${result!.MESSAGE}`, result!.CODE)
    }
    const block = body[service]
    if (!block) throw new NeisError('NEIS 응답 형식을 알 수 없습니다.', 'FORMAT')
    const total = block[0].head[0].list_total_count
    const rows = block[1]?.row ?? []
    out.push(...rows)
    // 1000건보다 적게 오면 마지막 쪽이다(키 없이 호출하면 total보다 적게 오기도 한다).
    if (out.length >= total || rows.length < PAGE_SIZE) return out
  }
}
