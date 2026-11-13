import Dexie, {
  type DBCore, type DBCoreCursor, type DBCoreMutateRequest, type DBCoreMutateResponse, type DBCoreQueryRequest,
  type DBCoreQueryResponse, type DBCoreTable, type DBCoreTransaction, type Middleware, type Table, type Transaction,
} from 'dexie'
import { UNENCRYPTED_TABLES, type AppDB } from '../db/schema'
import { openRow, sealRow } from './rowCrypto'

/**
 * 암호화 미들웨어(spec §5.4·§5.5).
 * - 쓰기: 복사본을 봉인(평문 칸 + `_enc`)하고 `updated_at` 도장을 찍는다(병합 묶음 제외).
 * - 읽기: 풀어서 돌려준다. 풀리지 않는 행은 빼고 `onBrokenRow`로 알린다.
 * - 암호화하지 않는 표(UNENCRYPTED_TABLES)는 손대지 않고 통과한다.
 */

const MERGE = '__watsonMerge'
const RAW = '__watsonRaw'
/** 도장을 찍지 않는 암호화 표: 기록형(BaseRecord)이 아니고 동기화하지 않는다(spec §7.1). */
const NO_STAMP = new Set(['device_local', 'google_events'])
const UNENCRYPTED = new Set<string>(UNENCRYPTED_TABLES)

type Row = Record<string, unknown>
type Flagged = Transaction & { parent?: Flagged | null; [MERGE]?: boolean; [RAW]?: boolean }

// ---- 손상 행 알림 ----
type BrokenListener = (e: { table: string; id: unknown }) => void
const brokenListeners = new Set<BrokenListener>()

export function onBrokenRow(cb: BrokenListener): () => void {
  brokenListeners.add(cb)
  return () => { brokenListeners.delete(cb) }
}
function notifyBroken(table: string, id: unknown): void {
  for (const cb of [...brokenListeners]) {
    try { cb({ table, id }) } catch { /* 알림 받는 쪽 오류는 읽기를 막지 않는다 */ }
  }
}

// ---- 실제 찍힌 도장 ----
const STAMP_CAP = 1000
const stamps = new Map<string, string>()
const stampKey = (dbName: string, table: string, id: unknown) => `${dbName}\u0001${table}\u0001${String(id)}`
function recordStamp(k: string, v: unknown): void {
  stamps.delete(k)
  if (typeof v !== 'string') return
  stamps.set(k, v)
  if (stamps.size > STAMP_CAP) stamps.delete(stamps.keys().next().value as string)
}
/** 이 행에 마지막으로 실제 저장된 updated_at(vault DB에서만 있다). save() 같은 도우미가 쓴다. */
export function lastStamp(table: Table, id: unknown): string | undefined {
  return stamps.get(stampKey(table.db.name, table.name, id))
}

// ---- 묶음 표 ----
/** 지금 Dexie 묶음(또는 그 부모)에 붙은 표. 자동 묶음에는 붙을 수 없다. */
function transFlags(idbtrans: DBCoreTransaction): { merge: boolean; raw: boolean } {
  let t = Dexie.currentTransaction as Flagged | null
  const out = { merge: false, raw: false }
  if (!t || t.idbtrans !== (idbtrans as unknown)) return out
  for (; t; t = t.parent ?? null) {
    if (t[MERGE]) out.merge = true
    if (t[RAW]) out.raw = true
  }
  return out
}

function tagged<T>(db: AppDB, tables: Table[], flags: (typeof MERGE | typeof RAW)[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables, () => {
    const t = Dexie.currentTransaction as Flagged
    for (const f of flags) t[f] = true
    return fn()
  }) as Promise<T>
}

/** 병합 쓰기: 이 명시적 묶음 안의 put/add는 updated_at을 받은 그대로 둔다(옮기기·동기화 합치기·복원). */
export function mergeWrite<T>(db: AppDB, tables: Table[], fn: () => Promise<T>): Promise<T> {
  return tagged(db, tables, [MERGE], fn)
}

/** 원시 쓰기: `_enc`가 이미 있는 값을 그대로 넣는다(동기화·repair). 병합 쓰기를 겸한다. */
export function rawWrite<T>(db: AppDB, tables: Table[], fn: () => Promise<T>): Promise<T> {
  return tagged(db, tables, [MERGE, RAW], fn)
}

