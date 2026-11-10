import { useSyncExternalStore } from 'react'
import type { RunResult } from '../../lib/command/run'
import { makeUndo } from '../../lib/command/run'

/** 이번에 켠 동안 실행한 결과(되돌리기·카드 내용). 대화 기록 표에는 요약만 남는다. */
export interface Live {
  result: RunResult
  undo?: ReturnType<typeof makeUndo>
}
const live = new Map<string, Live>()
const listeners = new Set<() => void>()

export function remember(chatId: string, result: RunResult | undefined): void {
  if (!result) return
  live.set(chatId, { result, undo: result.undo ? makeUndo(result.undo) : undefined })
  for (const l of listeners) l()
}
export const recall = (chatId: string): Live | undefined => live.get(chatId)

/** 결과가 나중에 들어와도(기록 줄이 먼저 그려짐) 다시 그리도록 구독한다. */
export function useRecall(chatId: string): Live | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => live.get(chatId),
  )
}
