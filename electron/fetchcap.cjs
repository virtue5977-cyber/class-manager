// 업데이트 받기: 시간 제한과 크기 제한(멈추거나 끝없이 큰 응답으로 앱이 묶이지 않게).
async function fetchCapped(fetchFn, url, init, { timeoutMs, maxBytes }) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal })
    if (!res.ok) throw new Error(`${url} ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len > maxBytes) throw new Error('받을 파일이 너무 큽니다.')
    const chunks = []
    let total = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        ctl.abort()
        throw new Error('받을 파일이 너무 큽니다.')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)))
  } catch (e) {
    if (ctl.signal.aborted && !(e instanceof Error && e.message === '받을 파일이 너무 큽니다.')) throw new Error('시간이 너무 오래 걸려 그만두었습니다.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { fetchCapped }
