/** 지금 대화 묶음(이 기기에 기억). '새 채팅'이면 새 묶음, 예전 대화(묶음 없음)는 LEGACY_THREAD. */
import { useSyncExternalStore } from 'react'

export const LEGACY_THREAD = 'legacy'
const KEY = 'watson.chat.thread'
const subs = new Set<() => void>()
let cur: string | null = null

export function currentThread(): string {
  if (cur) return cur
  try {
    cur = localStorage.getItem(KEY) || LEGACY_THREAD
  } catch {
    cur = LEGACY_THREAD
  }
  return cur
}
export function setCurrentThread(id: string): void {
  cur = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* 기억 못 해도 됨 */
  }
  subs.forEach((f) => f())
}
/** 새 채팅: 새 묶음을 지금 묶음으로 */
export function newThread(): string {
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  setCurrentThread(id)
  return id
}
export function useCurrentThread(): string {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), currentThread, currentThread)
}
