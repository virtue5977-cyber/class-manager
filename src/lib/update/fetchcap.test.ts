// @vitest-environment node
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { fetchCapped } = require('../../../electron/fetchcap.cjs') as {
  fetchCapped: (f: typeof fetch, url: string, init: RequestInit, o: { timeoutMs: number; maxBytes: number }) => Promise<Buffer>
}

test('받기: 크기 한도를 넘으면 그만두고, 오래 걸리면 시간 초과', async () => {
  const ok = (n: number) => (async () => new Response(new Uint8Array(n))) as unknown as typeof fetch
  expect((await fetchCapped(ok(5), 'u', {}, { timeoutMs: 1000, maxBytes: 10 })).length).toBe(5)
  await expect(fetchCapped(ok(11), 'u', {}, { timeoutMs: 1000, maxBytes: 10 })).rejects.toThrow('받을 파일이 너무 큽니다.')
  const hang = ((_u: string, i: RequestInit) => new Promise((_r, rej) => i.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
  await expect(fetchCapped(hang, 'u', {}, { timeoutMs: 20, maxBytes: 10 })).rejects.toThrow('시간이 너무 오래 걸려')
  const bad = (async () => new Response('x', { status: 404 })) as unknown as typeof fetch
  await expect(fetchCapped(bad, 'u', {}, { timeoutMs: 1000, maxBytes: 10 })).rejects.toThrow('404')
})
