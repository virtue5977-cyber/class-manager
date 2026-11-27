import type { AppDB } from '../db/schema'
import { deviceId } from '../backup/service'
import { readRaw } from '../vault/middleware'
import { SYNC_TABLES } from './tables'

/** meta 'sync' 행. 암호화하지 않는 표이므로 id·시각·기기 이름·해시만 담는다(행 내용 금지). */
export interface SyncState {
  enabled: boolean
  rootId?: string
  deviceId: string
  deviceName?: string
  lastUploadedMax?: string
  seen: Record<string, string>
  lastOk?: string
  lastError?: string
  keyUpdatedAt?: string
  firstMergeDone: boolean
}

const ID = 'sync'

export async function getSyncState(db: AppDB): Promise<SyncState> {
  const row = (await db.meta.get(ID)) as (Partial<SyncState> & { id: string }) | undefined
  const { id: _id, ...rest } = row ?? { id: ID }
  void _id
  return { enabled: false, seen: {}, firstMergeDone: false, ...rest, deviceId: await deviceId(db) }
}

export async function setSyncState(db: AppDB, patch: Partial<SyncState>): Promise<SyncState> {
  const cur = (await db.meta.get(ID)) ?? { id: ID }
  const next = { ...cur, ...patch, id: ID }
  await db.meta.put(next)
  return getSyncState(db)
}

/**
 * SYNC_TABLES 어디든 max(updated_at) > lastUploadedMax 이면 true.
 * updated_at은 암호화 DB에서도 평문 칸이라 readRaw(복호화 없이 원시 행)에서 그대로 읽는다. 복호화 없음.
 * note_files는 created_at도 보지만 암호화 DB에서는 봉인되므로 생성 시 updated_at이 함께 찍히는 점에 기댄다.
 */
export async function isDirty(db: AppDB): Promise<boolean> {
  const last = (await getSyncState(db)).lastUploadedMax ?? ''
  for (const t of SYNC_TABLES) {
    for (const r of await readRaw(db, t)) {
      if (typeof r.updated_at === 'string' && r.updated_at > last) return true
      if (t === 'note_files' && typeof r.created_at === 'string' && r.created_at > last) return true
    }
  }
  return false
}

const baseId = (table: string, id: string) => table + '\u0000' + id

/** 마지막으로 합친 행의 해시를 적는다. 호출자의 트랜잭션(sync_rows 포함) 안에서도 쓸 수 있다. */
export async function markBase(db: AppDB, entries: { table: string; id: string; hash: string }[]): Promise<void> {
  if (entries.length === 0) return
  await db.sync_rows.bulkPut(entries.map((e) => ({ id: baseId(e.table, e.id), hash: e.hash })))
}

export async function getBase(db: AppDB, table: string, ids: string[]): Promise<Map<string, string>> {
  const rows = await db.sync_rows.bulkGet(ids.map((i) => baseId(table, i)))
  const out = new Map<string, string>()
  rows.forEach((r, i) => { if (r && typeof r.hash === 'string') out.set(ids[i], r.hash) })
  return out
}
