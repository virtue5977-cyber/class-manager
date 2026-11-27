import { useEffect, useState } from 'react'
import { liveQuery, type Subscription } from 'dexie'
import type { AppDB } from '../db/schema'
import type { CounselingLogRec } from '../db/types'

/** 같은 학급의 누가기록(지운 것 뺀, 날짜 오름차순). 페이지·사이드바 배지·전체 목록이 한 번의 읽기를 나눠 쓴다. */
interface Entry {
  listeners: Set<(logs: CounselingLogRec[]) => void>
  value?: CounselingLogRec[]
  sub?: Subscription
}
const stores = new WeakMap<AppDB, Map<string, Entry>>()

const byDate = (a: CounselingLogRec, b: CounselingLogRec) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created_at < b.created_at ? -1 : 1)

async function readClassLogs(db: AppDB, classId: string): Promise<CounselingLogRec[]> {
  const ids = (await db.students.where('class_id').equals(classId).toArray()).filter((s) => !s.deleted).map((s) => s.id)
  if (ids.length === 0) return []
  return (await db.counseling_logs.where('student_id').anyOf(ids).toArray()).filter((l) => !l.deleted).sort(byDate)
}

function acquire(db: AppDB, classId: string, listener: (logs: CounselingLogRec[]) => void): () => void {
  let m = stores.get(db)
  if (!m) stores.set(db, (m = new Map()))
  let e = m.get(classId)
  if (!e) {
    const entry: Entry = { listeners: new Set() }
    e = entry
    m.set(classId, entry)
    entry.sub = liveQuery(() => readClassLogs(db, classId)).subscribe({
      next: (v) => { entry.value = v; entry.listeners.forEach((f) => f(v)) },
      error: () => {},
    })
  }
  e.listeners.add(listener)
  if (e.value) listener(e.value)
  const entry = e
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) {
      entry.sub?.unsubscribe()
      m!.delete(classId)
    }
  }
}

/** 시험용: 이 학급의 누가기록을 듣는 곳의 수 */
export function logSubscriberCount(db: AppDB, classId: string): number {
  return stores.get(db)?.get(classId)?.listeners.size ?? 0
}

/** undefined: 아직 읽는 중(또는 학급 없음). 값이 바뀌면 자료가 바뀐 것이다. */
export function useCounselingLogs(db: AppDB, classId: string | undefined): CounselingLogRec[] | undefined {
  const [state, setState] = useState<{ key: string; logs: CounselingLogRec[] }>()
  useEffect(() => {
    if (!classId) return
    const key = `${classId}`
    return acquire(db, classId, (logs) => setState({ key, logs }))
  }, [db, classId])
  return classId && state?.key === classId ? state.logs : undefined
}
