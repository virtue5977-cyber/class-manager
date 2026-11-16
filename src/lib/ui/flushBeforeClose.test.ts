import { expect, test } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { makeOnBeforeClose } = require('../../../electron/beforeClose.cjs') as { makeOnBeforeClose: (ipc: unknown) => (cb: () => Promise<void>) => () => void }

function fakeIpc() {
  const handlers = new Map<string, (...a: unknown[]) => void>()
  const sent: string[] = []
  return {
    sent, handlers,
    on: (c: string, h: (...a: unknown[]) => void) => handlers.set(c, h),
    removeListener: (c: string) => handlers.delete(c),
    send: (c: string) => sent.push(c),
  }
}

test('preload onBeforeClose: 준비를 알리고, 콜백이 끝난 뒤에 close-ok를 보낸다', async () => {
  const ipc = fakeIpc()
  let finished = false
  const un = makeOnBeforeClose(ipc)(async () => { await new Promise((r) => setTimeout(r, 30)); finished = true })
  expect(ipc.sent).toEqual(['app:before-close-ready'])
  const p = ipc.handlers.get('app:before-close')!()
  await new Promise((r) => setTimeout(r, 5))
  expect(ipc.sent).not.toContain('app:close-ok')
  await p
  expect(finished).toBe(true)
  expect(ipc.sent).toContain('app:close-ok')
  un()
  expect(ipc.handlers.has('app:before-close')).toBe(false)
})

test('콜백이 실패해도 close-ok는 보낸다', async () => {
  const ipc = fakeIpc()
  makeOnBeforeClose(ipc)(async () => { throw new Error('x') })
  await ipc.handlers.get('app:before-close')!()
  expect(ipc.sent).toContain('app:close-ok')
})