/** 미들웨어를 거치지 않은 원시 행(시험·검증·repair). 묶음 밖에서 부른다. */
export async function readRaw(db: AppDB, table: string): Promise<Row[]> {
  if (!db.isOpen()) await db.open()
  const idb = db.backendDB()
  return new Promise((resolve, reject) => {
    const req = idb.transaction(table, 'readonly').objectStore(table).getAll()
    req.onsuccess = () => resolve(req.result as Row[])
    req.onerror = () => reject(req.error)
  })
}

// ---- 미들웨어 ----
function isBroken(o: Row): boolean {
  return o._broken === true
}
function isRw(trans: DBCoreTransaction): boolean {
  return (trans as unknown as IDBTransaction).mode === 'readwrite'
}
function keyId(k: unknown): string {
  return typeof k === 'string' ? 's' + k : JSON.stringify(k)
}

function plainFieldsOfCore(t: DBCoreTable): ReadonlySet<string> {
  const out = new Set<string>(['updated_at', 'deleted'])
  const add = (kp: string | string[] | null | undefined) => {
    if (kp == null) return
    for (const k of Array.isArray(kp) ? kp : [kp]) if (k) out.add(k)
  }
  add(t.schema.primaryKey.keyPath)
  for (const ix of t.schema.indexes) add(ix.keyPath)
  return out
}

