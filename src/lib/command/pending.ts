/** 보냈지만 아직 대답이 오지 않은 말(화면에 바로 올리고, 대답 동안 ● ● ●). */
import { useSyncExternalStore } from 'react'

export interface PendingChat {
  id: string
  input: string
  thread: string
  at: string
  /** 대답이 저장된 기록 id(화면 목록에 나타나면 대기 말풍선을 감춘다) */
  chatId?: string
}

let list: PendingChat[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function addPending(p: Omit<PendingChat, 'id' | 'at'>): string {
  const id = crypto.randomUUID()
  list = [...list, { ...p, id, at: new Date().toISOString() }]
  emit()
  return id
}
export function removePending(id: string): void {
  list = list.filter((p) => p.id !== id)
  emit()
}
/** 대답이 저장됐다: 기록 id를 달고, 잠시 뒤 뺀다(목록이 늦게 그려져도 빈 틈이 없게). */
export function resolvePending(id: string, chatId: string, ms = 2000): void {
  list = list.map((p) => (p.id === id ? { ...p, chatId } : p))
  emit()
  setTimeout(() => removePending(id), ms)
}
export function pendingList(): PendingChat[] {
  return list
}
export function usePending(): PendingChat[] {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => list,
  )
}

let tail: Promise<unknown> = Promise.resolve()
/** 줄 세워 차례로 실행(앞의 것이 실패해도 다음은 돈다) */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => undefined)
  return run
}

/** 테스트용: 비우기 */
export function resetPending(): void {
  list = []
  tail = Promise.resolve()
  emit()
}
