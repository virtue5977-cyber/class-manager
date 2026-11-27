// 동기화 한 번(spec §7.6). 드라이브의 다른 기기 스냅숏을 받아 하나의 병합 쓰기 묶음으로 합치고, 바뀐 게 있으면 내 것을 올린다.
import type { Table } from 'dexie'
import type { AppDB } from '../db/schema'
import type { NoteFileRec } from '../db/types'
import { SYNC_TABLES, syncableRow } from './tables'
import { rowHash, syncKeyFrom } from './hash'
import { bump, decide, dedupe, type SyncRow } from './merge'
import { buildWsync, openFile, openWsync, sealFile, type Snapshot } from './wsync'
import type { DeviceEntry, DriveStore } from './driveStore'
import {
  getBaseEntries, getSyncState, isDirty, markBase, setSyncState, syncErrorCode,
  type BaseEntry, type SyncDevice, type SyncErrorCode, type SyncState,
} from './state'
import { mergeWrite } from '../vault/middleware'
import { canonicalJson } from '../vault/canon'
import { GoogleApiError } from '../google/google'
import { reconcileStudent } from '../absenceReports/reconcile'
import { linkId } from '../absenceReports/ids'
import { MAX_FILE, readFile } from '../notes/notes'
import { blobIds, sealBlobRows } from '../notes/blobs'

const DAY = 86_400_000
/** 90일 동안 올리지 않은 기기는 '오래된 기기': 합치지 않는다. */
export const STALE_MS = 90 * DAY
/** 지움 표시는 180일 지나고 활성 기기 모두에서 지워진 게 보이면 하드 삭제한다. */
export const TOMBSTONE_GC_MS = 180 * DAY
const CLOCK_AHEAD_MS = DAY
const GC_EVERY_MS = DAY
const EXTRA_ID = 'syncExtra'

/** 경고 코드. ':' 뒤는 기기 이름(또는 기기 id). 행 내용은 담지 않는다. */
export type SyncWarning = string

export interface SyncResult {
  ok: boolean
  error?: SyncErrorCode
  /** 합친 다른 기기 스냅숏 수 */
  pulled: number
  /** 이 PC에 쓴 행 수(넣기·고치기·하드 삭제) */
  merged: number
  /** 양쪽이 다 바뀐 행 수 */
  conflicts: number
  /** 올린 내 스냅숏 수(0 또는 1) */
  uploaded: number
  files: { up: number; down: number }
  warnings: SyncWarning[]
  rootSwitched: boolean
}

export interface SyncOnceParams {
  db: AppDB
  dek: Uint8Array
  keyId: string
  store: Pick<DriveStore, 'resolveRoot' | 'deleteRoot' | 'listDevices' | 'downloadDevice' | 'uploadDevice' | 'fileModifiedTime' | 'listFileIds' | 'uploadFile' | 'downloadFile'>
  now: () => Date
  deviceName: string
  appVersion: string
  /** 합치기 전 안전 백업(백업 폴더가 있을 때만 넘긴다). 하루 한 번만 부른다. */
  safetyBackup?: () => Promise<void>
}

const WARNING_TEXT: Record<string, string> = {
  'stale-device': '90일 넘게 동기화하지 않은 기기가 있어 그 자료는 합치지 않았습니다',
  'key-mismatch': '다른 열쇠로 만든 기기 자료가 있어 건너뛰었습니다',
  'newer-format': '다른 기기가 더 새 버전으로 올린 자료입니다. Watson을 업데이트하세요',
  'bad-snapshot': '드라이브의 기기 자료 하나가 손상되어 건너뛰었습니다',
  'bad-rows': '드라이브 자료 중 형식이 맞지 않는 행을 건너뛰었습니다',
  'clock-ahead': '다른 기기의 시계가 하루 넘게 앞서 있습니다. 그 PC의 날짜·시간을 확인하세요',
  'class-duplicate': '학급이 둘 생겼습니다: 하나를 지우세요',
  'attachment-missing': '드라이브에 아직 없는 첨부가 있습니다. 다음 동기화 때 다시 받습니다',
  'attachment-bad': '드라이브의 첨부 하나가 손상되어 받지 못했습니다',
  'attachment-local-bad': '이 PC의 첨부 하나가 손상되어 올리지 못했습니다',
  'safety-backup-failed': '합치기 전 안전 백업을 만들지 못했습니다',
}
/** 경고 코드 → 화면 문구 */
export function syncWarningText(w: SyncWarning): string {
  const i = w.indexOf(':')
  const code = i < 0 ? w : w.slice(0, i)
  const who = i < 0 ? '' : w.slice(i + 1)
  const t = WARNING_TEXT[code] ?? '동기화 중 확인할 것이 있습니다'
  return who ? `${t} (${who})` : t
}

