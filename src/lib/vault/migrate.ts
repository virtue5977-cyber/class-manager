import Dexie from 'dexie'
import { AppDB, SYNCED_TABLES, UNENCRYPTED_TABLES } from '../db/schema'
import type { AbsenceReportRec, DeviceLocalRec, NoteBlobRec, NoteFileRec, ReportAttendanceRec } from '../db/types'
import { linkId, reportId } from '../absenceReports/ids'
import { storeBackupKey, type DerivedPassKey } from '../backup/service'
import { b64ToBytes, openBlobBytes, sealBlobRows } from '../notes/blobs'
import { canonicalJson } from './canon'
import { buildVaultPayload, completeMetaRow, dbNameFor, newDek, verifyMetaCheck, type VaultPayload } from './keys'
import { mergeWrite, readRaw } from './middleware'
import { plainFieldsOf } from './plainFields'
import { openVaultDb } from './vaultDb'

/**
 * 옮기기(0.x 평문 'class-manager' → 1.0 암호화 'watson-*')와 첫 설치(spec §4).
 * 순서(컨트롤러 판정 1): DEK → 새 DB 만들기(옮기기 표시만, 완료 행 없음) → vault.store → 표 복사 → 확인 →
 * 완료 행(completeMetaRow) → 새 DB 백업(폴더 또는 내려받기) → finishMigration(옛 DB 지우기, migratedFrom).
 * 옛 DB는 finishMigration 전까지 읽기만 한다.
 */

export const OLD_DB_NAME = 'class-manager'
/** 새 DB meta 표의 옮기기 표시. 있으면 VaultGate는 앱을 열지 않는다(incomplete). */
export const MIGRATION_MARKER = 'migration'
export const MIGRATED_FROM = 'migratedFrom'
export const BATCH = 1000
/** note_files는 행에 base64 내용이 들어 있어 한 쪽을 바이트 예산(base64 글자 수)으로 자른다(적어도 한 행). */
export const FILE_PAGE_BUDGET = 32 * 1024 * 1024
/** 끝 BitLocker 안내를 보였다는 device_local 표시. */
export const BITLOCKER_NOTICE_KEY = 'bitlockerNoticeShown'

type Row = Record<string, unknown> & { id: string }

/** 옛 DB에서 옮기는 표(순서대로). meta·sync_rows·note_blobs는 평문 DB에서 비어 있고 새 DB가 따로 채운다. */
export const COPY_ORDER = ['device_local', ...SYNCED_TABLES, 'google_events'] as const

export interface Progress {
  table: string
  done: number
  total: number
  overall: { done: number; total: number }
}

// ---- 저장 공간 ----
type Estimate = { usage?: number; quota?: number }
const defaultEstimate = (): Promise<Estimate> =>
  typeof navigator !== 'undefined' && navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve({})

/** 두 벌이 잠시 함께 있으므로 남은 할당량이 지금 사용량 × 1.3 이상이어야 한다. 알 수 없으면 막지 않는다. */
export async function planStorage(estimate: () => Promise<Estimate> = defaultEstimate): Promise<{ ok: boolean; need: number; free: number }> {
  let e: Estimate | null = null
  try { e = await estimate() } catch { e = null }
  if (!e || typeof e.usage !== 'number' || typeof e.quota !== 'number' || !Number.isFinite(e.usage) || !Number.isFinite(e.quota)) {
    return { ok: true, need: 0, free: Infinity }
  }
  const need = Math.ceil(e.usage * 1.3)
  const free = e.quota - e.usage
  return { ok: need <= free, need, free }
}

// ---- 옛 DB ----
export async function dbExists(name: string): Promise<boolean> {
  try { return await Dexie.exists(name) } catch { return false }
}

/** 옛 평문 DB를 연다(시험의 WATSON_VAULT_TEST 갈고리를 타지 않도록 createDb가 아니라 AppDB). */
export function openOldDb(name = OLD_DB_NAME): AppDB {
  return new AppDB(name)
}

// ---- device_local: 허용·거부(컨트롤러 판정 9) ----
/**
 * 거부: backupKey(꺼낼 수 없는 CryptoKey, 보안 H2), backupKeyRaw(새 passKey로 새로 쓴다), backupFolder(웹 폴더 핸들).
 * 그 밖에도 암호화 직렬화(canonicalJson)를 통과하지 못하는 값(CryptoKey·핸들·Date·Map 등)은 뺀다.
 * 나머지(pin·API 키·deviceId·현재 학급 등)는 그대로 옮겨 암호화한다.
 */
export const DEVICE_LOCAL_DENY: ReadonlySet<string> = new Set(['backupKey', 'backupKeyRaw', 'backupFolder'])

export function filterDeviceLocal(rows: DeviceLocalRec[]): { keep: DeviceLocalRec[]; dropped: { id: string; reason: 'deny' | 'unserializable' }[] } {
  const keep: DeviceLocalRec[] = []
  const dropped: { id: string; reason: 'deny' | 'unserializable' }[] = []
  for (const r of rows) {
    const id = String(r.id)
    if (DEVICE_LOCAL_DENY.has(id)) { dropped.push({ id, reason: 'deny' }); continue }
    try {
      canonicalJson({ id: r.id, value: r.value })
    } catch {
      dropped.push({ id, reason: 'unserializable' })
      continue
    }
    keep.push(r)
  }
  return { keep, dropped }
}

