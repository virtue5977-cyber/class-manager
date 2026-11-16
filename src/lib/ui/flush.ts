/** 창을 닫거나 숨길 때 바로 해야 하는 '미뤄 둔 저장'들. 등록하면 해제 함수를 돌려준다. 저장 Promise를 돌려주면 끝까지 기다린다. */
type Job = () => void | Promise<unknown>
const jobs = new Set<Job>()

export function registerFlush(fn: Job): () => void {
  jobs.add(fn)
  return () => void jobs.delete(fn)
}

/** 모든 작업을 시작하고 모두 끝날 때까지(성공·실패 무관) 기다린다. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled(
    [...jobs].map(async (fn) => {
      await fn() // 동기 throw도 거부로 바뀐다
    }),
  )
}

/** 닫기 전 저장: 메인이 보내는 before-close에 flushAll로 답한다. exe가 아니면 아무것도 안 한다. */
export function wireBeforeClose(desktop: { app?: { onBeforeClose?: (cb: () => Promise<void>) => (() => void) | void } } | null | undefined): () => void {
  const un = desktop?.app?.onBeforeClose?.(() => flushAll())
  return () => { if (typeof un === 'function') un() }
}