// ---------- 행 모양 ----------

type Row = Record<string, unknown>
/** 동기화로 오가는 모양: 미들웨어 내부 칸과 이 PC 전용 칸(note_files의 내용·조각 수)을 뺀다. */
function view(table: string, r: Row): SyncRow {
  const { _enc: _e, _broken: _b, ...rest } = r
  if (table === 'note_files') {
    const { data: _d, chunks: _c, ...meta } = rest
    return meta as SyncRow
  }
  return rest as SyncRow
}
const validRemote = (r: SyncRow) => typeof r.id === 'string' && r.id !== '' && typeof r.updated_at === 'string' && !Number.isNaN(Date.parse(r.updated_at))
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// ---------- 행 하나 판정 ----------

const COPY_TABLES = new Set(['notes', 'counseling_logs'])

type RowDecision =
  | { kind: 'absent' | 'keep' | 'stale' }
  | { kind: 'equal' | 'take'; value: SyncRow }
  | { kind: 'conflict'; value: SyncRow; copy?: SyncRow }

/**
 * decide(§7.2) 위에 세 가지를 더한다.
 *  - 로컬에 없는데 base가 받은 값과 같다: 이 PC가 일부러 하드 삭제한 행(겹침 정리의 진 쪽·지움 표시 정리) → 되살리지 않는다.
 *  - 한쪽만 바뀐 것처럼 보여도 받은 값이 로컬보다 오래됐으면(updated_at) 받지 않는다: 늦게 올라온 옛 스냅숏이 고침·지움을
 *    되돌리지 않게. 미들웨어는 고칠 때마다 max(지금, 이전+1)로 찍으므로, 내 값을 보고 고친 값은 언제나 더 늦다.
 *  - 충돌에서 '살아 있음'이 더 늦은 지움 표시를 이기면 이긴 값의 도장을 둘 중 늦은 것+1ms로 올린다(자료만으로 정해짐).
 *    그래야 지움을 먼저 받은 PC도 그 값을 '더 새것'으로 받아 같은 값으로 모인다.
 */
/**
 * peerSeenMe: 받은 스냅숏의 seen[내 기기 id]. undefined = 옛 스냅숏이라 모름, null = seen은 있는데 나를 합친 적 없음.
 */
export function decideRow(
  L: SyncRow | undefined, R: SyncRow, base: BaseEntry | undefined, key: Uint8Array, table: string, peerSeenMe?: string | null,
): RowDecision {
  if (!L) {
    // 로컬에 없는데 base가 있다 = 이 PC가 하드 삭제했다. 그때(base.at)보다 늦게 고친 값만 받는다.
    if (base && (base.hash === rowHash(key, R) || (base.at !== undefined && R.updated_at <= base.at))) return { kind: 'absent' }
    return { kind: 'take', value: R }
  }
  let d = decide({ local: L, remote: R, base: base?.hash, key, table })
  if (d.action === 'keep') return rowHash(key, L) === rowHash(key, R) ? { kind: 'equal', value: L } : { kind: 'keep' }
  if (d.action === 'take') {
    if (R.updated_at <= L.updated_at) return { kind: 'stale' }
    // 겹친 실행: base가 내가 올린 값인데 상대 스냅숏이 그 업로드를 합치지 않은 채 만들어졌다(seen[나] < 내 업로드의 드라이브 시각,
    // 둘 다 드라이브 서버 시각이라 PC 시계가 틀려도 된다) → 상대는 내 값을 못 보고 고쳤다. 노트·누가기록은 조용히 받지 않고
    // 충돌로 본다(진 쪽 사본, 결정적 id). seen이 없는 옛 스냅숏·upAt을 모르는 base는 보통 받기.
    const unseen = peerSeenMe === null || (typeof peerSeenMe === 'string' && base?.upAt !== undefined && peerSeenMe < base.upAt)
    if (!COPY_TABLES.has(table) || base?.src !== 'up' || base.upAt === undefined || base.upAt === 'pending' || !unseen) return { kind: 'take', value: R }
    d = decide({ local: L, remote: R, base: undefined, key, table })
  }
  let v = d.value!
  const loser = v === L ? R : L
  if (v.updated_at < loser.updated_at) v = { ...v, updated_at: bump(v.updated_at, loser.updated_at) }
  return { kind: 'conflict', value: v, ...(d.conflictCopy ? { copy: d.conflictCopy } : {}) }
}