// ---- 결석신고서 id ----
/**
 * 옛(무작위 id) 신고서를 결정적 id(spec §7.3)로 바꾼다. remapReportIds와 달리 아무것도 버리지 않는다:
 * 같은 결정적 id로 겹치면(살아 있는 둘이든 지운 것이든) 뒤의 것은 `:2`, `:3` …을 붙인다. 바꾸기는 일대일이라
 * 연결(report_attendance)은 언제나 제 신고서를 따라간다. 이미 'report:'로 시작하는 id와 짝 없는 연결은 그대로 둔다.
 */
export function planReports(
  reports: AbsenceReportRec[],
  links: ReportAttendanceRec[],
): { reports: AbsenceReportRec[]; links: ReportAttendanceRec[]; map: Map<string, string> } {
  const map = new Map<string, string>()
  const used = new Set<string>()
  const free = (base: string) => {
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}:${n}`
    used.add(id)
    return id
  }
  const kept = reports.filter((r) => r.id.startsWith('report:'))
  for (const r of kept) { used.add(r.id); map.set(r.id, r.id) }
  const rest = reports
    .filter((r) => !r.id.startsWith('report:'))
    .sort((a, b) => Number(a.deleted) - Number(b.deleted) || (a.updated_at > b.updated_at ? -1 : a.updated_at < b.updated_at ? 1 : 0) || (a.id < b.id ? -1 : 1))
  for (const r of rest) map.set(r.id, free(reportId(r)))
  const outReports = reports.map((r) => ({ ...r, id: map.get(r.id)! }))
  const lused = new Set<string>()
  for (const l of links) if (!map.has(l.report_id)) lused.add(l.id) // 짝 없는 연결은 id 그대로
  const outLinks = links.map((l) => {
    const nr = map.get(l.report_id)
    if (!nr) return l
    const base = linkId(nr, l.attendance_id)
    let id = base
    for (let n = 2; lused.has(id); n++) id = `${base}:${n}`
    lused.add(id)
    return { ...l, report_id: nr, id }
  })
  return { reports: outReports, links: outLinks, map }
}

// ---- 새 DB ----
/** 이 PC에 없는 이름이 나올 때까지 새 DEK·keyId를 만든다(남의 DB를 건드리지 않는다). */
export async function pickNewKey(): Promise<{ dek: Uint8Array; keyId: string }> {
  const existing = new Set(await Dexie.getDatabaseNames())
  let k = newDek()
  while (existing.has(dbNameFor(k.keyId))) k = newDek()
  return k
}

/** 새 암호화 DB를 만들어 연다. 완료 행은 쓰지 않는다. 옮기기면 옮기기 표시를 남긴다. 이미 있으면 거절. */
export async function createNewVaultDb(dek: Uint8Array, keyId: string, opts: { migration?: boolean; from?: string } = {}): Promise<AppDB> {
  const name = dbNameFor(keyId)
  if (await dbExists(name)) throw new Error('같은 이름의 자료가 이미 있습니다. 다시 시도해 주세요.')
  const db = openVaultDb(name, dek)
  await db.open()
  if (opts.migration) await db.meta.put({ id: MIGRATION_MARKER, from: opts.from ?? OLD_DB_NAME, stage: 'copy', at: new Date().toISOString() })
  return db
}

export async function markComplete(db: AppDB, dek: Uint8Array, keyId: string): Promise<void> {
  await db.meta.put(completeMetaRow(dek, keyId))
}

// ---- 복사 ----
function stripFile(r: NoteFileRec): NoteFileRec {
  const { data: _d, chunks: _c, ...meta } = r
  void _d; void _c
  return meta as NoteFileRec
}

/** 기본키 순으로 한 행씩 읽어, 행 수(size)나 바이트 예산(budget)에 닿으면 한 쪽으로 넘긴다. */
async function budgetPages(table: Dexie.Table, size: number, budget: number, cost: (r: Row) => number, fn: (rows: Row[]) => Promise<void>): Promise<void> {
  let last: string | undefined
  for (;;) {
    const rows: Row[] = []
    let used = 0
    while (rows.length < size && (rows.length === 0 || used < budget)) {
      const coll = last === undefined ? table.orderBy(':id') : table.where(':id').above(last)
      const r = (await coll.first()) as Row | undefined
      if (!r) break
      rows.push(r)
      used += cost(r)
      last = r.id
    }
    if (!rows.length) return
    await fn(rows)
  }
}

async function pages(table: Dexie.Table, size: number, fn: (rows: Row[]) => Promise<void>): Promise<void> {
  let last: string | undefined
  for (;;) {
    const coll = last === undefined ? table.orderBy(':id') : table.where(':id').above(last)
    const rows = (await coll.limit(size).toArray()) as Row[]
    if (!rows.length) return
    await fn(rows)
    last = rows[rows.length - 1].id
    if (rows.length < size) return
  }
}

/**
 * 옛 DB의 표를 새 DB로 옮긴다(병합 쓰기: 원래 updated_at 유지, 1천 행씩 묶음, 평문 → 미들웨어가 암호화).
 * device_local은 filterDeviceLocal, note_files 내용은 note_blobs로, 신고서는 planReports.
 * passKey가 있으면 새 DB의 backupKeyRaw로 둔다(vault pass 감싸기와 같은 값, spec §3).
 */
export async function migrate(opts: {
  oldDb: AppDB
  newDb: AppDB
  passKey?: DerivedPassKey
  onProgress?: (p: Progress) => void
  batch?: number
  /** note_files 한 쪽의 base64 글자 수 예산(기본 32MB) */
  fileBudget?: number
}): Promise<{ newName: string; counts: Record<string, number> }> {
  const { oldDb, newDb } = opts
  const size = opts.batch ?? BATCH
  if (!newDb.isVault) throw new Error('새 DB가 암호화 DB가 아닙니다.')
  if (oldDb.isVault) throw new Error('옛 DB가 평문 DB가 아닙니다.')
  if (!oldDb.isOpen()) await oldDb.open()
  const totals: Record<string, number> = {}
  for (const t of COPY_ORDER) totals[t] = await oldDb.table(t).count()
  const overall = { done: 0, total: Object.values(totals).reduce((a, b) => a + b, 0) }
  const counts: Record<string, number> = {}
  const tell = (table: string, done: number) => opts.onProgress?.({ table, done, total: totals[table], overall: { ...overall } })

  const plan = planReports(
    (await oldDb.absence_reports.toArray()) as AbsenceReportRec[],
    (await oldDb.report_attendance.toArray()) as ReportAttendanceRec[],
  )

  for (const t of COPY_ORDER) {
    tell(t, 0)
    const dst = newDb.table(t)
    let done = 0
    const step = async (n: number) => {
      done += n
      overall.done += n
      tell(t, done)
    }
    if (t === 'device_local') {
      const { keep } = filterDeviceLocal((await oldDb.device_local.toArray()) as DeviceLocalRec[])
      await mergeWrite(newDb, [dst], () => dst.bulkAdd(keep))
      if (opts.passKey) await storeBackupKey(newDb, opts.passKey)
      counts[t] = keep.length
      await step(totals[t])
      continue
    }
    if (t === 'absence_reports' || t === 'report_attendance') {
      const rows = (t === 'absence_reports' ? plan.reports : plan.links) as unknown as Row[]
      for (let i = 0; i < rows.length; i += size) {
        const part = rows.slice(i, i + size)
        await mergeWrite(newDb, [dst], () => dst.bulkAdd(part))
        await step(part.length)
      }
      counts[t] = rows.length
      continue
    }
    if (t === 'note_files') {
      let n = 0
      const fileCost = (r: Row) => (typeof r.data === 'string' ? r.data.length : 0)
      await budgetPages(oldDb.note_files, size, opts.fileBudget ?? FILE_PAGE_BUDGET, fileCost, async (rows) => {
        const files: NoteFileRec[] = []
        const blobs: NoteBlobRec[] = []
        for (const r of rows as unknown as NoteFileRec[]) {
          const out = stripFile(r)
          if (!r.deleted) {
            // 묶음 밖에서 암호화(sealBlobRows가 큰 파일을 조각내고 양보한다). 내용 없는 첨부도 빈 blob을 둔다(평문 readFile과 같게).
            const sealed = await sealBlobRows(newDb, r.id, b64ToBytes(typeof r.data === 'string' ? r.data : ''))
            blobs.push(...sealed.rows)
            if (sealed.chunks) out.chunks = sealed.chunks
          }
          files.push(out)
        }
        await mergeWrite(newDb, [dst, newDb.note_blobs], async () => {
          if (blobs.length) await newDb.note_blobs.bulkAdd(blobs)
          await dst.bulkAdd(files)
        })
        n += rows.length
        await step(rows.length)
      })
      counts[t] = n
      continue
    }
    let n = 0
    await pages(oldDb.table(t), size, async (rows) => {
      await mergeWrite(newDb, [dst], () => dst.bulkAdd(rows))
      n += rows.length
      await step(rows.length)
    })
    counts[t] = n
  }
  return { newName: newDb.name, counts }
}

// ---- 확인 ----
export interface VerifyResult { ok: boolean; problems: string[] }
/** verifyMigration이 통과시킨 결과 → 그 새 DB. finishMigration은 여기 있는 결과만 받는다(흉내 낸 객체 거절). */
const VERIFIED = new WeakMap<object, AppDB>()
const UNENCRYPTED = new Set<string>(UNENCRYPTED_TABLES)
/** 새 DB에만 있어도 되는 device_local 키(옮기기가 쓰는 것). */
const DEVICE_LOCAL_EXTRA = new Set(['backupKeyRaw'])

function pickSample<T>(arr: T[], n: number): T[] {
  const a = arr.slice()
  const k = Math.min(n, a.length)
  for (let i = 0; i < k; i++) {
    const j = i + (crypto.getRandomValues(new Uint32Array(1))[0] % (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, k)
}

const latin1 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000) as unknown as number[])
  return s
}
const asU8 = (v: unknown): Uint8Array | null =>
  ArrayBuffer.isView(v) ? new Uint8Array((v as Uint8Array).buffer, (v as Uint8Array).byteOffset, (v as Uint8Array).byteLength) : null

const u8len = (s: string) => new TextEncoder().encode(s).length
/**
 * 표본에서 '드러나면 안 되는' 글: 평문 칸 밖의 모든 문자열(이름·글·전화 등). UTF-8로 6바이트 이상만 본다
 * (한글 두 글자 이름부터 잡고, 짧은 숫자가 암호문 바이트에 우연히 맞는 일은 피한다).
 */
function secretsOf(row: Row, plain: ReadonlySet<string>): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') { const s = v.trim(); if (u8len(s) >= 6) out.push(s) }
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) Object.values(v).forEach(walk)
  }
  for (const [k, v] of Object.entries(row)) if (!plain.has(k)) walk(v)
  return out
}

async function rawGet(db: AppDB, table: string, ids: string[]): Promise<(Row | undefined)[]> {
  const idb = db.backendDB()
  const store = idb.transaction(table, 'readonly').objectStore(table)
  return Promise.all(ids.map((id) => new Promise<Row | undefined>((res, rej) => {
    const req = store.get(id)
    req.onsuccess = () => res(req.result as Row | undefined)
    req.onerror = () => rej(req.error)
  })))
}

/**
 * spec §4.2 7: 표마다 행 수, 무작위 표본(표마다 samples행)의 정규 JSON 동일(신고서는 바꾼 id로),
 * 첨부 내용 동일, 원시 IndexedDB(미들웨어 없이)에 평문 칸 밖의 칸이 없고 표본의 이름·글·전화가 보이지 않음.
 */
export async function verifyMigration(oldDb: AppDB, newDb: AppDB, samples = 20): Promise<VerifyResult> {
  const problems: string[] = []
  const plan = planReports(
    (await oldDb.absence_reports.toArray()) as AbsenceReportRec[],
    (await oldDb.report_attendance.toArray()) as ReportAttendanceRec[],
  )
  for (const t of COPY_ORDER) {
    try {
      const newCount = await newDb.table(t).count()
      let expected: Row[] = []
      if (t === 'device_local') {
        const { keep } = filterDeviceLocal((await oldDb.device_local.toArray()) as DeviceLocalRec[])
        const want = new Set(keep.map((r) => String(r.id)))
        const have = (await newDb.device_local.toCollection().primaryKeys()) as string[]
        const extra = have.filter((id) => !want.has(id) && !DEVICE_LOCAL_EXTRA.has(id))
        const missing = [...want].filter((id) => !have.includes(id))
        if (extra.length || missing.length) problems.push(`device_local: 키가 다릅니다(빠짐 ${missing.length}, 더함 ${extra.length})`)
        expected = pickSample(keep as unknown as Row[], samples)
      } else if (t === 'absence_reports' || t === 'report_attendance') {
        const all = (t === 'absence_reports' ? plan.reports : plan.links) as unknown as Row[]
        if (all.length !== newCount) problems.push(`${t}: 행 수 ${all.length} → ${newCount}`)
        expected = pickSample(all, samples)
      } else {
        const ids = (await oldDb.table(t).toCollection().primaryKeys()) as string[]
        if (ids.length !== newCount) problems.push(`${t}: 행 수 ${ids.length} → ${newCount}`)
        const pick = pickSample(ids, samples)
        expected = ((await oldDb.table(t).bulkGet(pick)) as Row[]).filter(Boolean)
      }
      if (!expected.length) continue
      const ids = expected.map((r) => r.id)
      const got = (await newDb.table(t).bulkGet(ids)) as (Row | undefined)[]
      for (let i = 0; i < expected.length; i++) {
        const want = t === 'note_files' ? stripFile(expected[i] as unknown as NoteFileRec) : expected[i]
        const g = got[i]
        const have = g && t === 'note_files' ? stripFile(g as unknown as NoteFileRec) : g
        if (!have || canonicalJson(have) !== canonicalJson(want)) problems.push(`${t}: 표본 ${ids[i]} 내용이 다릅니다`)
      }
      // 첨부 내용
      if (t === 'note_files') {
        for (let i = 0; i < expected.length; i++) {
          const o = expected[i] as unknown as NoteFileRec
          if (o.deleted) continue
          const want = b64ToBytes(typeof o.data === 'string' ? o.data : '')
          let back: Uint8Array | null = null
          try { back = await openBlobBytes(newDb, got[i] as unknown as NoteFileRec) } catch { back = null }
          if (!back || back.length !== want.length || back.some((b, j) => b !== want[j])) { problems.push(`note_files: 첨부 ${o.id} 내용이 다릅니다`); continue }
          if (want.length >= 8) {
            const blobs = await rawGet(newDb, 'note_blobs', (got[i] as unknown as NoteFileRec).chunks ? [`${o.id}#0`] : [o.id])
            const needle = latin1(want.subarray(0, 32))
            if (blobs.some((b) => b && latin1(asU8(b._enc) ?? new Uint8Array()).includes(needle))) problems.push(`note_blobs: 원시 첨부 ${o.id}에 평문이 보입니다`)
          }
        }
      }
      // 원시 행
      if (!UNENCRYPTED.has(t)) {
        const plain = plainFieldsOf(newDb, t)
        for (const r of await readRaw(newDb, t)) {
          const bad = Object.keys(r).filter((k) => k !== '_enc' && !plain.has(k))
          if (bad.length || !asU8(r._enc)) problems.push(`${t}: 원시 행 ${String(r.id)}에 평문 칸(${bad.join(',') || '_enc 없음'})`)
        }
        const raws = await rawGet(newDb, t, ids)
        for (let i = 0; i < expected.length; i++) {
          const r = raws[i]
          if (!r) continue
          const bytes = asU8(r._enc) ?? new Uint8Array()
          const { _enc: _e, ...rest } = r
          void _e
          const plainText = JSON.stringify(Object.fromEntries(Object.entries(rest).filter(([k]) => plain.has(k))))
          const hay = JSON.stringify(rest) + new TextDecoder().decode(bytes) + latin1(bytes)
          for (const s of secretsOf(expected[i], plain)) {
            if (hay.includes(s) && !plainText.includes(s)) { problems.push(`${t}: 원시 행 ${r.id}에 평문이 보입니다`); break }
          }
        }
      }
    } catch (e) {
      problems.push(`${t}: 확인하지 못했습니다(${e instanceof Error ? e.message : String(e)})`)
    }
  }
  const result: VerifyResult = { ok: problems.length === 0, problems }
  if (result.ok) VERIFIED.set(result, newDb)
  return result
}

