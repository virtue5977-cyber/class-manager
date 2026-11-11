/** 자동 맞춤 돌리기: poke()는 delay 동안 모아 한 번, now()는 바로. 도는 중이면 겹치지 않고 끝난 뒤 한 번 더. 실패는 삼킨다. */
export function createSyncRunner(run: () => Promise<void>, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let again = false
  let stopped = false
  async function now(): Promise<void> {
    if (stopped) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        await run()
      } catch {
        /* 다음에 다시 */
      }
    })()
    await running
    running = null
    if (again && !stopped) {
      again = false
      return now()
    }
  }
  return {
    now,
    poke() {
      if (stopped) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void now(), delay)
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