// ---------- 지움 표시 정리(순수) ----------

/** 결정적 id로 심는 기본값 행(reflection/store.ts). 지움 표시가 '심지 마라'는 뜻이라 정리하지 않는다. */
const SEEDED = ['phrase-default-', 'goodtext-default-']

/** 하드 삭제해도 되는 지움 표시인가: 180일 지났고, 활성 기기 스냅숏 모두에서 지워졌거나 아예 없다. */
export function isCollectable(row: SyncRow, now: Date, peerRows: (SyncRow | undefined)[]): boolean {
  if (!row.deleted) return false
  if (SEEDED.some((p) => row.id.startsWith(p))) return false // 기본값 행: 지우면 다시 심어져 지운 기본값이 살아난다
  const t = Date.parse(row.updated_at)
  if (Number.isNaN(t) || now.getTime() - t <= TOMBSTONE_GC_MS) return false
  return peerRows.every((p) => !p || !!p.deleted)
}

/** 표마다 하드 삭제할 지움 표시 id(정렬). peers는 활성 기기(나 빼고) 스냅숏의 표들. */
export function tombstoneGc(local: Record<string, SyncRow[]>, peers: Record<string, SyncRow[] | undefined>[], now: Date): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const t of Object.keys(local)) {
    const idx = peers.map((p) => new Map((p[t] ?? []).map((r) => [r.id, r])))
    const ids = local[t].filter((r) => isCollectable(r, now, idx.map((m) => m.get(r.id)))).map((r) => r.id).sort()
    if (ids.length) out[t] = ids
  }
  return out
}

// ---------- 모르는 표 보관 ----------

interface ExtraStore { [table: string]: { at: string; dev: string; value: unknown } }
const KNOWN = new Set<string>(SYNC_TABLES)
async function loadExtraStore(db: AppDB): Promise<ExtraStore> {
  const v = (await db.device_local.get(EXTRA_ID))?.value
  return v && typeof v === 'object' ? (v as ExtraStore) : {}
}
/** 모르는 표는 표마다 가장 늦게(at) 낸 기기의 것을 그대로 보관했다가 다시 낸다. */
function foldExtra(cur: ExtraStore, remotes: Remote[]): { next: ExtraStore; changed: boolean } {
  const next: ExtraStore = { ...cur }
  let changed = false
  for (const p of remotes) {
    for (const [k, value] of Object.entries(p.snap.extra)) {
      if (KNOWN.has(k)) continue
      const c = next[k]
      if (!c || p.snap.at > c.at || (p.snap.at === c.at && p.deviceId > c.dev)) {
        if (!c || canonicalJson(c.value) !== canonicalJson(value)) changed = true
        next[k] = { at: p.snap.at, dev: p.deviceId, value }
      }
    }
  }
  return { next, changed }
}

// ---------- 합치기 ----------

interface Remote { deviceId: string; deviceName: string; entry: DeviceEntry; snap: Snapshot }
interface MergeOut { merged: number; conflicts: number; nonTake: boolean; students: Set<string>; badRows: boolean }

const attKey = (r: SyncRow) => canonicalJson([r.student_id, r.date, r.kind])

/**
 * 하나의 mergeWrite 묶음(SYNC_TABLES + sync_rows + note_blobs) 안에서 표마다:
 * 로컬 읽기 → 기기 id 순으로 받은 행을 차례로 판정 → dedupe → 진 행 하드 삭제 → 바뀐 행만 bulkPut → base 갱신.
 * 묶음 안에서는 IndexedDB 밖의 비동기(복호화 제외 해시는 동기)를 하지 않는다.
 */
