import type { AppDB } from '../db/schema'
import { deviceId } from '../backup/service'
import { readRaw } from '../vault/middleware'
import { SYNC_TABLES } from './tables'
import { GoogleApiError, googleErrorText } from '../google/google'

export const SYNC_ERROR_CODES = ['auth', 'quota', 'storage', 'rate', 'offline', 'newer-format', 'key-mismatch', 'bad-snapshot', 'unknown'] as const
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number]

/** 오류 → 닫힌 코드. 서버 본문·행 글은 어디에도 남기지 않는다. */
export function syncErrorCode(err: unknown): SyncErrorCode {
  if (err instanceof GoogleApiError) {
    if (err.status === 401) return 'auth'
    if (err.reason === 'storageQuotaExceeded') return 'storage'
    if (err.status === 429) return 'rate'
    if (err.reason !== undefined && /quota|rateLimit|dailyLimit|RESOURCE_EXHAUSTED/i.test(err.reason)) return 'quota'
    if (err.status === 0) return 'offline'
    return 'unknown'
  }
  const m = err instanceof Error ? err.message : ''
  if (m === 'NEWER_FORMAT') return 'newer-format'
  if (m === 'KEY_MISMATCH') return 'key-mismatch'
  if (m === 'BAD_SNAPSHOT') return 'bad-snapshot'
  return 'unknown'
}

const TEXTS: Record<SyncErrorCode, string> = {
  auth: googleErrorText(401),
  quota: googleErrorText(429),
  storage: googleErrorText(403, 'storageQuotaExceeded'),
  rate: googleErrorText(429),
  offline: googleErrorText(0),
  'newer-format': '다른 기기가 더 새 버전으로 올린 자료입니다. Watson을 업데이트하세요.',
  'key-mismatch': '동기화 암호 키가 맞지 않습니다. 키를 다시 확인하세요.',
  'bad-snapshot': '드라이브의 동기화 자료가 손상되었습니다.',
  unknown: '동기화 중 오류가 났습니다. 잠시 뒤 다시 하세요.',
}
export const syncErrorText = (code: SyncErrorCode): string => TEXTS[code]

/** meta 'sync' 행. 암호화하지 않는 표이므로 id·시각·기기 이름·해시만 담는다(행 내용 금지). */
export interface SyncState {
  enabled: boolean
  rootId?: string
  deviceId: string
  deviceName?: string
  lastUploadedMax?: string
  seen: Record<string, string>
  lastOk?: string
  lastError?: { code: SyncErrorCode; at: string } | null
  keyUpdatedAt?: string
  firstMergeDone: boolean
}

const ID = 'sync'

const KEYS = ['enabled', 'rootId', 'deviceName', 'lastUploadedMax', 'seen', 'lastOk', 'lastError', 'keyUpdatedAt', 'firstMergeDone'] as const

function validLastError(v: unknown): { code: SyncErrorCode; at: string } | null {
  if (v === null) return null
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const ks = Object.keys(o)
    if (ks.length === 2 && typeof o.at === 'string' && (SYNC_ERROR_CODES as readonly unknown[]).includes(o.code)) {
      return { code: o.code as SyncErrorCode, at: o.at }
    }
  }
  throw new TypeError('lastError는 { code, at } 이어야 합니다.')
}

export async function getSyncState(db: AppDB): Promise<SyncState> {
  const row = (await db.meta.get(ID)) as Record<string, unknown> | undefined
  const kept: Record<string, unknown> = {}
  for (const k of KEYS) if (row && k in row) kept[k] = row[k]
  return { enabled: false, seen: {}, firstMergeDone: false, ...kept, deviceId: await deviceId(db) } as SyncState
}

export async function setSyncState(db: AppDB, patch: Partial<SyncState>): Promise<SyncState> {
  const clean: Record<string, unknown> = {}
  for (const k of KEYS) {
    if (!(k in patch)) continue
    const v = (patch as Record<string, unknown>)[k]
    clean[k] = k === 'lastError' ? validLastError(v) : v
  }
  await db.transaction('rw', db.meta, async () => {
    const cur = (await db.meta.get(ID)) as Record<string, unknown> | undefined
    const base: Record<string, unknown> = {}
    for (const k of KEYS) if (cur && k in cur) base[k] = cur[k]
    await db.meta.put({ ...base, ...clean, id: ID })
  })
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