// ---- 새 vault 만들기(옮기기·첫 설치) ----
export interface SetupOpts {
  passKey: DerivedPassKey
  recovery?: { raw: Uint8Array; salt: Uint8Array; iter: number }
  store: (p: VaultPayload) => Promise<unknown>
  reset: () => Promise<unknown>
  /** 있으면 옮기기, 없으면 첫 설치(빈 DB) */
  migrateFrom?: AppDB
  onProgress?: (p: Progress) => void
  samples?: number
}

export interface SetupResult {
  db: AppDB
  dek: Uint8Array
  keyId: string
  payload: VaultPayload
  counts: Record<string, number>
  verify?: VerifyResult
}

/**
 * 새 DEK → 새 DB(완료 행 없음) → vault.store → (옮기기: 복사·확인 / 첫 설치: 백업 열쇠) → 완료 행.
 * 어느 단계든 실패하면 discardNewVault로 새 DB와 vault를 지우고 오류를 다시 올린다(오류의 discard = 정리 결과). 옛 DB는 읽기만 한다.
 */
export async function setupNewVault(opts: SetupOpts): Promise<SetupResult> {
  const { dek, keyId } = await pickNewKey()
  let db: AppDB | null = null
  try {
    db = await createNewVaultDb(dek, keyId, { migration: !!opts.migrateFrom, from: opts.migrateFrom?.name })
    const payload = buildVaultPayload({
      keyId, dek, passRaw: opts.passKey.raw, passSalt: opts.passKey.salt, passIter: opts.passKey.iter,
      ...(opts.recovery ? { recoveryRaw: opts.recovery.raw, recoverySalt: opts.recovery.salt, recoveryIter: opts.recovery.iter } : {}),
    })
    await opts.store(payload)
    let counts: Record<string, number> = {}
    let verify: VerifyResult | undefined
    if (opts.migrateFrom) {
      counts = (await migrate({ oldDb: opts.migrateFrom, newDb: db, passKey: opts.passKey, onProgress: opts.onProgress })).counts
      verify = await verifyMigration(opts.migrateFrom, db, opts.samples)
      if (!verify.ok) throw new Error(`옮긴 자료를 확인하지 못했습니다: ${verify.problems.slice(0, 3).join(' / ')}`)
    } else {
      await storeBackupKey(db, opts.passKey)
    }
    await markComplete(db, dek, keyId)
    return { db, dek, keyId, payload, counts, verify }
  } catch (e) {
    const name = dbNameFor(keyId)
    try { db?.close() } catch { /* ignore */ }
    const discard = await discardNewVault({ dbName: name, reset: opts.reset, oldName: opts.migrateFrom?.name ?? OLD_DB_NAME })
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { discard, dbName: name })
  }
}