async function mergeRemotes(db: AppDB, key: Uint8Array, remotes: Remote[], wasDirty: boolean, me: string): Promise<MergeOut> {
  const out: MergeOut = { merged: 0, conflicts: 0, nonTake: false, students: new Set(), badRows: false }
  const tables: Table[] = [...SYNC_TABLES.map((t) => db.table(t)), db.sync_rows, db.note_blobs, db.meta]
  const H = (r: SyncRow) => rowHash(key, r)
  await mergeWrite(db, tables, async () => {
    /** 하드 삭제된(또는 받지 않은) 출결 id → 같은 칸의 이긴 출결 */
    const attWinner = new Map<string, SyncRow>()
    for (const t of SYNC_TABLES) {
      const seenMe = remotes.map((p) => (p.snap.seen === undefined ? undefined : (p.snap.seen[me] ?? null)))
      const remoteLists = remotes.map((p) => {
        const rows = (p.snap.tables[t] ?? []) as SyncRow[]
        const ok = rows.filter(validRemote)
        if (ok.length !== rows.length) out.badRows = true
        return ok.filter((r) => syncableRow(t, r as { source?: unknown })).map((r) => view(t, r))
      })
      const remoteIds = [...new Set(remoteLists.flatMap((l) => l.map((r) => r.id)))]
      if (remoteIds.length === 0 && !(t === 'report_attendance' && attWinner.size > 0)) continue

      const tbl = db.table(t)
      const localRows = (await tbl.toArray()) as Row[]
      const local = new Map(localRows.map((r) => [r.id as string, r]))
      const cur = new Map<string, SyncRow>()
      for (const r of localRows) if (syncableRow(t, r)) cur.set(r.id as string, view(t, r))
      const bases = remoteIds.length ? await getBaseEntries(db, t, remoteIds) : new Map<string, BaseEntry>()
      const newBase = new Map<string, BaseEntry>()
      const baseOf = (id: string) => newBase.get(id) ?? bases.get(id)
      const agreed = new Set<string>()

      const apply = (R: SyncRow, peerSeenMe?: string | null) => {
        const lr = local.get(R.id)
        if (lr && !syncableRow(t, lr)) return // 이 PC의 추정 시간표 행은 건드리지 않는다
        const res = decideRow(cur.get(R.id), R, baseOf(R.id), key, t, peerSeenMe)
        if (res.kind === 'equal' || res.kind === 'take') {
          cur.set(R.id, res.value)
          newBase.set(R.id, { hash: H(res.value), at: res.value.updated_at })
          agreed.add(R.id)
        } else if (res.kind === 'conflict') {
          out.conflicts++
          out.nonTake = true
          cur.set(R.id, res.value)
          newBase.set(R.id, { hash: H(res.value), at: res.value.updated_at })
          agreed.add(R.id)
          if (res.copy) apply(res.copy) // 사본도 받은 행처럼 판정(이미 있거나 정리된 사본을 다시 만들지 않게)
        }
      }
      remoteLists.forEach((rows, i) => { for (const R of rows) apply(R, seenMe[i]) })

      if (t === 'report_attendance' && attWinner.size > 0) {
        // 하드 삭제된 출결을 가리키는 연결: 지움 표시하고 이긴 출결로 다시 잇는다(도장은 자료만으로: 둘 중 늦은 것+1ms).
        for (const l of [...cur.values()].sort(byId)) {
          const w = attWinner.get(String(l.attendance_id))
          if (!w || l.deleted) continue
          const s = bump(l.updated_at, w.updated_at)
          cur.set(l.id, { ...l, deleted: true, updated_at: s })
          agreed.add(l.id)
          if (w.deleted) continue
          const tid = linkId(String(l.report_id), w.id)
          const ex = cur.get(tid)
          if (ex && !ex.deleted) continue
          const next: SyncRow = ex
            ? { ...ex, deleted: false, updated_at: bump(s, ex.updated_at) }
            : { id: tid, report_id: l.report_id, attendance_id: w.id, created_at: l.created_at, updated_at: s, deleted: false }
          cur.set(tid, next)
          agreed.add(tid)
        }
      }

      const pre = new Map(cur)
      const { keep, hardDelete } = dedupe(t, [...cur.values()])
      const final = new Map(keep.map((r) => [r.id, r]))
      if (t === 'attendance') {
        const winnerOf = new Map(keep.map((r) => [attKey(r), r]))
        const seen = [...pre.values(), ...remoteLists.flat()]
        for (const r of seen) {
          if (final.has(r.id)) continue
          const w = winnerOf.get(attKey(r))
          if (w && w.id !== r.id) attWinner.set(r.id, w)
        }
      }

      const deletes = hardDelete.filter((id) => local.has(id))
      const puts: Row[] = []
      const blobDrops: string[] = []
      const marks: { table: string; id: string; hash: string; at: string; src: 'merge' }[] = []
      for (const id of hardDelete) {
        const r = pre.get(id)!
        marks.push({ table: t, id, hash: H(r), at: r.updated_at, src: 'merge' }) // 다른 PC의 같은 진 행을 다시 받지 않게
        if (local.has(id)) out.nonTake = true
      }
      for (const v of keep) {
        const p = pre.get(v.id)!
        if (p !== v) { out.nonTake = true; agreed.add(v.id) } // dedupe가 바꾼 행
        if (agreed.has(v.id)) {
          const h = H(v)
          const old = bases.get(v.id) // 저장된 base와 비교(newBase는 아직 메모리에만 있다)
          if (!old || old.hash !== h || old.at !== v.updated_at || old.src !== 'merge') marks.push({ table: t, id: v.id, hash: h, at: v.updated_at, src: 'merge' })
        }
        const lr = local.get(v.id)
        if (lr && canonicalJson(view(t, lr)) === canonicalJson(v)) continue
        const row: Row = { ...v }
        if (t === 'note_files') {
          if (!v.deleted && lr && !lr.deleted) {
            if (lr.data !== undefined) row.data = lr.data
            if (lr.chunks !== undefined) row.chunks = lr.chunks
          } else if (v.deleted && lr) {
            blobDrops.push(...blobIds(lr as unknown as NoteFileRec))
          }
        }
        puts.push(row)
      }
      if (t === 'attendance') {
        for (const r of puts) out.students.add(String(r.student_id))
        for (const id of deletes) out.students.add(String(local.get(id)!.student_id))
      }
      // (a) 진 행을 먼저 지운 뒤 넣는다(고유 색인 충돌 방지)
      if (deletes.length) await tbl.bulkDelete(deletes)
      if (puts.length) await tbl.bulkPut(puts)
      if (blobDrops.length) await db.note_blobs.bulkDelete(blobDrops)
      // (c) 받기·합치기 결과의 base는 그 자리에서 갱신한다. 묶음 안에서는 IndexedDB 일을 하지 않는 async 함수를 await하지 않는다
      // (Dexie 4 + 원생 async에서 묶음이 먼저 끝나 PrematureCommitError가 난다: 빈 markBase가 그랬다).
      if (marks.length) await markBase(db, marks)
      out.merged += deletes.length + puts.length
    }
    // 올려야 할 합친 결과는 같은 묶음에서 pendingUpload로 남긴다: 업로드 전에 무엇이 실패해도(첨부 받기 등) 다음 번에 올린다.
    // 합친 행은 base(at)로 dirty에서 빠지므로 이것이 없으면 그 결과가 이 PC에만 남는다.
    if (wasDirty || out.nonTake) {
      const cur = (await db.meta.get('sync')) ?? { id: 'sync' }
      await db.meta.put({ ...cur, id: 'sync', pendingUpload: true })
    }
  })
  return out
}

