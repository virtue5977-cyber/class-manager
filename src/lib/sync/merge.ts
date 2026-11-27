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
      const { notice_date: _nd, pinned: _pin, ...rest } = loser // 사본이 전달사항 짝·고정이 되면 안 된다(폴더는 유지)
      d.conflictCopy = { ...rest, id: `conflict:${loser.id}:${rowHash(key, loser).slice(0, 12)}`, conflict_of: loser.id }
    }
  }
  return d
}

/** 바뀐 행의 새 updated_at: 그 행과 그 묶음 승자 중 늦은 쪽 + 1ms. 자료만으로 정해져 PC마다 같다(시계 무관). */
function bump(a: string, b: string): string {
  const t = Math.max(Date.parse(a), Date.parse(b))
  if (Number.isNaN(t)) throw new Error('updated_at이 ISO 날짜가 아닙니다')
  return new Date(t + 1).toISOString()
}

const byId = (a: SyncRow, b: SyncRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * 겹침 정리(§7.6 step 3). 결과는 입력 순서와 무관(keep은 id순). 바뀐 행은 새 updated_at을 받아 keep에 들어 있다.
 * 시계(now)를 쓰지 않는다: 두 PC가 같은 자료에서 바이트까지 같은 결과를 내야 base 해시 논리로 영영 갈라지지 않는다.
 *
 * S5가 지켜야 할 것:
 *  (a) hardDelete 행은 keep을 bulkPut하기 전에 이 PC에서 지운다(고유 색인 충돌 방지).
 *  (b) 하드 삭제되는 출결 id를 가리키는 report_attendance 연결은 결정적으로 다시 잇거나 지움 표시한다.
 *  (c) 받기(take)·합치기 결과의 base 해시는 업로드 성공 뒤만이 아니라 그 자리에서 갱신한다.
 */
export function dedupe(table: string, rows: SyncRow[]): { keep: SyncRow[]; hardDelete: string[] } {
  const ids = new Set<string>()
  for (const r of rows) {
    if (ids.has(r.id)) throw new Error(`dedupe: 같은 id가 둘 이상입니다(${table})`)
    ids.add(r.id)
  }
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
      for (const r of g) if (r !== w) hardDelete.push(r.id)
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
      const w = best.get(String(r.kind))!
      return w === r ? r : { ...r, active: false, updated_at: bump(r.updated_at, w.updated_at) }
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
      const w = best.get(String(r.notice_date))!
      if (w === r) return r
      const { notice_date: _d, ...rest } = r
      return { ...rest, updated_at: bump(r.updated_at, w.updated_at) } as SyncRow
    })
  } else {
    keep = [...rows]
  }
  keep.sort(byId)
  hardDelete.sort()
  return { keep, hardDelete }
}