// ---- 지우기·이어 하기 ----
/** meta·device_local 말고 행이 하나라도 있으면 참(원시로 센다: 열쇠가 필요 없다). */
async function hasUserRows(db: AppDB): Promise<boolean> {
  for (const t of db.tables) {
    if (t.name === 'meta' || t.name === 'device_local') continue
    if ((await t.count()) > 0) return true
  }
  return false
}

/** 미들웨어 없이 새 DB를 연다(meta는 평문 표, count는 열쇠가 필요 없다). 없으면 null(만들지 않는다). */
async function probeVaultDb(name: string): Promise<AppDB | null> {
  if (!(await dbExists(name))) return null
  const db = new AppDB(name, { vault: true })
  await db.open()
  return db
}

/**
 * 옛 DB에서 '자료'로 치지 않는 표: 빈 DB를 옛 exe가 다시 만들 때 저절로 채워질 수 있는 기본값·받아 온 자료.
 * (지우기 판단은 좁게 셀수록 안전하다: 옛 DB에 자료가 있다고 볼 때만 새 vault를 지울 수 있다.)
 */
const OLD_SEEDED = new Set(['app_settings', 'reflection_phrases', 'ai_prompts', 'neis_cache', 'school_calendar'])

/** 학생 자료 표(SYNCED 중 OLD_SEEDED 아닌 것)에 행이 있는가. */
async function hasStudentData(d: Dexie): Promise<boolean> {
  for (const t of d.tables) {
    if (!(SYNCED_TABLES as readonly string[]).includes(t.name) || OLD_SEEDED.has(t.name)) continue
    if ((await t.count()) > 0) return true
  }
  return false
}

