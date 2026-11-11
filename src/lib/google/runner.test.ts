import { createSyncRunner } from './runner'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('바뀜 알림은 delay 동안 모아 한 번만 돈다', async () => {
  const run = vi.fn(async () => {})
  const r = createSyncRunner(run, 10_000)
  r.poke()
  await vi.advanceTimersByTimeAsync(5000)
  r.poke()
  await vi.advanceTimersByTimeAsync(9999)
  expect(run).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(run).toHaveBeenCalledTimes(1)
  r.stop()
})

test('도는 중에 또 부르면 겹쳐 돌지 않고, 끝난 뒤 한 번 더 돈다', async () => {
  let release!: () => void
  const run = vi.fn(() => new Promise<void>((res) => (release = res)))
  const r = createSyncRunner(run, 0)
  void r.now()
  void r.now()
  void r.now()
  expect(run).toHaveBeenCalledTimes(1)
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(run).toHaveBeenCalledTimes(2)
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(run).toHaveBeenCalledTimes(2)
  r.stop()
})

test('실패해도 다음 부름은 돈다, stop 뒤에는 돌지 않는다', async () => {
  const run = vi.fn(async () => {
    throw new Error('x')
  })
  const r = createSyncRunner(run, 100)
  await r.now()
  await r.now()
  expect(run).toHaveBeenCalledTimes(2)
  r.poke()
  r.stop()
  await vi.advanceTimersByTimeAsync(200)
  expect(run).toHaveBeenCalledTimes(2)
})
