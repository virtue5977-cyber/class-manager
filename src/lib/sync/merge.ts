import { canonicalJson } from '../vault/canon'
import { rowHash } from './hash'

export interface SyncRow {
  id: string
  updated_at: string
  deleted?: boolean
  [k: string]: unknown
}

const alive = (r: SyncRow) => !r.deleted

/** 전순서 비교: 양수면 a가 이김. 살아 있음 > updated_at 늦음 > id 큼 > (같은 id·시각이면) 내용 정규 JSON 큼. */
function rank(a: SyncRow, b: SyncRow): number {
  if (alive(a) !== alive(b)) return alive(a) ? 1 : -1
  if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at ? 1 : -1
  if (a.id !== b.id) return a.id > b.id ? 1 : -1
  const ca = canonicalJson(a), cb = canonicalJson(b)
  return ca === cb ? 0 : ca > cb ? 1 : -1
}

/** 이기는 쪽. 완전히 같으면 a. 내용만 다른 동률은 정규 JSON으로 가려 입력 순서와 무관하다. */
export function winner<T extends SyncRow>(a: T, b: T): T {
  return rank(b, a) > 0 ? b : a
}

export interface Decision {
  action: 'keep' | 'take' | 'conflict'
  value: SyncRow | undefined
  conflictCopy?: SyncRow
}

const COPY_TABLES = new Set(['notes', 'counseling_logs'])

export function decide(p: {
  local: SyncRow | undefined
  remote: SyncRow | undefined
  base: string | undefined
  key: Uint8Array
  table: string
}): Decision {
  const { local, remote, base, key, table } = p
  if (!remote) return { action: 'keep', value: local }
  if (!local) return { action: 'take', value: remote }
  const lh = rowHash(key, local), rh = rowHash(key, remote)
  if (lh === rh) return { action: 'keep', value: local }
  if (rh === base) return { action: 'keep', value: local }
  if (lh === base) return { action: 'take', value: remote }
  const win = winner(local, remote)
  const d: Decision = { action: 'conflict', value: win }
  if (COPY_TABLES.has(table)) {
    const loser = win === local ? remote : local
    // 지워진 쪽이 졌으면 잃을 내용이 없다(살아 있음이 이긴다).
    if (alive(loser)) {
      d.conflictCopy = { ...loser, id: `conflict:${loser.id}:${rowHash(key, loser).slice(0, 12)}`, conflict_of: loser.id }
    }
  }
  return d
}

function bump(prev: string, now: string): string {
  const p = Date.parse(prev), n = Date.parse(now)
  return new Date(Math.max(n, Number.isNaN(p) ? n : p + 1)).toISOString()
}

const byId = (a: SyncRow, b: SyncRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** 겹침 정리(§7.6 step 3). 결과는 입력 순서와 무관(keep은 id순). 바뀐 행은 새 updated_at을 받아 keep에 들어 있다. */
export function dedupe(table: string, rows: SyncRow[], now: string): { keep: SyncRow[]; hardDelete: string[] } {
  const hardDelete: string[] = []
  let keep: SyncRow[]
  if (table === 'attendance') {
    const groups = new Map<string, SyncRow[]>()
    for (const r of rows) {
      const k = canonicalJson([r.student_id, r.date, r.kind])
      const g = groups.get(k)
      if (g) g.push(r); else groups.set(k, [r])
    }
    keep = []
    for (const g of groups.values()) {
      const w = g.reduce((a, b) => winner(a, b))
      keep.push(w)
      for (const r of g) if (r !== w && r.id !== w.id) hardDelete.push(r.id)
    }
  } else if (table === 'ai_prompts') {
    const best = new Map<string, SyncRow>()
    for (const r of rows) {
      if (!alive(r) || r.active !== true) continue
      const k = String(r.kind)
      const cur = best.get(k)
      best.set(k, cur ? winner(cur, r) : r)
    }
    keep = rows.map((r) => {
      if (!alive(r) || r.active !== true) return r
      return best.get(String(r.kind)) === r ? r : { ...r, active: false, updated_at: bump(r.updated_at, now) }
    })
  } else if (table === 'notes') {
    const best = new Map<string, SyncRow>()
    for (const r of rows) {
      if (!alive(r) || !r.notice_date) continue
      const k = String(r.notice_date)
      const cur = best.get(k)
      best.set(k, cur ? winner(cur, r) : r)
    }
    keep = rows.map((r) => {
      if (!alive(r) || !r.notice_date) return r
      if (best.get(String(r.notice_date)) === r) return r
      const { notice_date: _d, ...rest } = r
      return { ...rest, updated_at: bump(r.updated_at, now) } as SyncRow
    })
  } else {
    keep = [...rows]
  }
  keep.sort(byId)
  hardDelete.sort()
  return { keep, hardDelete }
}