/** 옛 DB가 있고 학생 자료 표에 행이 있는가. 열지 못하면 참(모르면 있다고 본다: 옛 DB를 지우지 않는 쪽). */
export async function oldHasUserRows(name: string): Promise<boolean> {
  if (!(await dbExists(name))) return false
  const d = new Dexie(name) // 스키마 없이 지금 판 그대로 연다(판을 올리지 않음)
  try {
    await d.open()
    return await hasStudentData(d)
  } catch {
    return true
  } finally {
    d.close()
  }
}

/** 옛 DB에 device_local 말고는 아무 행도 없는가(정말 빈 옛 DB). 열지 못하면 거짓(지우지 않는 쪽). */
async function oldOnlyDeviceLocal(name: string): Promise<boolean> {
  const d = new Dexie(name)
  try {
    await d.open()
    for (const t of d.tables) {
      if (t.name === 'device_local') continue
      if ((await t.count()) > 0) return false
    }
    return true
  } catch {
    return false
  } finally {
    d.close()
  }
}

/** 완료 행(complete: true)이 있는가(확인값과 상관없이). */
async function hasCompleteRow(db: AppDB): Promise<boolean> {
  return (await db.meta.get('vault'))?.complete === true
}

/**
 * 새 vault를 지워도 되는가(컨트롤러 판정 3 + 최종 수정): 옛 DB에 자료가 있거나,
 * 새 DB에 완료 행이 없는데 옛 DB가 있거나(그러면 새 DB는 덜 만든 사본일 뿐), 새 DB에 meta·device_local 말고 행이 없을 때만.
 */
