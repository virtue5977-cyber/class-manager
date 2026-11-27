import { SYNCED_TABLES } from '../db/schema'

/** 동기화 표(spec §7.1): 백업 표에서 각 PC가 원본에서 받는 표를 뺀 것. note_files는 메타 행만(내용은 .wfile). */
const EXCLUDED = new Set<string>(['neis_cache', 'school_calendar'])
export const SYNC_TABLES: readonly (typeof SYNCED_TABLES)[number][] = SYNCED_TABLES.filter((t) => !EXCLUDED.has(t))

export type SyncTable = (typeof SYNC_TABLES)[number]

/** 추정 시간표 행은 각 PC가 나이스에서 다시 만들므로 동기화하지 않는다. */
export function syncableRow(table: string, row: { source?: unknown }): boolean {
  if (table === 'teacher_timetable' && row.source === 'estimated') return false
  return true
}
