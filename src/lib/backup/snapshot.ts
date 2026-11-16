import { type AppDB, SCHEMA_VERSION, SYNCED_TABLES, type SyncedTable } from '../db/schema'
import { BackupFormatError, BackupVersionError } from './errors'
import { fromBase64, toBase64 } from './crypto'
import { b64ToBytesYielding, blobIds, bytesToB64Yielding, openBlobRows, sealBlobRows } from '../notes/blobs'
import { mergeWrite } from '../vault/middleware'
import type { NoteBlobRec, NoteFileRec } from '../db/types'

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
  const tables = {} as Record<SyncedTable, unknown[]>
  // 암호화 DB: 묶음 안에서는 첨부의 암호문 행만 함께 읽고(같은 시점), 풀기·base64는 묶음 밖에서 조각마다 양보하며 한다.
  const sealed = new Map<string, (NoteBlobRec | undefined)[]>()
  await db.transaction('r', [...SYNCED_TABLES.map((t) => db.syncedTable(t)), db.note_blobs], async () => {
    for (const t of SYNCED_TABLES) tables[t] = await db.syncedTable(t).toArray()
    if (db.isVault) {
      for (const f of tables.note_files as NoteFileRec[]) if (!f.deleted) sealed.set(f.id, await db.note_blobs.bulkGet(blobIds(f)))
    }
  })
  // 암호화 DB: 첨부 내용(note_blobs)을 풀어 백업 형식대로 note_files.data(base64)에 채운다
  if (db.isVault) {
    const files = tables.note_files as NoteFileRec[]
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f.deleted) { files[i] = { ...f, data: '' }; continue }
      let bytes: Uint8Array
      try {
        bytes = await openBlobRows(db, f, sealed.get(f.id) ?? [], { yieldBetween: true })
      } catch {
        throw new Error(`첨부 '${f.name}'이(가) 손상되어 백업할 수 없습니다. 노트에서 이 첨부를 지우고 다시 시도하세요.`)
      }
      sealed.delete(f.id)
      files[i] = { ...f, data: await bytesToB64Yielding(bytes) }
    }
  }
  return { app: 'class-manager', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), tables }
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
  // 병합 쓰기: 백업의 updated_at을 그대로 둔다(동기화 켠 뒤의 '도장 + 지움 표시' 복원은 1.0.x)
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
