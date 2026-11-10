import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'

/** Dexie liveQuery 결과를 상태로(자료가 바뀌면 다시 읽음). deps가 바뀌면 다시 구독. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial)
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setV, error: () => {} })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return v
}
