import { type AppDB, SCHEMA_VERSION, SYNCED_TABLES, type SyncedTable } from '../db/schema'
import { BackupFormatError, BackupVersionError } from './errors'
import { fromBase64, toBase64 } from './crypto'
import { b64ToBytesYielding, blobIds, bytesToB64Yielding, openBlobRows, sealBlobRows } from '../notes/blobs'
import { mergeWrite } from '../vault/middleware'
import type { NoteBlobRec, NoteFileRec } from '../db/types'
import { SYNC_TABLES, syncableRow } from '../sync/tables'

const SYNC_TABLE_SET = new Set<string>(SYNC_TABLES)

export interface Snapshot {
  app: 'class-manager'
  schemaVersion: number
  exportedAt: string
  tables: Record<SyncedTable, unknown[]>
}

/** 키 n: 버전 n의 스냅샷을 n+1로 바꾼다. */
export const MIGRATIONS: Record<number, (s: Snapshot) => Snapshot> = {
  // 1 → 2: 표 구성은 같다. 그때 없던 표는 백업에 없을 뿐이고, 복원은 있는 표만 바꾼다.
  1: (s) => ({ ...s, schemaVersion: 2 }),
}

export async function exportSnapshot(db: AppDB, now: Date = new Date()): Promise<Snapshot> {
  return (await exportSnapshotReport(db, now)).snapshot
}

/**
 * 스냅샷 + 손상되어 뺀 첨부 수(spec §5.4: 내보내기는 깨진 행을 건너뛴다). 풀 수 없는 첨부는 그 note_files 행째 뺀다
 * (백업 형식 2에 새 칸을 두지 않는다). 하나 때문에 자동 백업 전체가 멈추지 않게.
 */
export async function exportSnapshotReport(db: AppDB, now: Date = new Date()): Promise<{ snapshot: Snapshot; skipped: number }> {
  const tables = {} as Record<SyncedTable, unknown[]>
  // 암호화 DB: 묶음 안에서는 첨부의 암호문 행만 함께 읽고(같은 시점), 풀기·base64는 묶음 밖에서 조각마다 양보하며 한다.
  const sealed = new Map<string, (NoteBlobRec | undefined)[]>()
  let skipped = 0
  await db.transaction('r', [...SYNCED_TABLES.map((t) => db.syncedTable(t)), db.note_blobs], async () => {
    for (const t of SYNCED_TABLES) tables[t] = await db.syncedTable(t).toArray()
    if (db.isVault) {
      for (const f of tables.note_files as NoteFileRec[]) if (!f.deleted) sealed.set(f.id, await db.note_blobs.bulkGet(blobIds(f)))
    }
  })
  // 암호화 DB: 첨부 내용(note_blobs)을 풀어 백업 형식대로 note_files.data(base64)에 채운다
  if (db.isVault) {
    const files = tables.note_files as NoteFileRec[]
    const out: NoteFileRec[] = []
    for (const f of files) {
      if (f.deleted) { out.push({ ...f, data: '' }); continue }
      let bytes: Uint8Array
      try {
        bytes = await openBlobRows(db, f, sealed.get(f.id) ?? [], { yieldBetween: true })
      } catch {
        sealed.delete(f.id)
        skipped++
        continue
      }
      sealed.delete(f.id)
      out.push({ ...f, data: await bytesToB64Yielding(bytes) })
    }
    tables.note_files = out
  }
  return { snapshot: { app: 'class-manager', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), tables }, skipped }
}

/** 형식·버전·레코드를 검사하고 현재 버전으로 마이그레이션한다. DB는 건드리지 않는다. */
export function validateSnapshot(snap: Snapshot): Snapshot {
  if (!snap || snap.app !== 'class-manager' || typeof snap.tables !== 'object' || snap.tables === null) {
    throw new BackupFormatError()
  }
  if (typeof snap.schemaVersion !== 'number' || snap.schemaVersion < 1) throw new BackupFormatError()
  if (snap.schemaVersion > SCHEMA_VERSION) throw new BackupVersionError()
  let s = snap
  while (s.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[s.schemaVersion]
    if (!step) throw new BackupFormatError()
    s = step(s)
  }
  for (const t of SYNCED_TABLES) {
    const rows = s.tables[t] ?? []
    if (!Array.isArray(rows)) throw new BackupFormatError()
    for (const r of rows) {
      if (typeof r !== 'object' || r === null || typeof (r as { id?: unknown }).id !== 'string') {
        throw new BackupFormatError()
      }
    }
  }
  return s
}