// ---------- 첨부 ----------

async function hasLocalContent(db: AppDB, f: NoteFileRec): Promise<boolean> {
  return (await db.note_blobs.bulkGet(blobIds(f))).every(Boolean)
}

async function downloadAttachments(db: AppDB, dek: Uint8Array, store: SyncOnceParams['store'], root: string, warn: (w: string) => void): Promise<number> {
  let down = 0
  const files = ((await db.note_files.toArray()) as NoteFileRec[]).filter((f) => !f.deleted).sort(byId)
  for (const f of files) {
    if (await hasLocalContent(db, f)) continue
    let sealed: Uint8Array
    try {
      sealed = await store.downloadFile(root, f.id)
    } catch (e) {
      if (e instanceof GoogleApiError && e.status !== 404) throw e
      warn('attachment-missing')
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = openFile(dek, f.id, sealed)
      if (bytes.length !== f.size || bytes.length > MAX_FILE) throw new Error('size')
    } catch {
      warn('attachment-bad')
      continue
    }
    const { rows, chunks } = await sealBlobRows(db, f.id, bytes) // 묶음 밖에서 암호화
    await mergeWrite(db, [db.note_files, db.note_blobs], async () => {
      const cur = await db.note_files.get(f.id)
      if (!cur || cur.deleted || cur.size !== f.size) return
      const { chunks: _c, ...rest } = cur
      await db.note_blobs.bulkPut(rows)
      await db.note_files.put(chunks ? { ...rest, chunks } : rest) // 병합 쓰기: updated_at 그대로
      down++
    })
  }
  return down
}

