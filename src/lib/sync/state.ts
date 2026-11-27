import type { AppDB } from '../db/schema'
import { deviceId } from '../backup/service'
import { readRaw } from '../vault/middleware'
import { SYNC_TABLES } from './tables'
import { GoogleApiError, googleErrorText } from '../google/google'

export const SYNC_ERROR_CODES = ['auth', 'quota', 'storage', 'rate', 'offline', 'newer-format', 'key-mismatch', 'bad-snapshot', 'stale-self', 'unknown'] as const
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
  if (m === 'STALE_SELF') return 'stale-self'
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
  'stale-self': '이 PC는 90일 넘게 동기화하지 않아 드라이브 자료로 바꿔야 합니다. 설정 > 구글 계정에서 “드라이브 자료로 바꾸기”를 누르세요.',
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
  /** 합친 뒤 올려야 하는데 아직 못 올렸다(충돌·겹침 정리·신고서 맞춤 결과 등, dirty만으로는 안 보이는 것). */
  pendingUpload?: boolean
  /** 마지막 지움 표시 정리 시각(ISO) */
  lastGc?: string
  /** 마지막 합치기 전 안전 백업 날짜(YYYY-MM-DD, 이 PC 시간) */
  lastSafetyBackup?: string
  /** 드라이브에 보이는 기기(이름은 컴퓨터 이름) */
  devices?: SyncDevice[]
  /** 마지막 업로드의 드라이브 시각을 못 읽어 'up' base의 upAt이 'pending'이다(다음 번 목록에서 채운다). */
  upAtPending?: boolean
}

export interface SyncDevice { deviceId: string; deviceName: string; modifiedTime: string; stale: boolean; mine: boolean }

const ID = 'sync'

const KEYS = ['enabled', 'rootId', 'deviceName', 'lastUploadedMax', 'seen', 'lastOk', 'lastError', 'keyUpdatedAt', 'firstMergeDone', 'pendingUpload', 'lastGc', 'lastSafetyBackup', 'devices', 'upAtPending'] as const

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
 * SYNC_TABLES 어디든 max(updated_at) > lastUploadedMax 인 행이 있고, 그 행이 드라이브와 맞춘 그대로(base의 at === updated_at)가
 * 아니면 true. base 예외가 있어 다른 PC의 앞선 시계 도장으로 받은 행 때문에 늘 dirty가 되지 않고, 워터마크를 남의 도장까지
 * 올리지 않아도 된다(그 아래로 찍힌 내 고침을 놓치지 않게).
 * updated_at은 암호화 DB에서도 평문 칸이라 readRaw(복호화 없이 원시 행)에서 그대로 읽는다. 복호화 없음.
 * note_files는 created_at도 보지만 암호화 DB에서는 봉인되므로 생성 시 updated_at이 함께 찍히는 점에 기댄다.
 */
export async function isDirty(db: AppDB): Promise<boolean> {
  const last = (await getSyncState(db)).lastUploadedMax ?? ''
  for (const t of SYNC_TABLES) {
    const cands: Record<string, unknown>[] = []
    for (const r of await readRaw(db, t)) {
      if ((typeof r.updated_at === 'string' && r.updated_at > last) || (t === 'note_files' && typeof r.created_at === 'string' && r.created_at > last)) cands.push(r)
    }
    if (!cands.length) continue
    const bases = await db.sync_rows.bulkGet(cands.map((r) => baseId(t, String(r.id))))
    for (let i = 0; i < cands.length; i++) {
      const b = bases[i]
      if (!b || typeof b.at !== 'string' || b.at !== cands[i].updated_at) return true
    }
  }
  return false
}

const baseId = (table: string, id: string) => table + '\u0000' + id

/** src 'up': 내가 올린 값이라 base가 된 것(upAt = 그 업로드 뒤 내 파일의 드라이브 modifiedTime, 모르면 'pending'). 'merge': 받기·합치기로 맞춘 것. */
export interface BaseEntry { hash: string; at?: string; src?: 'up' | 'merge'; upAt?: string }
type BaseInput = { table: string; id: string; hash: string; at?: string; src?: 'up' | 'merge'; upAt?: string }

/**
 * 마지막으로 합친 행의 해시를 적는다. at은 그 값의 updated_at(평문 칸이라 새로 드러나는 것 없음): isDirty가 받은 행을
 * 내 고침으로 보지 않게 한다. 호출자의 트랜잭션(sync_rows 포함) 안에서도 쓸 수 있다.
 */
export async function markBase(db: AppDB, entries: BaseInput[]): Promise<void> {
  if (entries.length === 0) return
  await db.sync_rows.bulkPut(entries.map((e) => {
    const r: Record<string, string> = { id: baseId(e.table, e.id), hash: e.hash }
    if (e.at !== undefined) r.at = e.at
    if (e.src !== undefined) r.src = e.src
    if (e.upAt !== undefined) r.upAt = e.upAt
    return r as { id: string; hash: string }
  }))
}

export async function getBaseEntries(db: AppDB, table: string, ids: string[]): Promise<Map<string, BaseEntry>> {
  const rows = await db.sync_rows.bulkGet(ids.map((i) => baseId(table, i)))
  const out = new Map<string, BaseEntry>()
  rows.forEach((r, i) => {
    if (!r || typeof r.hash !== 'string') return
    const e: BaseEntry = { hash: r.hash }
    if (typeof r.at === 'string') e.at = r.at
    if (r.src === 'up' || r.src === 'merge') e.src = r.src
    if (typeof r.upAt === 'string') e.upAt = r.upAt
    out.set(ids[i], e)
  })
  return out
}

export async function getBase(db: AppDB, table: string, ids: string[]): Promise<Map<string, string>> {
  const rows = await db.sync_rows.bulkGet(ids.map((i) => baseId(table, i)))
  const out = new Map<string, string>()
  rows.forEach((r, i) => { if (r && typeof r.hash === 'string') out.set(ids[i], r.hash) })
  return out
}