/** 백업에 들어 있는 표를 하나의 트랜잭션에서 백업 내용으로 바꾼다. 백업에 없는 표(옛 백업)는 그대로 둔다. device_local은 건드리지 않는다. */
export async function importSnapshot(db: AppDB, snap: Snapshot): Promise<void> {
  const s = validateSnapshot(snap)
  // 암호화 DB: 백업의 base64 내용을 떼어 note_blobs로 나눈다(묶음 밖에서 암호화)
  let blobRows: NoteBlobRec[] | null = null
  let fileRows: NoteFileRec[] | null = null
  if (db.isVault && Object.prototype.hasOwnProperty.call(s.tables, 'note_files')) {
    blobRows = []
    fileRows = []
    for (const r of (s.tables.note_files ?? []) as NoteFileRec[]) {
      const { data, chunks: _c, ...meta } = r
      void _c
      const out: NoteFileRec = { ...meta }
      if (!r.deleted && typeof data === 'string') {
        const sealed = await sealBlobRows(db, r.id, await b64ToBytesYielding(data))
        blobRows.push(...sealed.rows)
        if (sealed.chunks) out.chunks = sealed.chunks
      }
      fileRows.push(out)
    }
  }
  if (db.isVault && (await db.meta.get(SYNC_META))?.enabled === true) {
    await importStamped(db, s, fileRows, blobRows)
    return
  }
  // 동기화 꺼짐: 병합 쓰기로 백업의 updated_at을 그대로 둔다
  await mergeWrite(db, [...SYNCED_TABLES.map((t) => db.syncedTable(t)), db.note_blobs], async () => {
    if (blobRows) {
      await db.note_blobs.clear()
      if (blobRows.length) await db.note_blobs.bulkAdd(blobRows)
    }
    for (const t of SYNCED_TABLES) {
      if (!Object.prototype.hasOwnProperty.call(s.tables, t)) continue
      const table = db.syncedTable(t)
      await table.clear()
      const rows = (t === 'note_files' && fileRows ? fileRows : s.tables[t] ?? []) as { id: string }[]
      if (rows.length) await table.bulkAdd(rows)
    }
  })
}

const SYNC_META = 'sync'
const attKey = (r: Record<string, unknown>) => JSON.stringify([r.student_id, r.date, r.kind])

/**
 * 동기화가 켜진 암호화 DB의 복원(spec §4.5, 검토 M1): 하드 삭제·병합 쓰기가 아니라 **도장 찍는 보통 쓰기**.
 *  - 백업의 행은 put(미들웨어가 max(지금, 이전+1)로 도장) → 다른 PC의 같은 행을 이긴다.
 *  - 백업에 없는 살아 있는 행은 지움 표시(도장) → 다른 PC에서도 지워진다(옛 자료가 되살아나지 않는다).
 *  - 출결: 백업의 행과 같은 칸(student_id+date+kind)인데 id가 다른 로컬 행은 고유 색인 때문에 하드 삭제한다
 *    (다른 PC는 겹침 정리에서 도장이 늦은 백업 행을 이기게 해 같은 결론에 닿는다).
 *  - 추정 시간표(동기화 안 함)·동기화하지 않는 표(나이스·학사일정)는 지금처럼 백업 내용으로 바꾼다.
 *  - 지움 표시한 첨부는 내용(note_blobs)을 지운다. 끝나면 meta 'sync'에 pendingUpload를 남겨 바로 올리게 한다.
 */