function wrapTable(down: DBCoreTable, dbName: string, key: Uint8Array): DBCoreTable {
  const name = down.name
  const plain = plainFieldsOfCore(down)
  const stampable = !NO_STAMP.has(name)
  const extractKey = down.schema.primaryKey.extractKey!

  /** 풀어서 돌려준다. 손상이면 알리고 undefined. */
  const reveal = (stored: unknown, seen?: Set<string>): Row | undefined => {
    if (stored == null) return undefined
    const o = openRow(name, stored as Row, key, plain) as Row
    if (!isBroken(o)) return o
    if (!seen || !seen.has(keyId(o.id))) {
      seen?.add(keyId(o.id))
      notifyBroken(name, o.id)
    }
    return undefined
  }
  const good = (stored: Row): boolean => !isBroken(openRow(name, stored, key, plain) as Row)

  function mutate(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
    if (req.type !== 'add' && req.type !== 'put') return down.mutate(req)
    try {
      const { merge, raw } = transFlags(req.trans)
      const keys: unknown[] = req.keys ? [...req.keys] : req.values.map((v) => extractKey(v))
      const src = req.values.map((v, i) => {
        if (v === null || typeof v !== 'object') throw new TypeError('저장할 수 없는 값')
        const r = v as Row
        if ('_broken' in r) throw new Error('손상된 기록은 저장할 수 없습니다')
        if ('_enc' in r && !raw) throw new Error('암호문이 든 값은 원시 쓰기(rawWrite)에서만 넣을 수 있습니다')
        if (keys[i] == null) throw new TypeError('id 없는 행은 암호화할 수 없습니다')
        return { ...r }
      })
      const sealedAlready = src.map((r) => '_enc' in r)
      // 부속(changeSpec·updates·criteria)은 평문 칸 밖의 내용을 담을 수 있고 아래 층에 쓸모없으므로 뺀다.
      const { criteria: _c, changeSpec: _s, updates: _u, ...rest } = req as DBCoreMutateRequest & {
        criteria?: unknown; changeSpec?: unknown; updates?: unknown
      }
      void _c; void _s; void _u

      const finish = (rows: Row[]): Promise<DBCoreMutateResponse> => {
        const values = rows.map((r, i) => (sealedAlready[i] ? r : sealRow(name, r, key, plain)))
        const downReq = { ...rest, values } as DBCoreMutateRequest
        return down.mutate(downReq).then((res) => {
          for (let i = 0; i < rows.length; i++) {
            if (!res.failures[i]) recordStamp(stampKey(dbName, name, keys[i]), rows[i].updated_at)
          }
          return res
        })
      }

      const toStamp = src.map((_r, i) => i).filter((i) => !sealedAlready[i])
      if (merge || !stampable || toStamp.length === 0) return finish(src)

      const stampWith = (prevs: (unknown | undefined)[]) => {
        const now = Date.now()
        const lastInReq = new Map<string, number>()
        toStamp.forEach((i, j) => {
          const id = keyId(keys[i])
          let t = now
          const before = lastInReq.get(id)
          const prev = before !== undefined ? before : Date.parse(String((prevs[j] as Row | undefined)?.updated_at))
          if (Number.isFinite(prev) && prev + 1 > t) t = prev + 1
          lastInReq.set(id, t)
          src[i].updated_at = new Date(t).toISOString()
        })
        return finish(src)
      }
      if (req.type === 'add') return stampWith([])
      return down
        .getMany({ trans: req.trans, keys: toStamp.map((i) => keys[i]), cache: 'immutable' })
        .then(stampWith)
    } catch (e) {
      return Dexie.Promise.reject(e) as unknown as Promise<DBCoreMutateResponse>
    }
  }

  function query(req: DBCoreQueryRequest): Promise<DBCoreQueryResponse> {
    const keysOnly = !req.values
    // 읽기 묶음의 키만 읽기는 그대로. 쓰기 묶음(modify·update·delete가 키를 고르는 곳)은 손상 행을 뺀다.
    if (keysOnly && !isRw(req.trans)) return down.query(req)
    const want = req.limit ?? Infinity
    const seen = new Set<string>()
    const run = (limit: number): Promise<DBCoreQueryResponse> =>
      down.query({ ...req, values: true, limit }).then((res) => {
        const out: unknown[] = []
        let bad = 0
        for (const v of res.result) {
          if (keysOnly) {
            if (good(v as Row)) out.push(extractKey(v))
            else bad++
          } else {
            const o = reveal(v, seen)
            if (o) out.push(o)
            else bad++
          }
        }
        if (bad > 0 && Number.isFinite(limit) && res.result.length === limit && out.length < want) {
          return run(limit + bad)
        }
        return { result: out.length > want ? out.slice(0, want) : out }
      })
    return run(want)
  }

  function wrapCursor(cursor: DBCoreCursor): DBCoreCursor {
    let lastRaw: unknown = undefined
    let lastOpen: Row | undefined
    let has = false
    const current = (): Row => {
      const raw = cursor.value
      if (!has || raw !== lastRaw) {
        lastRaw = raw
        lastOpen = openRow(name, raw as Row, key, plain) as Row
        has = true
      }
      return lastOpen!
    }
    return Object.create(cursor, {
      value: {
        get() {
          const o = current()
          return isBroken(o) ? undefined : o
        },
      },
      start: {
        value(onNext: () => void) {
          return cursor.start(() => {
            const o = current()
            if (isBroken(o)) {
              notifyBroken(name, o.id)
              cursor.continue()
              return
            }
            onNext()
          })
        },
      },
    }) as DBCoreCursor
  }

  return {
    ...down,
    mutate,
    get(req) {
      return down.get(req).then((v) => reveal(v))
    },
    getMany(req) {
      // 'clone'은 필요 없다: 언제나 새 객체로 풀어 준다. 암호문 행을 깊은 복제하지 않게 'immutable'로 바꾼다.
      const r = req.cache === 'clone' ? { ...req, cache: 'immutable' as const } : req
      return down.getMany(r).then((arr) => arr.map((v) => reveal(v)))
    },
    query,
    openCursor(req) {
      if (!req.values && !isRw(req.trans)) return down.openCursor(req)
      return down.openCursor(req.values ? req : { ...req, values: true }).then((c) => c && wrapCursor(c))
    },
  }
}

export function encryptionMiddleware(dek: Uint8Array): Middleware<DBCore> & { stack: 'dbcore' } {
  if (!(dek instanceof Uint8Array) || dek.length !== 32) throw new TypeError('열쇠는 32바이트(AES-256)여야 합니다')
  const key = dek.slice()
  return {
    stack: 'dbcore',
    name: 'watson-vault',
    level: 3,
    create(down) {
      const dbName = down.schema.name
      const cache = new Map<string, DBCoreTable>()
      return {
        ...down,
        table(name) {
          const t = down.table(name)
          if (UNENCRYPTED.has(name)) return t
          let w = cache.get(name)
          if (!w) { w = wrapTable(t, dbName, key); cache.set(name, w) }
          return w
        },
      }
    },
  }
}