async function resetAllowed(dbName: string, oldName: string): Promise<boolean> {
  if (await oldHasUserRows(oldName)) return true
  const db = await probeVaultDb(dbName)
  if (!db) return true
  try {
    if (!(await hasCompleteRow(db)) && (await dbExists(oldName))) return true
    return !(await hasUserRows(db))
  } finally { db.close() }
}

/**
 * 잠금 화면·이어 하기의 '처음부터 다시'를 보여도 되는가: 새 DB가 이 PC에 있고 완료 행이 없으며,
 * 옛 DB가 있거나(새 DB는 덜 만든 사본) 새 DB에 meta·device_local 말고 행이 없을 때만. 완료 행이 있으면 언제나 거짓.
 */
export async function canStartOver(dbName: string, oldName = OLD_DB_NAME): Promise<boolean> {
  const db = await probeVaultDb(dbName)
  if (!db) return false
  try {
    if (await hasCompleteRow(db)) return false
    if (await dbExists(oldName)) return true
    return !(await hasUserRows(db))
  } finally { db.close() }
}

export type DiscardStatus = 'done' | 'refused' | 'db-failed' | 'reset-failed'

/** 새 DB 지우기 → vault.reset. 조건은 부르는 쪽이 확인했다. */
async function wipeNewVault(dbName: string, reset: () => Promise<unknown>): Promise<DiscardStatus> {
  try {
    if (await dbExists(dbName)) await Dexie.delete(dbName)
  } catch { return 'db-failed' }
  try { await reset() } catch { return 'reset-failed' }
  return 'done'
}

/**
 * 새 vault를 지운다: 조건 확인 → 새 DB 지우기 → vault.reset. 무엇이 실패했는지 그대로 돌려준다
 * (화면이 지우지 못한 것을 지웠다고 말하지 않게).
 */
export async function discardNewVault(opts: { dbName: string; reset: () => Promise<unknown>; oldName?: string }): Promise<DiscardStatus> {
  try {
    if (!(await resetAllowed(opts.dbName, opts.oldName ?? OLD_DB_NAME))) return 'refused'
  } catch { return 'refused' }
  return wipeNewVault(opts.dbName, opts.reset)
}

/** '처음부터 다시'(잠금 화면): canStartOver일 때만 새 DB와 vault를 지운다. */
export async function startOver(opts: { dbName: string; reset: () => Promise<unknown>; oldName?: string }): Promise<DiscardStatus> {
  try {
    if (!(await canStartOver(opts.dbName, opts.oldName ?? OLD_DB_NAME))) return 'refused'
  } catch { return 'refused' }
  return wipeNewVault(opts.dbName, opts.reset)
}

