import { expect, test, vi } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createCloseFlow } = require('../../../electron/closeFlow.cjs') as { createCloseFlow: (o: unknown) => { onClose(e: { preventDefault(): void }): void; onCloseOk(): void; onSessionEnd(): void; setReady(v: boolean): void } }

function make() {
  const send = vi.fn(), destroy = vi.fn()
  let fire: (() => void) | undefined
  const setTimer = vi.fn((f: () => void) => { fire = f; return 1 })
  const clearTimer = vi.fn()
  const f = createCloseFlow({ send, destroy, setTimer, clearTimer, timeoutMs: 3000 })
  f.setReady(true)
  const ev = () => ({ preventDefault: vi.fn() })
  return { f, send, destroy, setTimer, clearTimer, fire: () => fire!(), ev }
}

test('첫 close는 막고 before-close를 보내며 3초 타이머를 건다', () => {
  const t = make(); const e = t.ev()
  t.f.onClose(e)
  expect(e.preventDefault).toHaveBeenCalled()
  expect(t.send).toHaveBeenCalledTimes(1)
  expect(t.setTimer).toHaveBeenCalledWith(expect.any(Function), 3000)
  expect(t.destroy).not.toHaveBeenCalled()
})

test('close-ok면 한 번만 destroy하고 타이머를 지운다', () => {
  const t = make(); t.f.onClose(t.ev())
  t.f.onCloseOk(); t.f.onCloseOk()
  expect(t.destroy).toHaveBeenCalledTimes(1)
  expect(t.clearTimer).toHaveBeenCalled()
  t.fire()
  expect(t.destroy).toHaveBeenCalledTimes(1)
})

test('시간 초과면 한 번만 destroy한다', () => {
  const t = make(); t.f.onClose(t.ev())
  t.fire(); t.f.onCloseOk()
  expect(t.destroy).toHaveBeenCalledTimes(1)
})

test('기다리는 중 또 close가 와도 다시 보내지 않고 막는다', () => {
  const t = make(); t.f.onClose(t.ev())
  const e2 = t.ev(); t.f.onClose(e2)
  expect(e2.preventDefault).toHaveBeenCalled()
  expect(t.send).toHaveBeenCalledTimes(1)
})

test('destroy 뒤 close는 막지 않는다', () => {
  const t = make(); t.f.onClose(t.ev()); t.f.onCloseOk()
  const e = t.ev(); t.f.onClose(e)
  expect(e.preventDefault).not.toHaveBeenCalled()
})

test('화면이 준비를 알리지 않았으면 막지 않는다', () => {
  const t = make(); t.f.setReady(false)
  const e = t.ev(); t.f.onClose(e)
  expect(e.preventDefault).not.toHaveBeenCalled()
  expect(t.send).not.toHaveBeenCalled()
})

test('세션 종료는 보내기만 하고 막지 않는다(이후 close도 통과)', () => {
  const t = make()
  t.f.onSessionEnd()
  expect(t.send).toHaveBeenCalledTimes(1)
  const e = t.ev(); t.f.onClose(e)
  expect(e.preventDefault).not.toHaveBeenCalled()
  expect(t.setTimer).not.toHaveBeenCalled()
})

test('재시작 경로: 준비된 화면에는 보내고 close-ok까지 기다린다', async () => {
  const t = make()
  let resolved = false
  const p = (t.f as unknown as { beforeRestart(): Promise<void> }).beforeRestart().then(() => { resolved = true })
  expect(t.send).toHaveBeenCalledTimes(1)
  await Promise.resolve()
  expect(resolved).toBe(false)
  t.f.onCloseOk()
  await p
  expect(resolved).toBe(true)
  expect(t.destroy).not.toHaveBeenCalled()
})

test('재시작 경로: 시간 초과에도 풀리고, 준비 안 된 화면은 바로 풀린다', async () => {
  const t = make()
  const p = (t.f as unknown as { beforeRestart(): Promise<void> }).beforeRestart()
  t.fire()
  await p
  const u = make(); u.f.setReady(false)
  await (u.f as unknown as { beforeRestart(): Promise<void> }).beforeRestart()
  expect(u.send).not.toHaveBeenCalled()
})
