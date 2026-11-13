/** 창을 닫거나 숨길 때 바로 해야 하는 '미뤄 둔 저장'들. 등록하면 해제 함수를 돌려준다. */
const jobs = new Set<() => void>()

export function registerFlush(fn: () => void): () => void {
  jobs.add(fn)
  return () => void jobs.delete(fn)
}

export function flushAll(): void {
  for (const fn of [...jobs]) {
    try {
      fn()
    } catch {
      /* 하나가 실패해도 나머지는 저장 */
    }
  }
}