async function importStamped(db: AppDB, s: Snapshot, fileRows: NoteFileRec[] | null, blobRows: NoteBlobRec[] | null): Promise<void> {
  const has = (t: string) => Object.prototype.hasOwnProperty.call(s.tables, t)
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.syncedTable(t)), db.note_blobs, db.meta], async () => {
    for (const t of SYNCED_TABLES) {
      if (!has(t)) continue
      const table = db.syncedTable(t)
      const rows = (t === 'note_files' && fileRows ? fileRows : s.tables[t] ?? []) as Record<string, unknown>[]
      if (!SYNC_TABLE_SET.has(t)) {
        await table.clear()
        if (rows.length) await table.bulkAdd(rows as never[])
        continue
      }
      const keep = new Set(rows.map((r) => String(r.id)))
      const local = (await table.toArray()) as Record<string, unknown>[]
      const hard: string[] = []
      const tombs: Record<string, unknown>[] = []
      const dropBlobs: string[] = []
      const keys = t === 'attendance' ? new Map(rows.map((r) => [attKey(r), String(r.id)])) : null
      for (const r of local) {
        const id = String(r.id)
        if (keep.has(id)) {
          if (t === 'note_files') dropBlobs.push(...blobIds(r as unknown as NoteFileRec)) // 새 내용으로 바꾼다
          continue
        }
        if (!syncableRow(t, r)) { hard.push(id); continue } // 이 PC 전용 행(추정 시간표): 지금처럼 바꾼다
        if (keys) {
          const k = keys.get(attKey(r))
          if (k !== undefined && k !== id) { hard.push(id); continue }
        }
        if (t === 'note_files') dropBlobs.push(...blobIds(r as unknown as NoteFileRec))
        if (r.deleted === true) continue
        const { data: _d, chunks: _c, ...rest } = r
        void _d; void _c
        tombs.push(t === 'note_files' ? { ...rest, deleted: true } : { ...r, deleted: true })
      }
      if (dropBlobs.length) await db.note_blobs.bulkDelete(dropBlobs)
      if (hard.length) await table.bulkDelete(hard)
      if (tombs.length) await table.bulkPut(tombs as never[])
      if (rows.length) await table.bulkPut(rows as never[])
    }
    if (blobRows?.length) await db.note_blobs.bulkPut(blobRows)
    const cur = (await db.meta.get(SYNC_META)) ?? { id: SYNC_META }
    await db.meta.put({ ...cur, id: SYNC_META, pendingUpload: true })
  })
}

const BYTES_KEY = '__bytes'

export function serializeSnapshot(s: Snapshot): Uint8Array {
  const json = JSON.stringify(s, (_k, v) => (v instanceof Uint8Array ? { [BYTES_KEY]: toBase64(v) } : v))
  return new TextEncoder().encode(json)
}

const BIG_STRING = 64 * 1024
const B64_CHARS = /^[A-Za-z0-9+/=]*$/
const yieldTick = () => new Promise<void>((r) => setTimeout(r))

/**
 * serializeSnapshot과 같은 바이트를 만들되, 큰 첨부 글(note_files의 base64 data)은 JSON.stringify에서 빼 두었다가
 * 1MB씩 붙이며 사이에 양보한다(첨부 수십 MB에서 화면이 오래 멈추지 않게). 백업 파일 만들기가 쓴다.
 */
export async function serializeSnapshotYielding(s: Snapshot): Promise<Uint8Array> {
  const files = new Set<unknown>(Array.isArray(s.tables?.note_files) ? s.tables.note_files : [])
  const big: string[] = []
  const mark = `@@watson-b64-${crypto.randomUUID()}-`
  const json = JSON.stringify(s, function (this: unknown, k, v) {
    if (v instanceof Uint8Array) return { [BYTES_KEY]: toBase64(v) }
    // base64 글자만 든 글은 JSON에서 그대로 "…"이므로 자리표로 바꿔 두었다가 그대로 붙인다
    if (k === 'data' && typeof v === 'string' && v.length > BIG_STRING && files.has(this) && B64_CHARS.test(v)) {
      big.push(v)
      return `${mark}${big.length - 1}@@`
    }
    return v
  })
  const te = new TextEncoder()
  const parts: Uint8Array[] = []
  let at = 0
  for (let i = 0; i < big.length; i++) {
    const m = `${mark}${i}@@`
    const j = json.indexOf(m, at)
    if (j < 0) return serializeSnapshot(s) // 있을 수 없음: 안전하게 한 번에
    parts.push(te.encode(json.slice(at, j)))
    const v = big[i]
    for (let o = 0; o < v.length; o += 1024 * 1024) {
      await yieldTick()
      parts.push(te.encode(v.slice(o, o + 1024 * 1024)))
    }
    at = j + m.length
  }
  parts.push(te.encode(json.slice(at)))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export function parseSnapshot(bytes: Uint8Array): Snapshot {
  try {
    return JSON.parse(new TextDecoder().decode(bytes), (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v) && typeof v[BYTES_KEY] === 'string' && Object.keys(v).length === 1
        ? fromBase64(v[BYTES_KEY])
        : v,
    ) as Snapshot
  } catch {
    throw new BackupFormatError()
  }
}