async function uploadAttachments(db: AppDB, dek: Uint8Array, store: SyncOnceParams['store'], root: string, warn: (w: string) => void): Promise<number> {
  let up = 0
  const have = await store.listFileIds(root)
  const files = ((await db.note_files.toArray()) as NoteFileRec[]).filter((f) => !f.deleted && !have.has(f.id)).sort(byId)
  for (const f of files) {
    if (!(await hasLocalContent(db, f))) continue // 아직 받지 못한 첨부는 올리지 않는다
    let bytes: Uint8Array
    try {
      bytes = (await readFile(db, f.id)).bytes
    } catch {
      warn('attachment-local-bad')
      continue
    }
    await store.uploadFile(root, f.id, sealFile(dek, f.id, bytes))
    up++
  }
  return up
}

// ---------- 내 스냅숏 ----------

async function readOwnTables(db: AppDB): Promise<Record<string, SyncRow[]>> {
  const tables: Record<string, SyncRow[]> = {}
  await db.transaction('r', SYNC_TABLES.map((t) => db.table(t)), async () => {
    for (const t of SYNC_TABLES) tables[t] = ((await db.table(t).toArray()) as Row[]).filter((r) => syncableRow(t, r)).map((r) => view(t, r)).sort(byId)
  })
  return tables
}

/** 올린 값을 base로 적는다(바뀐 것만). 다른 PC가 이 값에서 고친 것을 충돌이 아닌 '받기'로 보게 한다. */
async function markUploaded(db: AppDB, key: Uint8Array, tables: Record<string, SyncRow[]>, upAt: string): Promise<void> {
  for (const [t, rows] of Object.entries(tables)) {
    if (!rows.length) continue
    const cur = await getBaseEntries(db, t, rows.map((r) => r.id))
    const marks: { table: string; id: string; hash: string; at: string; src: 'up'; upAt: string }[] = []
    for (const r of rows) {
      const h = rowHash(key, r)
      const b = cur.get(r.id)
      // 바뀐 값만 'up'으로 적는다(이미 맞춘 그대로 다시 올린 행은 그 출처를 둔다).
      if (!b || b.hash !== h || b.at !== r.updated_at) marks.push({ table: t, id: r.id, hash: h, at: r.updated_at, src: 'up', upAt })
    }
    if (marks.length) await db.transaction('rw', db.sync_rows, () => markBase(db, marks))
  }
}

// ---------- 한 번 ----------

