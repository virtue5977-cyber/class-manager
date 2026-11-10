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
/** Ctrl+Z로 되돌릴 마지막 결과 */
let lastUndoable: string | null = null

export function remember(chatId: string, result: RunResult | undefined): void {
  if (!result) return
  live.set(chatId, { result, undo: result.undo ? makeUndo(result.undo) : undefined })
  if (result.undo) lastUndoable = chatId
  for (const l of listeners) l()
}

/** 마지막 명령 되돌리기(10초 안, 한 번). 되돌린 결과의 요약, 못 했으면 null. */
export async function undoLast(): Promise<string | null> {
  const id = lastUndoable
  const l = id ? live.get(id) : undefined
  if (!id || !l?.undo) return null
  const ok = await l.undo.undo()
  lastUndoable = null
  if (!ok) return null
  live.set(id, { result: l.result }) // 카드의 되돌리기 단추를 없앤다
  for (const x of listeners) x()
  return l.result.summary
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
