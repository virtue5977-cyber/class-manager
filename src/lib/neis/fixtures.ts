import type { FetchLike } from './client'

/** 실측 응답 형태: { 서비스: [ { head: [ {list_total_count}, {RESULT} ] }, { row: [...] } ] } */
export function neisPage(service: string, rows: unknown[], total: number = rows.length) {
  return {
    [service]: [
      { head: [{ list_total_count: total }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] },
      { row: rows },
    ],
  }
}

export function neisResult(code: string, message: string) {
  return { RESULT: { CODE: code, MESSAGE: message } }
}

/** 테스트용 fetch. handler가 URL을 받아 응답 JSON을 돌려준다. 호출한 URL을 calls에 모은다. */
export function fakeFetch(handler: (url: URL) => unknown): FetchLike & { calls: URL[] } {
  const calls: URL[] = []
  const f = (async (url: string) => {
    const u = new URL(url)
    calls.push(u)
    const body = handler(u)
    return { ok: true, status: 200, json: async () => body }
  }) as FetchLike & { calls: URL[] }
  f.calls = calls
  return f
}

/** 쪽 나눔을 흉내 낸다: pIndex·pSize에 맞춰 rows를 잘라 돌려준다. */
export function pagedHandler(service: string, rows: unknown[]) {
  return (u: URL) => {
    const i = Number(u.searchParams.get('pIndex'))
    const size = Number(u.searchParams.get('pSize'))
    const slice = rows.slice((i - 1) * size, i * size)
    return slice.length ? neisPage(service, slice, rows.length) : neisResult('INFO-200', '해당하는 데이터가 없습니다.')
  }
}