const iso = (ms: number) => new Date(ms).toISOString()
const maxIso = (a: string | undefined, b: string) => (a && a > b ? a : b)
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function syncOnce(p: SyncOnceParams): Promise<SyncResult> {
  const { db, dek, keyId, store, now, deviceName, appVersion } = p
  if (!db.isVault) throw new Error('SYNC_NEEDS_VAULT') // 첨부·도장 규칙이 암호화 DB를 전제로 한다(§7.5: 1.0 암호화 완료)
  let state: SyncState = await getSyncState(db)
  if (!state.enabled || !state.rootId) throw new Error('SYNC_NOT_ENABLED')
  const key = syncKeyFrom(dek)
  const result: SyncResult = { ok: true, pulled: 0, merged: 0, conflicts: 0, uploaded: 0, files: { up: 0, down: 0 }, warnings: [], rootSwitched: false }
  const warn = (w: string) => { if (!result.warnings.includes(w)) result.warnings.push(w) }
  const me = state.deviceId

  try {
    // 합치기 전에 dirty를 적어 둔다(묶음 밖). tw 뒤에 찍힌 고침은 모두 tw보다 늦다.
    const tw = Date.now()
    const wasDirty = await isDirty(db)

    // 1. 루트: 가장 오래된 것으로 모인다. 목록에 실제로 보인 다른 루트만 지운다(옮겨 간 루트는 절대 안 지움).
    const rr = await store.resolveRoot(state.rootId)
    let root = state.rootId
    if (rr.switched && rr.rootId !== state.rootId) {
      root = rr.rootId
      result.rootSwitched = true
      state = await setSyncState(db, { rootId: root, seen: {}, pendingUpload: true })
    }
    for (const loser of rr.losers) if (loser !== root) await store.deleteRoot(loser)

    // 2. 기기 목록
    const nowD = now()
    const entries = (await store.listDevices(root)).sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.fileId < b.fileId ? -1 : 1))
    const own = entries.find((e) => e.deviceId === me)
    const known = new Map((state.devices ?? []).map((d) => [d.deviceId, d]))
    // 지난 업로드의 드라이브 시각을 못 읽었으면 지금 내 파일 시각으로 채운다(그 뒤 내 파일을 고친 것은 나뿐이고 아직 안 올렸다).
    if (state.upAtPending && own) {
      const mt = own.modifiedTime
      await db.transaction('rw', db.sync_rows, () => db.sync_rows.filter((r) => r.upAt === 'pending').modify({ upAt: mt }))
      state = await setSyncState(db, { upAtPending: false })
    }
    // 오래 쉰 이 PC: 마지막 성공과 내 파일 중 늦은 것이 90일보다 오래됐고 다른 기기가 있으면 합치지 않는다.
    // 그사이 다른 PC가 지움 표시를 정리했을 수 있어 합치면 지운 행이 되살아난다. '드라이브 자료로 바꾸기'(S6)만 허용.
    const selfTimes = [own?.modifiedTime, state.lastOk].map((t) => (t ? Date.parse(t) : NaN)).filter((t) => !Number.isNaN(t))
    if (selfTimes.length && entries.some((e) => e.deviceId !== me) && nowD.getTime() - Math.max(...selfTimes) > STALE_MS) {
      await setSyncState(db, { lastError: { code: 'stale-self', at: nowD.toISOString() } })
      return { ...result, ok: false, error: 'stale-self' }
    }
    const gcDue = !state.lastGc || nowD.getTime() - Date.parse(state.lastGc) >= GC_EVERY_MS || Number.isNaN(Date.parse(state.lastGc))
    const devices: SyncDevice[] = []
    const remotes: Remote[] = []
    const gcPeers: Record<string, SyncRow[] | undefined>[] = []
    let gcBlocked = false
    const seenNext: Record<string, string> = { ...state.seen }
    const handled = new Set<string>()
    for (const e of entries) {
      if (handled.has(e.deviceId)) continue // 목록이 늦게 반영되어 같은 기기 파일이 둘이면 먼저 만든 것만
      handled.add(e.deviceId)
      const name = known.get(e.deviceId)?.deviceName ?? e.deviceId
      const stale = nowD.getTime() - Date.parse(e.modifiedTime) > STALE_MS
      if (e.deviceId === me) { devices.push({ deviceId: me, deviceName, modifiedTime: e.modifiedTime, stale: false, mine: true }); continue }
      devices.push({ deviceId: e.deviceId, deviceName: name, modifiedTime: e.modifiedTime, stale, mine: false })
      if (stale) { warn(`stale-device:${name}`); continue }
      const changed = state.seen[e.deviceId] !== e.modifiedTime
      if (!changed && !gcDue) continue
      let snap: Snapshot
      try {
        snap = await openWsync(await store.downloadDevice(e.fileId), dek, e.deviceId, keyId)
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 404) { gcBlocked = true; continue } // 목록 뒤에 지워진 기기 파일
        if (err instanceof GoogleApiError) throw err
        const code = syncErrorCode(err)
        warn(`${code === 'unknown' ? 'bad-snapshot' : code}:${name}`)
        gcBlocked = true
        continue
      }
      devices[devices.length - 1].deviceName = snap.deviceName || name
      const label = snap.deviceName || name
      if (Date.parse(snap.at) - nowD.getTime() > CLOCK_AHEAD_MS) warn(`clock-ahead:${label}`)
      gcPeers.push(snap.tables)
      if (changed) remotes.push({ deviceId: e.deviceId, deviceName: label, entry: e, snap })
    }

    // 3. 합치기 전 안전 백업(하루 한 번)
    if (remotes.length && p.safetyBackup && state.lastSafetyBackup !== localDay(nowD)) {
      try {
        await p.safetyBackup()
        await setSyncState(db, { lastSafetyBackup: localDay(nowD) })
      } catch {
        warn('safety-backup-failed')
      }
    }

    // 4. 하나의 병합 묶음으로 합친다
    let nonTake = false
    let students = new Set<string>()
    if (remotes.length) {
      const m = await mergeRemotes(db, key, remotes, wasDirty, me)
      result.pulled = remotes.length
      result.merged += m.merged
      result.conflicts = m.conflicts
      nonTake = m.nonTake
      students = m.students
      if (m.badRows) warn('bad-rows')
      for (const r of remotes) seenNext[r.deviceId] = r.entry.modifiedTime
      const ex = foldExtra(await loadExtraStore(db), remotes)
      if (ex.changed) await db.device_local.put({ id: EXTRA_ID, value: ex.next })
    }
    state = await setSyncState(db, { seen: seenNext, devices })

    // 5. 합친 학생의 결석신고서를 다시 맞춘다(묶음 밖)
    let reconciled = false
    for (const sid of [...students].sort()) {
      const r = await reconcileStudent(db, sid)
      if (r.created || r.updated || r.removed || r.staled) reconciled = true
    }

    // 6. 없는 첨부를 받는다
    result.files.down = await downloadAttachments(db, dek, store, root, warn)

    // 학급 겹침 안내(§7.5: 자동으로 합치지 않는다)
    const classKeys = new Set<string>()
    for (const c of await db.classes.toArray()) {
      if (c.deleted) continue
      const k = `${c.school_year}/${c.grade}/${c.class_no}`
      if (classKeys.has(k)) { warn('class-duplicate'); break }
      classKeys.add(k)
    }

    // 지움 표시 정리(하루 한 번, 활성 기기 스냅숏을 모두 열었을 때만)
    if (gcDue && !gcBlocked) {
      const local: Record<string, SyncRow[]> = {}
      for (const t of SYNC_TABLES) local[t] = ((await db.table(t).toArray()) as Row[]).filter((r) => r.deleted === true && syncableRow(t, r)).map((r) => view(t, r))
      const gone = tombstoneGc(local, gcPeers, nowD)
      if (Object.keys(gone).length) {
        await mergeWrite(db, [...SYNC_TABLES.map((t) => db.table(t))], async () => {
          for (const [t, ids] of Object.entries(gone)) {
            const before = new Map(local[t].map((r) => [r.id, r.updated_at]))
            const rows = (await db.table(t).bulkGet(ids)) as (Row | undefined)[]
            const ok = ids.filter((id, i) => rows[i] && rows[i]!.deleted === true && rows[i]!.updated_at === before.get(id))
            if (ok.length) await db.table(t).bulkDelete(ok) // base는 남긴다: 같은 지움 표시를 다시 받지 않게
          }
        })
      }
      state = await setSyncState(db, { lastGc: nowD.toISOString() })
    }

    // 7. 올리기
    const needUpload = wasDirty || nonTake || reconciled || result.rootSwitched || !own || !!state.pendingUpload
    if (needUpload) {
      if (!state.pendingUpload) state = await setSyncState(db, { pendingUpload: true })
      result.files.up = await uploadAttachments(db, dek, store, root, warn)
      const tb = Date.now()
      const tables = await readOwnTables(db)
      const extraStore = await loadExtraStore(db)
      const extra: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(extraStore)) if (!KNOWN.has(k)) extra[k] = v.value
      const seen: Record<string, string> = {}
      for (const [k, v] of Object.entries(state.seen)) if (k !== me) seen[k] = v
      const bytes = await buildWsync({ dek, app: appVersion, deviceId: me, deviceName, keyId, at: now().toISOString(), tables, extra, seen })
      const fileId = await store.uploadDevice(root, me, bytes, own?.fileId)
      result.uploaded = 1
      // 'up' base의 upAt = 이 업로드 뒤 내 파일의 드라이브 시각. 못 읽으면 'pending'으로 두고 다음 번 목록에서 채운다.
      let upAt: string | null = null
      try { upAt = await store.fileModifiedTime(fileId) } catch { upAt = null }
      await markUploaded(db, key, tables, upAt ?? 'pending')
      if (!upAt) state = await setSyncState(db, { upAtPending: true })
      // 워터마크는 이 PC의 시계로만 올린다(남의 앞선 도장까지 올리면 그 아래로 찍힌 내 고침을 놓친다).
      // 스냅숏을 읽기 직전(tb)보다 앞선 고침은 모두 올렸고, 뒤의 고침은 tb 이상으로 찍힌다.
      state = await setSyncState(db, { lastUploadedMax: maxIso(state.lastUploadedMax, iso(tb - 1)), pendingUpload: false })
    } else {
      // 받기만 했다: 올리지 않는다. 받은 행은 base(at)로 dirty에서 빠지고, 워터마크는 dirty를 잰 때(tw)까지만 올린다.
      state = await setSyncState(db, { lastUploadedMax: maxIso(state.lastUploadedMax, iso(tw - 1)) })
    }
    await setSyncState(db, { lastOk: now().toISOString(), lastError: null })
    return result
  } catch (e) {
    const code = syncErrorCode(e)
    try { await setSyncState(db, { lastError: { code, at: now().toISOString() } }) } catch { /* 상태 저장 실패는 원래 오류를 가리지 않는다 */ }
    if (e instanceof GoogleApiError) return { ...result, ok: false, error: code }
    throw e
  }
}
