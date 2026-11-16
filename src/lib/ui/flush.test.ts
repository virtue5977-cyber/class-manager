import { expect, test, vi } from 'vitest'
import { flushAll, registerFlush, wireBeforeClose } from './flush'

test('flushAll이 느린 저장(100ms)까지 기다린다', async () => {
  let done = false
  const off = registerFlush(() => new Promise<void>((r) => setTimeout(() => { done = true; r() }, 100)))
  await flushAll()
  expect(done).toBe(true)
  off()
})

test('flushAll은 하나가 던지거나 거부해도 나머지를 기다리고 끝난다', async () => {
  let ok = false
  const o1 = registerFlush(() => { throw new Error('x') })
  const o2 = registerFlush(() => Promise.reject(new Error('y')))
  const o3 = registerFlush(async () => { await new Promise((r) => setTimeout(r, 20)); ok = true })
  await expect(flushAll()).resolves.toBeUndefined()
  expect(ok).toBe(true)
  o1(); o2(); o3()
})

test('onBeforeClose 콜백이 flushAll 뒤에 끝난다(가짜 desktop)', async () => {
  let cb: (() => Promise<void>) | undefined
  const unsub = vi.fn()
  const desktop = { app: { onBeforeClose: (f: () => Promise<void>) => { cb = f; return unsub } } }
  let saved = false
  const off = registerFlush(() => new Promise<void>((r) => setTimeout(() => { saved = true; r() }, 50)))
  const un = wireBeforeClose(desktop)
  expect(cb).toBeTypeOf('function')
  await cb!()
  expect(saved).toBe(true)
  un()
  expect(unsub).toHaveBeenCalled()
  off()
  expect(wireBeforeClose({})()).toBeUndefined()
})