/** 옮기기·첫 설치를 시작하기 전(vault 없음): 완료 행이 없는 watson-* DB(지난 실패·중단)를 지운다. 완료 행이 있는 것은 건드리지 않는다. */
export async function cleanupOrphans(): Promise<string[]> {
  const removed: string[] = []
  for (const name of await Dexie.getDatabaseNames()) {
    if (!/^watson-[0-9a-f]{8}$/.test(name)) continue
    const d = new Dexie(name)
    let orphan = false
    try {
      await d.open()
      if (!d.tables.some((t) => t.name === 'meta')) continue
      const row = (await d.table('meta').get('vault')) as Record<string, unknown> | undefined
      orphan = !(row?.complete === true && typeof row.keyId === 'string' && typeof row.check === 'string' && !!row.check)
    } catch {
      continue
    } finally {
      d.close()
    }
    if (orphan) {
      try { await Dexie.delete(name); removed.push(name) } catch { /* 다음에 다시 */ }
    }
  }
  return removed
}

async function finalizeMeta(db: AppDB, from: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await db.meta.put({ id: MIGRATED_FROM, name: from, at: new Date().toISOString() })
    await db.meta.delete(MIGRATION_MARKER)
  })
}

/** 이어 끝낸 새 DB에 BitLocker 안내 표시가 없으면 남기고 참(화면이 한 번 보인다, spec §4.2 10). */
async function noteBitlocker(dbName: string, dek: Uint8Array): Promise<boolean> {
  const db = openVaultDb(dbName, dek)
  try {
    await db.open()
    if (await db.device_local.get(BITLOCKER_NOTICE_KEY)) return false
    await db.device_local.put({ id: BITLOCKER_NOTICE_KEY, value: new Date().toISOString() })
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

export type ResumeResult =
  | { action: 'reset'; restart: 'migrate' | 'first-install' }
  | { action: 'resumed'; bitlocker: boolean }
  /** 완료된 새 DB(확인됨)와 옛 DB 둘 다 열어 돌려준다. 새 백업을 만든 뒤 finishMigration(oldDb, db, { verify })로 끝낸다. */
  | { action: 'backup'; db: AppDB; oldDb: AppDB; verify: VerifyResult }
  | { action: 'blocked'; reason: string }

const restartBy = (oldExists: boolean): 'migrate' | 'first-install' => (oldExists ? 'migrate' : 'first-install')

function wipeResult(st: DiscardStatus, restart: 'migrate' | 'first-install'): ResumeResult {
  if (st === 'refused') return { action: 'blocked', reason: '새 자료에 기록이 있어 지우지 않았습니다.' }
  if (st === 'db-failed') return { action: 'blocked', reason: '새로 만들던 자료를 지우지 못했습니다(열쇠 파일은 그대로). 다시 켜서 시도하세요.' }
  if (st === 'reset-failed') return { action: 'blocked', reason: '새로 만들던 자료는 지웠지만 열쇠 파일을 지우지 못했습니다. 다시 켜서 시도하세요.' }
  return { action: 'reset', restart }
}

/**
 * vault.json은 있는데 새 DB가 끝나지 않았을 때(VaultGate 'incomplete').
 * - 완료 행이 이 열쇠로 확인되면 새 DB는 버리지 않는다:
 *   'delete-old' 표시(새 백업 증거를 받은 뒤)이거나 옛 DB가 없거나 device_local 말고 비었으면 → 옛 DB를 (있으면) 마저 지우고 이어 한다.
 *   그 밖(옛 DB에 행이 있음) → 옛 DB를 지우지 않고 다시 확인해 새 백업 단계로('backup'). 옛 DB가 그 뒤 바뀌었으면
 *   (확인 실패, 옛 DB가 학생 자료를 가졌거나 새 DB에 학생 자료가 없을 때) 새 DB를 버리고 옮기기부터.
 * - 완료 행이 있는데 확인할 수 없으면 아무것도 지우지 않는다.
 * - 완료 행이 없으면: 옛 DB가 있으면(행 수와 상관없이) 새 DB는 덜 만든 사본 → 지우고 옮기기부터.
 *   옛 DB가 없으면 새 DB에 meta·device_local 말고 행이 없을 때만 지우고 첫 설치.
 */
export async function resumeOrReset(opts: {
  dbName: string
  reset: () => Promise<unknown>
  oldName?: string
  key?: { dek: Uint8Array; keyId: string }
  samples?: number
}): Promise<ResumeResult> {
  const oldName = opts.oldName ?? OLD_DB_NAME
  const oldExists = await dbExists(oldName)
  const db = await probeVaultDb(opts.dbName)
  if (!db) return wipeResult(await wipeNewVault(opts.dbName, opts.reset), restartBy(oldExists))
  let complete = false
  let verified = false
  try {
    const marker = await db.meta.get(MIGRATION_MARKER)
    const row = await db.meta.get('vault')
    complete = row?.complete === true
    verified = !!opts.key && complete && verifyMetaCheck(opts.key.dek, opts.key.keyId, row)
    if (verified && (marker?.stage === 'delete-old' || !oldExists || (await oldOnlyDeviceLocal(oldName)))) {
      if (oldExists) await Dexie.delete(oldName)
      await finalizeMeta(db, typeof marker?.from === 'string' ? marker.from : oldName)
      db.close()
      return { action: 'resumed', bitlocker: await noteBitlocker(opts.dbName, opts.key!.dek) }
    }
  } finally {
    db.close()
  }
  if (verified) {
    // 옛 DB에 행이 있다: 백업 증거 없이는 지우지 않는다. 다시 확인해 새 백업 단계로.
    const oldDb = openOldDb(oldName)
    const newDb = openVaultDb(opts.dbName, opts.key!.dek)
    let keep = false
    try {
      await oldDb.open()
      await newDb.open()
      const verify = await verifyMigration(oldDb, newDb, opts.samples)
      if (verify.ok) { keep = true; return { action: 'backup', db: newDb, oldDb, verify } }
      // 옛 DB에 학생 자료가 없는데 새 DB에는 있다 → 옛 DB는 다시 만들어진 빈 것. 새 DB가 자료다(완료 행 = 만들 때 확인 통과).
      if (!(await oldHasUserRows(oldName)) && (await hasStudentData(newDb))) {
        const trusted: VerifyResult = { ok: true, problems: [] }
        VERIFIED.set(trusted, newDb)
        keep = true
        return { action: 'backup', db: newDb, oldDb, verify: trusted }
      }
    } finally {
      if (!keep) { oldDb.close(); newDb.close() }
    }
    // 옛 DB가 그 뒤 바뀌었다(옛 exe): 옛 DB가 더 새 자료. 새 DB는 지난 사본일 뿐이라 버리고 옮기기부터.
    return wipeResult(await wipeNewVault(opts.dbName, opts.reset), 'migrate')
  }
  if (complete) return { action: 'blocked', reason: '새 자료가 이미 완료되어 있지만 이 열쇠로 확인하지 못해 지우지 않았습니다.' }
  // 완료 행 없음: 옛 DB가 있으면 새 DB는 덜 만든 사본이다(행 수와 상관없이).
  if (oldExists) return wipeResult(await wipeNewVault(opts.dbName, opts.reset), 'migrate')
  const st = await startOver({ dbName: opts.dbName, reset: opts.reset, oldName })
  if (st === 'refused') return { action: 'blocked', reason: '옛 자료는 이미 없고 새 자료에 기록이 있어 지우지 않았습니다.' }
  return wipeResult(st, 'first-install')
}

// ---- 옛 DB 지우기 ----
/** skipped: 그 백업 파일에서 손상되어 빠진 첨부 수. 0일 때만 옛 DB를 지울 수 있다(빠진 첨부는 옛 DB에만 성하게 남아 있다). */
export interface BackupProof { kind: 'folder' | 'download'; name: string; skipped: number }

export const skippedRefusal = (n: number) => `첨부 ${n}개가 새 자료에서 손상되어 옛 자료를 지우지 않았습니다. 다시 시도하세요.`

/**
 * spec §4.1 옛 DB를 지우는 조건(셋 다): vault에 암호구 길(pass), 새 DB 확인 통과(verifyMigration 결과),
 * 새 DB 백업 파일 하나(폴더에 썼거나 내려받음). 하나라도 없으면 거절하고 옛 DB를 건드리지 않는다.
 * 그 뒤: 'delete-old' 표시 → 옛 DB 닫고 지우기 → migratedFrom 남기고 표시 지우기.
 */
export async function finishMigration(
  oldDb: AppDB,
  newDb: AppDB,
  opts: { vault: Pick<VaultPayload, 'keyId'> & { pass?: Partial<VaultPayload['pass']> }; verify: VerifyResult; backup: BackupProof },
): Promise<void> {
  const p = opts.vault?.pass
  if (!p || typeof p.ct !== 'string' || !p.ct || typeof p.salt !== 'string' || !p.salt) {
    throw new Error('백업 암호구로 여는 길이 없어 옛 자료를 지우지 않습니다.')
  }
  if (!opts.verify || VERIFIED.get(opts.verify) !== newDb || !opts.verify.ok) {
    throw new Error('새 자료 확인을 통과하지 않아 옛 자료를 지우지 않습니다.')
  }
  const b = opts.backup
  if (!b || (b.kind !== 'folder' && b.kind !== 'download') || typeof b.name !== 'string' || !b.name) {
    throw new Error('새 자료의 백업 파일이 없어 옛 자료를 지우지 않습니다.')
  }
  if (b.skipped !== 0) {
    if (typeof b.skipped === 'number' && b.skipped > 0) throw new Error(skippedRefusal(b.skipped))
    throw new Error('새 백업 파일에 모든 첨부가 들어갔는지 알 수 없어 옛 자료를 지우지 않습니다.')
  }
  const row = await newDb.meta.get('vault')
  if (row?.complete !== true || row.keyId !== opts.vault.keyId) throw new Error('새 자료가 완료되지 않아 옛 자료를 지우지 않습니다.')
  if (oldDb.name === newDb.name || oldDb.isVault) throw new Error('지울 옛 자료가 맞지 않습니다.')
  await newDb.meta.put({ id: MIGRATION_MARKER, from: oldDb.name, stage: 'delete-old', at: new Date().toISOString() })
  oldDb.close()
  await Dexie.delete(oldDb.name)
  await finalizeMeta(newDb, oldDb.name)
}
