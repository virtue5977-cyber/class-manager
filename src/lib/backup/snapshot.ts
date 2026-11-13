import { type AppDB, SCHEMA_VERSION, SYNCED_TABLES, type SyncedTable } from '../db/schema'
import { BackupFormatError, BackupVersionError } from './errors'
import { fromBase64, toBase64 } from './crypto'

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
  await db.transaction('r', SYNCED_TABLES.map((t) => db.syncedTable(t)), async () => {
    for (const t of SYNCED_TABLES) tables[t] = await db.syncedTable(t).toArray()
  })
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
  await db.transaction('rw', SYNCED_TABLES.map((t) => db.syncedTable(t)), async () => {
    for (const t of SYNCED_TABLES) {
      if (!Object.prototype.hasOwnProperty.call(s.tables, t)) continue
      const table = db.syncedTable(t)
      await table.clear()
      const rows = (s.tables[t] ?? []) as { id: string }[]
      if (rows.length) await table.bulkAdd(rows)
    }
  })
}

const BYTES_KEY = '__bytes'

export function serializeSnapshot(s: Snapshot): Uint8Array {
  const json = JSON.stringify(s, (_k, v) => (v instanceof Uint8Array ? { [BYTES_KEY]: toBase64(v) } : v))
  return new TextEncoder().encode(json)
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
