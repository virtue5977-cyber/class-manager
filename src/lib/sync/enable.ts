// 동기화 켜기(spec §7.5)·처음 합치기·열쇠 맞추기(§7.7)·끊기. 화면(S8)이 부른다. 계약은 task-S6-report.md 'UI contract'.
import Dexie from 'dexie'
import type { AppDB } from '../db/schema'
import type { NoteFileRec } from '../db/types'
import type { PublicVault, VaultStatus } from '../desktop/bridge'
import {
  buildVaultPayload, dbNameFor, newRecoveryCode, passKeyRaw, recoveryKeyRaw, unwrapDek, wrapDek, RECOVERY_ITER, type VaultPayload,
} from '../vault/keys'
import { createNewVaultDb, dbExists, markComplete, migrate, verifyMigration, REKEY_MARKER, type Progress } from '../vault/migrate'
import { mergeWrite, readRaw } from '../vault/middleware'
import { fromBase64, makeKeyCheck, toBase64, verifyKeyCheck } from '../backup/crypto'
import { storeBackupKey, writeSafetyBackup, type DerivedPassKey, type SafetyTarget } from '../backup/service'
import { GoogleApiError } from '../google/google'
import { blobIds } from '../notes/blobs'
import type { DriveStore, KeyFile } from './driveStore'
import { getSyncState, markBase, setSyncState, syncErrorCode, type SyncErrorCode } from './state'
import { syncOnce, STALE_MS, type SyncOnceParams, type SyncResult } from './syncOnce'
import { openWsync, type Snapshot } from './wsync'
import { SYNC_TABLES, syncableRow } from './tables'
import { dedupe, winner, type SyncRow } from './merge'
import { rowHash, syncKeyFrom } from './hash'

// ---------- 문구 ----------

export const NO_ROOT_TEXT = '다른 PC와 같은 구글 연결 설정(google-client.json)을 써야 드라이브 자료가 보입니다'
export const OLD_BACKUP_NOTICE = '이전 백업 파일은 이전 암호구로 열립니다'
export const KEY_CHANGED_TEXT = '다른 PC에서 백업 암호구를 바꿨습니다. 새 암호구를 입력하세요'
export const RECREATE_KEY_TEXT = '열쇠 파일이 없어졌습니다: 이 PC 열쇠로 다시 만들까요?'
export const REKEY_NEEDED_TEXT = '드라이브의 열쇠가 다른 PC에서 새로 만들어졌습니다. 동기화를 다시 켜세요'
export const RESTORE_SYNC_CONFIRM = '모든 PC에 이 백업 내용으로 되돌립니다'
export const WRONG_DRIVE_PASS = '드라이브 암호구가 맞지 않습니다'

export type EnableErrorCode =
  | 'wrong-pass' | 'wrong-drive-pass' | 'no-backup-key' | 'no-root-visible' | 'bad-key-file' | 'key-mismatch'
  | 'target-exists' | 'rekey-failed' | 'changed-during' | 'store-failed' | 'store-uncertain' | 'drive'

export const ENABLE_ERROR_TEXT: Record<EnableErrorCode, string> = {
  'wrong-pass': '이 PC의 백업 암호구가 맞지 않습니다',
  'wrong-drive-pass': WRONG_DRIVE_PASS,
  'no-backup-key': '먼저 이 PC에서 백업 암호구를 정하세요',
  'no-root-visible': NO_ROOT_TEXT,
  'bad-key-file': '드라이브의 열쇠 파일이 손상되었습니다',
  'key-mismatch': '드라이브 열쇠가 이 PC 열쇠와 맞지 않습니다',
  'target-exists': '이 PC에 같은 이름의 다른 자료가 있어 다시 암호화하지 않았습니다. 아무것도 바꾸지 않았습니다',
  'rekey-failed': '드라이브 열쇠로 다시 암호화하지 못했습니다. 이 PC 자료는 그대로입니다. 다시 시도하세요',
  'changed-during': '다시 암호화하는 동안 자료가 바뀌어 멈췄습니다. 이 PC 자료는 그대로입니다. 다시 시도하세요',
  'store-failed': '열쇠 파일을 저장하지 못했습니다. 이 PC 자료는 그대로입니다. 다시 시도하세요',
  'store-uncertain': '열쇠 파일을 저장했는지 알 수 없습니다. Watson을 다시 열어 확인하세요',
  drive: '구글 드라이브와 연결하지 못했습니다',
}

// ---------- 형 ----------

/** VaultGate가 주는 열쇠 보관 길(VaultSessionContext). status는 저장 결과가 불확실할 때 확인한다. */
export interface VaultAccess {
  current(): PublicVault
  store(p: VaultPayload): Promise<unknown>
  status?(): Promise<VaultStatus>
}

export interface Counts { classes: number; students: number; records: number; notes: number }
/** drive가 null이면 드라이브를 읽지 못했다(화면이 다시 부른다). */
export interface MergeCounts { local: Counts; drive: Counts | null }

export type EnableResult =
  | { kind: 'first-done'; sync?: SyncResult }
  | { kind: 'second-same-key'; counts: MergeCounts; passChanged: boolean; notice?: string }
  | { kind: 'second-rekeyed'; counts: MergeCounts; recoveryCode: string; dbName: string; keyId: string; oldDeleted: boolean; notice: string }
  | { kind: 'need-drive-pass' }
  | { kind: 'recreate-key' }
  | { kind: 'error'; code: EnableErrorCode; drive?: SyncErrorCode }

export interface EnableParams {
  db: AppDB
  dek: Uint8Array
  keyId: string
  vault: VaultAccess
  store: DriveStore
  deviceName: string
  /** 이 PC의 백업 암호구(첫 PC는 이것으로 열쇠 파일을 만든다) */
  passphrase: string
  /** 두 번째 PC: 드라이브 암호구(없으면 passphrase로 먼저 해 보고, 안 되면 need-drive-pass) */
  drivePass?: string
  /** 루트가 안 보이는데 이 PC가 동기화한 적이 있을 때, 새 드라이브 폴더를 만들기로 확인받았다 */
  confirmNewRoot?: boolean
  appVersion: string
  now?: () => Date
  onProgress?: (p: Progress) => void
  /** 다시 암호화 확인 표본 수(시험용) */
  samples?: number
}

type Err = Extract<EnableResult, { kind: 'error' }>
const err = (code: EnableErrorCode): Err => ({ kind: 'error', code })
const EVER = 'syncEverEnabled'
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const nowOf = (p: { now?: () => Date }) => (p.now ? p.now() : new Date())

// ---------- 열쇠 ----------

interface BackupKeyRawRow { salt: string; iter: number; raw: string; check: string }
async function backupRow(db: AppDB): Promise<BackupKeyRawRow | null> {
  const v = (await db.device_local.get('backupKeyRaw'))?.value as BackupKeyRawRow | undefined
  return v && typeof v.salt === 'string' && typeof v.raw === 'string' && Number.isInteger(v.iter) ? v : null
}
const importRaw = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

/**
 * 이 PC 암호구 확인: vault pass를 풀어 이 DEK가 나오고, 이 PC 백업 열쇠(backupKeyRaw)와도 맞아야 한다.
 * 돌려주는 passKey는 vault pass와 같은 salt·iter(그래야 열쇠 파일과 vault pass가 같은 암호구·같은 유도).
 */
async function verifyLocal(db: AppDB, vault: PublicVault, dek: Uint8Array, keyId: string, pass: string): Promise<DerivedPassKey | 'wrong-pass' | 'no-backup-key'> {
  const b = await backupRow(db)
  if (!b) return 'no-backup-key'
  const salt = fromBase64(vault.pass.salt)
  const raw = await passKeyRaw(pass, salt, vault.pass.iter)
  try { if (!eq(unwrapDek(vault.pass, raw, keyId, 'pass'), dek)) return 'wrong-pass' } catch { return 'wrong-pass' }
  if (b.salt === vault.pass.salt && b.iter === vault.pass.iter) {
    if (!eq(fromBase64(b.raw), raw)) return 'wrong-pass'
  } else if (!(await verifyKeyCheck(await importRaw(await passKeyRaw(pass, fromBase64(b.salt), b.iter)), b.check))) {
    return 'wrong-pass'
  }
  return { salt, iter: vault.pass.iter, raw }
}

async function keyFileFor(dek: Uint8Array, keyId: string, k: DerivedPassKey, at: Date): Promise<KeyFile> {
  const w = wrapDek(dek, k.raw, keyId, 'pass', k.salt, k.iter)
  return { v: 1, keyId, ...w, check: await makeKeyCheck(await importRaw(k.raw)), updatedAt: at.toISOString() }
}

async function openKeyFile(kf: KeyFile, pass: string): Promise<{ dek: Uint8Array; k: DerivedPassKey } | null> {
  const salt = fromBase64(kf.salt)
  if (salt.length !== 16) return null
  const raw = await passKeyRaw(pass, salt, kf.iter)
  try { return { dek: unwrapDek(kf, raw, kf.keyId, 'pass'), k: { salt, iter: kf.iter, raw } } } catch { return null }
}

/** 이 PC의 vault pass와 백업 열쇠가 이미 열쇠 파일과 같은 유도(salt·iter)인가. */
async function adopted(db: AppDB, vault: PublicVault, kf: KeyFile): Promise<boolean> {
  const b = await backupRow(db)
  return vault.pass.salt === kf.salt && vault.pass.iter === kf.iter && !!b && b.salt === kf.salt && b.iter === kf.iter
}

/** 열쇠 파일의 pass 감싸기(같은 keyId라 aad가 같다)를 이 PC vault pass로, 그 passKey를 백업 열쇠로. vault 먼저. */
async function adoptKeyFilePass(db: AppDB, dek: Uint8Array, keyId: string, vault: VaultAccess, kf: KeyFile, k: DerivedPassKey): Promise<void> {
  const cur = vault.current()
  const payload: VaultPayload = {
    v: 1, keyId, dbName: cur.dbName,
    pass: { salt: kf.salt, iter: kf.iter, iv: kf.iv, ct: kf.ct, updatedAt: new Date().toISOString() },
    ...(cur.recovery ? { recovery: cur.recovery } : {}),
    dekB64: toBase64(dek),
  }
  await vault.store(payload)
  await storeBackupKey(db, k)
}

// ---------- 드라이브 스냅숏·개수 ----------

export interface DriveSnap { deviceId: string; modifiedTime: string; snap: Snapshot }

/** 다른 기기(나·90일 넘은 기기 뺌)의 스냅숏을 받아 연다. 열지 못하는 것(다른 열쇠·손상·새 형식)은 건너뛴다. */
export async function driveSnapshots(p: { db: AppDB; dek: Uint8Array; keyId: string; store: Pick<DriveStore, 'listDevices' | 'downloadDevice'>; rootId: string; now?: () => Date }): Promise<DriveSnap[]> {
  const me = (await getSyncState(p.db)).deviceId
  const now = nowOf(p).getTime()
  const out: DriveSnap[] = []
  const seen = new Set<string>()
  const list = (await p.store.listDevices(p.rootId)).sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0))
  for (const e of list) {
    if (e.deviceId === me || seen.has(e.deviceId)) continue
    seen.add(e.deviceId)
    if (now - Date.parse(e.modifiedTime) > STALE_MS) continue
    try {
      out.push({ deviceId: e.deviceId, modifiedTime: e.modifiedTime, snap: await openWsync(await p.store.downloadDevice(e.fileId), p.dek, e.deviceId, p.keyId) })
    } catch (x) {
      if (x instanceof GoogleApiError && x.status !== 404) throw x
    }
  }
  return out
}

const COUNTED: Record<keyof Counts, string> = { classes: 'classes', students: 'students', records: 'counseling_logs', notes: 'notes' }
const valid = (r: SyncRow) => !!r && typeof r.id === 'string' && r.id !== '' && typeof r.updated_at === 'string'

/** 표마다 여러 스냅숏의 행을 id로 모아 이기는 쪽 하나씩(살아 있음 > 늦음 > …, merge.winner). */
function driveRows(snaps: Snapshot[], t: string): SyncRow[] {
  const m = new Map<string, SyncRow>()
  for (const s of snaps) {
    for (const r of (s.tables[t] ?? []) as SyncRow[]) {
      if (!valid(r) || !syncableRow(t, r as { source?: unknown })) continue
      const { data: _d, chunks: _c, _enc: _e, _broken: _b, ...v } = r as SyncRow & Record<string, unknown>
      void _d; void _c; void _e; void _b
      const cur = m.get(r.id)
      m.set(r.id, cur ? winner(cur, v as SyncRow) : (v as SyncRow))
    }
  }
  return [...m.values()]
}

/** 처음 합치기 화면의 양쪽 개수(학급·학생·누가기록·노트, 지움 표시 뺌). */
export async function firstMergeChoice(db: AppDB, snapshots: Snapshot[] | null): Promise<MergeCounts> {
  const local = {} as Counts
  const drive = {} as Counts
  for (const [k, t] of Object.entries(COUNTED) as [keyof Counts, string][]) {
    local[k] = ((await db.table(t).toArray()) as SyncRow[]).filter((r) => !r.deleted).length
    if (snapshots) drive[k] = driveRows(snapshots, t).filter((r) => !r.deleted).length
  }
  return { local, drive: snapshots ? drive : null }
}

async function countsFor(p: { db: AppDB; dek: Uint8Array; keyId: string; store: DriveStore; now?: () => Date }, rootId: string): Promise<MergeCounts> {
  let snaps: Snapshot[] | null = null
  try { snaps = (await driveSnapshots({ ...p, rootId })).map((s) => s.snap) } catch { snaps = null }
  return firstMergeChoice(p.db, snaps)
}

// ---------- 켜기 ----------

/**
 * 켜기. 첫 PC(보이는 루트 없음) → 루트·열쇠 파일·내 스냅숏. 두 번째 PC → 드라이브 암호구로 열쇠 파일을 풀고,
 * 같은 keyId면 그대로(second-same-key), 다르면 이 PC 자료를 드라이브 DEK로 다시 암호화(second-rekeyed).
 * 두 번째 PC는 sync state를 enabled·firstMergeDone:false로 남긴다: 처음 합치기(firstMerge)를 고를 때까지 자동 동기화하지 않는다(S7).
 */
export async function enableSync(p: EnableParams): Promise<EnableResult> {
  if (!p.db.isVault) throw new Error('SYNC_NEEDS_VAULT')
  try {
    const st = await getSyncState(p.db)
    const root = await p.store.findRoot()
    if (root) return await joinRoot(p, root.id)
    // drive.file은 이 앱(같은 OAuth 클라이언트)이 만든 것만 보인다: 동기화한 적 있는 PC가 루트를 못 보면 첫 PC로 만들지 않는다
    const ever = !!st.rootId || !!(await p.db.device_local.get(EVER))?.value || (st.devices ?? []).some((d) => !d.mine)
    if (ever && !p.confirmNewRoot) return err('no-root-visible')
    const k = await verifyLocal(p.db, p.vault.current(), p.dek, p.keyId, p.passphrase)
    if (typeof k === 'string') return err(k)
    const c = await p.store.createRoot()
    if (!c.created) return await joinRoot(p, c.id) // 첫 PC 경쟁에서 졌다 → 두 번째 PC 길
    return await becomeFirst(p, c.id, k)
  } catch (e) {
    return driveError(e)
  }
}

function driveError(e: unknown): Err {
  if (e instanceof GoogleApiError) return { kind: 'error', code: 'drive', drive: syncErrorCode(e) }
  if (e instanceof Error && e.message === 'BAD_KEY_FILE') return err('bad-key-file')
  throw e
}

async function markEver(db: AppDB): Promise<void> {
  await db.device_local.put({ id: EVER, value: true })
}

async function becomeFirst(p: EnableParams, rootId: string, k: DerivedPassKey): Promise<EnableResult> {
  const kf = await keyFileFor(p.dek, p.keyId, k, nowOf(p))
  try {
    await p.store.writeKeyFile(rootId, kf, { expectKeyId: null })
  } catch (e) {
    if (e instanceof Error && e.message === 'KEY_EXISTS') return joinRoot(p, rootId) // 그사이 다른 PC가 썼다
    throw e
  }
  // 동시에 두 PC가 쓴 경우: 가장 먼저 만든 열쇠 파일을 모두가 읽는다. 내 것이 아니면 두 번째 PC 길.
  const cur = await p.store.readKeyFile(rootId)
  if (!cur || cur.keyId !== kf.keyId || cur.updatedAt !== kf.updatedAt) return joinRoot(p, rootId)
  await markEver(p.db)
  await setSyncState(p.db, { enabled: true, rootId, deviceName: p.deviceName, keyUpdatedAt: kf.updatedAt, firstMergeDone: true, seen: {}, lastError: null, pendingUpload: true })
  let sync: SyncResult | undefined
  try { sync = await syncOnce(syncParams(p, p.db)) } catch { sync = undefined } // 올리기는 다음 동기화가 이어 한다(pendingUpload)
  return { kind: 'first-done', ...(sync ? { sync } : {}) }
}

const syncParams = (p: { dek: Uint8Array; keyId: string; store: DriveStore; deviceName: string; appVersion: string; now?: () => Date; safetyBackup?: () => Promise<void> }, db: AppDB): SyncOnceParams => ({
  db, dek: p.dek, keyId: p.keyId, store: p.store, now: p.now ?? (() => new Date()), deviceName: p.deviceName, appVersion: p.appVersion,
  ...(p.safetyBackup ? { safetyBackup: p.safetyBackup } : {}),
})

async function joinRoot(p: EnableParams, rootId: string): Promise<EnableResult> {
  const kf = await p.store.readKeyFile(rootId)
  if (!kf) {
    const me = (await getSyncState(p.db)).deviceId
    if ((await p.store.listDevices(rootId)).some((d) => d.deviceId !== me)) return { kind: 'recreate-key' }
    // 빈 루트(첫 PC가 열쇠 파일 전에 멈췄다): 첫 PC로
    const k = await verifyLocal(p.db, p.vault.current(), p.dek, p.keyId, p.passphrase)
    if (typeof k === 'string') return err(k)
    return becomeFirst(p, rootId, k)
  }
  const opened = await openKeyFile(kf, p.drivePass ?? p.passphrase)
  if (!opened) return p.drivePass !== undefined ? err('wrong-drive-pass') : { kind: 'need-drive-pass' }
  if (kf.keyId === p.keyId) {
    if (!eq(opened.dek, p.dek)) return err('key-mismatch')
    return joinSameKey(p, rootId, kf, opened.k)
  }
  return rekeyToDrive(p, rootId, kf, opened)
}

async function joinSameKey(p: EnableParams, rootId: string, kf: KeyFile, k: DerivedPassKey): Promise<EnableResult> {
  const st = await getSyncState(p.db)
  const passChanged = !(await adopted(p.db, p.vault.current(), kf))
  if (passChanged) await adoptKeyFilePass(p.db, p.dek, p.keyId, p.vault, kf, k)
  await markEver(p.db)
  const again = st.enabled && st.rootId === rootId
  await setSyncState(p.db, { enabled: true, rootId, deviceName: p.deviceName, keyUpdatedAt: kf.updatedAt, firstMergeDone: again ? st.firstMergeDone : false, ...(again ? {} : { seen: {} }), lastError: null })
  const counts = await countsFor(p, rootId)
  return { kind: 'second-same-key', counts, passChanged, ...(passChanged ? { notice: OLD_BACKUP_NOTICE } : {}) }
}

// ---------- 다시 암호화 ----------

/** 원시 행의 개수와 최대 updated_at(복호화 없음): 다시 암호화하는 사이 옛 DB가 바뀌었는지 본다. */
async function fingerprint(db: AppDB): Promise<string> {
  const parts: string[] = []
  for (const t of [...SYNC_TABLES, 'device_local']) {
    let max = ''
    const rows = await readRaw(db, t)
    for (const r of rows) if (typeof r.updated_at === 'string' && r.updated_at > max) max = r.updated_at
    parts.push(`${t}:${rows.length}:${max}`)
  }
  parts.push(`note_blobs:${await db.note_blobs.count()}`)
  return parts.join('|')
}

/**
 * 새 DB 이름에 이미 DB가 있으면: 이 DB(from)에서 다시 암호화하다 남은 것(rekey 표시)이고 vault가 그것을 가리키지 않을 때만 지운다.
 * 그 밖(표시 없음·다른 from·vault가 가리킴·확인 불가)은 건드리지 않는다.
 */
async function clearLeftover(target: string, from: string, vault: VaultAccess): Promise<'clear' | EnableErrorCode> {
  if (!(await dbExists(target))) return 'clear'
  let pointed: string | null
  try { pointed = vault.status ? ((await vault.status()).vault?.dbName ?? null) : vault.current().dbName } catch { return 'store-uncertain' }
  if (pointed === target) return 'store-uncertain' // 저장이 실제로 됐다: 앱을 다시 열어야 한다
  const d = new Dexie(target)
  let mine = false
  try {
    await d.open()
    if (d.tables.some((t) => t.name === 'meta')) {
      const m = (await d.table('meta').get(REKEY_MARKER)) as Record<string, unknown> | undefined
      mine = m?.from === from
    }
  } catch { mine = false } finally { d.close() }
  if (!mine) return 'target-exists'
  await Dexie.delete(target)
  return 'clear'
}

/**
 * 이 PC 자료를 드라이브 DEK로 다시 암호화(옮기기 마법사와 같은 순서, Review Focus 4).
 *  1. 새 DB(dbNameFor(드라이브 keyId)) + rekey 표시 → 2. vault→vault 복사 → 3. 확인 → 4. 완료 행
 *  → 5. 옛 DB가 그사이 바뀌지 않았는지 → 6. vault.store(pass = 드라이브 암호구, recovery = 새 복구 코드)
 *  → 7. 새 DB에 sync state → 8. 옛 DB 닫고 지우기 → rekey 표시 지우기.
 * 6 전에 실패하면 새 DB만 지운다(옛 vault·옛 DB 그대로). 6이 불확실하면 둘 다 남긴다(다음 열 때 finishRekey 또는 다음 켜기가 정리).
 */
async function rekeyToDrive(p: EnableParams, rootId: string, kf: KeyFile, opened: { dek: Uint8Array; k: DerivedPassKey }): Promise<EnableResult> {
  const db = p.db
  const oldName = db.name
  const target = dbNameFor(kf.keyId)
  if (target === oldName) return err('target-exists')
  const left = await clearLeftover(target, oldName, p.vault)
  if (left !== 'clear') return err(left)

  const before = await fingerprint(db)
  let newDb: AppDB | null = null
  let payload: VaultPayload
  let recoveryCode: string
  let changed = false
  try {
    newDb = await createNewVaultDb(opened.dek, kf.keyId)
    await newDb.meta.put({ id: REKEY_MARKER, from: oldName, stage: 'copy', at: new Date().toISOString() })
    await migrate({ oldDb: db, newDb, passKey: opened.k, fromVault: true, onProgress: p.onProgress })
    const v = await verifyMigration(db, newDb, p.samples)
    if (!v.ok) throw new Error('verify')
    await markComplete(newDb, opened.dek, kf.keyId)
    if ((await fingerprint(db)) !== before) { changed = true; throw new Error('changed') }
    recoveryCode = newRecoveryCode()
    const recSalt = crypto.getRandomValues(new Uint8Array(16))
    payload = buildVaultPayload({
      keyId: kf.keyId, dek: opened.dek, passRaw: opened.k.raw, passSalt: opened.k.salt, passIter: opened.k.iter,
      recoveryRaw: await recoveryKeyRaw(recoveryCode, recSalt, RECOVERY_ITER), recoverySalt: recSalt, recoveryIter: RECOVERY_ITER,
    })
  } catch {
    try { newDb?.close() } catch { /* ignore */ }
    try { await Dexie.delete(target) } catch { /* 남으면 다음 켜기가 rekey 표시로 지운다 */ }
    return err(changed ? 'changed-during' : 'rekey-failed')
  }

  try {
    await p.vault.store(payload)
  } catch {
    let st: VaultStatus | null = null
    try { st = p.vault.status ? await p.vault.status() : null } catch { st = null }
    if (!(st?.vault?.keyId === kf.keyId && st.vault.dbName === target)) {
      newDb.close()
      if (st?.vault && st.vault.keyId === p.keyId) {
        try { await Dexie.delete(target) } catch { /* 다음 켜기가 지운다 */ }
        return err('store-failed')
      }
      return err('store-uncertain') // 두 DB 다 남긴다: 화면은 곧바로 VaultGate를 다시 열어야 한다
    }
  }

  // 여기부터 vault.json은 새 DB를 가리킨다.
  await markEver(newDb)
  await setSyncState(newDb, { enabled: true, rootId, deviceName: p.deviceName, keyUpdatedAt: kf.updatedAt, firstMergeDone: false, seen: {}, lastError: null })
  await newDb.meta.put({ id: REKEY_MARKER, from: oldName, stage: 'delete-old', at: new Date().toISOString() })
  db.close()
  let oldDeleted = false
  try {
    await Dexie.delete(oldName)
    oldDeleted = true
    await newDb.meta.delete(REKEY_MARKER)
  } catch { /* finishRekey(앱을 열 때)가 마저 한다 */ }
  const counts = await countsFor({ ...p, db: newDb, dek: opened.dek, keyId: kf.keyId }, rootId)
  newDb.close()
  return { kind: 'second-rekeyed', counts, recoveryCode, dbName: target, keyId: kf.keyId, oldDeleted, notice: OLD_BACKUP_NOTICE }
}

/** 열쇠 파일이 없어졌을 때(기기 파일은 있음) 화면이 확인받은 뒤: 이 PC 열쇠로 열쇠 파일을 다시 만들고 두 번째 PC처럼 처음 합치기로. */
export async function recreateKeyFile(p: EnableParams): Promise<EnableResult> {
  try {
    const root = await p.store.findRoot()
    if (!root) return err('no-root-visible')
    const k = await verifyLocal(p.db, p.vault.current(), p.dek, p.keyId, p.passphrase)
    if (typeof k === 'string') return err(k)
    const kf = await keyFileFor(p.dek, p.keyId, k, nowOf(p))
    try {
      await p.store.writeKeyFile(root.id, kf, { expectKeyId: null })
    } catch (e) {
      if (e instanceof Error && e.message === 'KEY_EXISTS') return joinRoot(p, root.id)
      throw e
    }
    return await joinSameKey(p, root.id, kf, k)
  } catch (e) {
    return driveError(e)
  }
}

// ---------- 처음 합치기 ----------

export interface FirstMergeParams {
  db: AppDB
  dek: Uint8Array
  keyId: string
  store: DriveStore
  deviceName: string
  appVersion: string
  now?: () => Date
  /** replace: 안전 백업할 곳(필수). merge: 하루 한 번 합치기 전 안전 백업(선택). */
  safety?: SafetyTarget
  safetyBackup?: () => Promise<void>
}

/** 처음 합치기: 'merge'는 보통 syncOnce(행 단위로 합친다), 'replace'는 replaceWithDrive. 성공하면 firstMergeDone. */
export async function firstMerge(p: FirstMergeParams & { choice: 'replace' | 'merge' }): Promise<SyncResult> {
  if (p.choice === 'replace') return replaceWithDrive(p)
  const res = await syncOnce(syncParams(p, p.db))
  if (res.ok) await setSyncState(p.db, { firstMergeDone: true })
  return res
}

const viewOf = (t: string, r: Record<string, unknown>): SyncRow => {
  const { _enc: _e, _broken: _b, ...rest } = r
  void _e; void _b
  if (t !== 'note_files') return rest as SyncRow
  const { data: _d, chunks: _c, ...meta } = rest
  void _d; void _c
  return meta as SyncRow
}

/**
 * 드라이브 자료로 바꾸기(처음 합치기 'replace', 오래 쉰 PC의 stale-self 길): 안전 백업 → 하나의 병합 묶음에서
 * 동기화 표(이 PC 전용 행 빼고)를 비우고 드라이브 것(기기들의 이긴 값 + 겹침 정리)으로 채움, base를 그 값으로 →
 * 내 스냅숏을 올린다(syncOnce). 드라이브에 열 수 있는 기기 자료가 없으면 아무것도 바꾸지 않는다.
 */
export async function replaceWithDrive(p: FirstMergeParams): Promise<SyncResult> {
  const { db, dek, keyId, store } = p
  if (!db.isVault) throw new Error('SYNC_NEEDS_VAULT')
  const st = await getSyncState(db)
  if (!st.enabled || !st.rootId) throw new Error('SYNC_NOT_ENABLED')
  const rr = await store.resolveRoot(st.rootId)
  const root = rr.rootId
  const snaps = await driveSnapshots({ db, dek, keyId, store, rootId: root, now: p.now })
  if (!snaps.length) throw new Error('드라이브에 바꿀 자료가 없습니다.')
  const at = nowOf(p)
  await writeSafetyBackup(db, p.safety, at) // 자료가 있는데 백업할 곳이 없으면 여기서 멈춘다(아무것도 안 바뀜)

  const key = syncKeyFrom(dek)
  const plan = new Map<string, { keep: SyncRow[]; gone: SyncRow[] }>()
  for (const t of SYNC_TABLES) {
    const rows = driveRows(snaps.map((s) => s.snap), t)
    const { keep, hardDelete } = dedupe(t, rows)
    const byId = new Map(rows.map((r) => [r.id, r]))
    plan.set(t, { keep, gone: hardDelete.map((id) => byId.get(id)!) })
  }
  const seen: Record<string, string> = {}
  for (const s of snaps) seen[s.deviceId] = s.modifiedTime

  await mergeWrite(db, [...SYNC_TABLES.map((t) => db.table(t)), db.sync_rows, db.note_blobs, db.meta], async () => {
    await db.sync_rows.clear()
    for (const t of SYNC_TABLES) {
      const tbl = db.table(t)
      const { keep, gone } = plan.get(t)!
      const local = (await tbl.toArray()) as Record<string, unknown>[]
      const lmap = new Map(local.map((r) => [String(r.id), r]))
      const fixed = new Set(local.filter((r) => !syncableRow(t, r)).map((r) => String(r.id))) // 이 PC 전용 행은 그대로
      const kmap = new Map(keep.map((r) => [r.id, r]))
      const drop: string[] = []
      const puts: Record<string, unknown>[] = []
      for (const r of local) if (!fixed.has(String(r.id))) drop.push(String(r.id))
      const blobDrops: string[] = []
      if (t === 'note_files') {
        for (const r of local) {
          const d = kmap.get(String(r.id))
          const reuse = d && !d.deleted && !r.deleted && r.size === d.size
          if (!reuse) blobDrops.push(...blobIds(r as unknown as NoteFileRec))
        }
      }
      for (const v of keep) {
        if (fixed.has(v.id)) continue
        const row: Record<string, unknown> = { ...v }
        const lr = lmap.get(v.id)
        if (t === 'note_files' && lr && !lr.deleted && !v.deleted && lr.size === v.size) {
          if (lr.data !== undefined) row.data = lr.data
          if (lr.chunks !== undefined) row.chunks = lr.chunks
        }
        puts.push(row)
      }
      if (blobDrops.length) await db.note_blobs.bulkDelete(blobDrops)
      if (drop.length) await tbl.bulkDelete(drop)
      if (puts.length) await tbl.bulkPut(puts)
      const marks = [...keep, ...gone].filter((r) => !fixed.has(r.id)).map((r) => ({ table: t, id: r.id, hash: rowHash(key, viewOf(t, r)), at: r.updated_at, src: 'merge' as const }))
      if (marks.length) await markBase(db, marks)
    }
    const cur = (await db.meta.get('sync')) ?? { id: 'sync' }
    await db.meta.put({ ...cur, id: 'sync', rootId: root, firstMergeDone: true, seen, pendingUpload: true, lastOk: at.toISOString(), lastError: null })
  })
  return syncOnce(syncParams(p, db))
}

// ---------- 열쇠 바뀜(§7.7) ----------

export interface KeyChange {
  /** 다른 PC가 암호구를 바꿨다: KEY_CHANGED_TEXT 띠 → applyNewPass */
  needPass: boolean
  /** 드라이브 열쇠 파일이 없다(RECREATE_KEY_TEXT) */
  missing?: boolean
  /** 드라이브 열쇠(keyId)가 이 PC와 다르다: 동기화를 다시 켜야 한다(REKEY_NEEDED_TEXT) */
  rekey?: boolean
}

/**
 * 열쇠 파일의 updatedAt이 마지막으로 맞춘 값(state.keyUpdatedAt)과 다르면 needPass. 다만 이 PC의 vault pass와 백업 열쇠가
 * 이미 그 열쇠 파일과 같은 유도(salt·iter)면(이 PC가 바꾼 것) keyUpdatedAt만 맞추고 묻지 않는다.
 */
export async function checkKeyChange(p: { db: AppDB; store: Pick<DriveStore, 'readKeyFile'>; keyId: string; vault: PublicVault }): Promise<KeyChange> {
  const st = await getSyncState(p.db)
  if (!st.enabled || !st.rootId) return { needPass: false }
  const kf = await p.store.readKeyFile(st.rootId)
  if (!kf) return { needPass: false, missing: true }
  if (kf.keyId !== p.keyId) return { needPass: false, rekey: true }
  if (kf.updatedAt === st.keyUpdatedAt) return { needPass: false }
  if (await adopted(p.db, p.vault, kf)) {
    await setSyncState(p.db, { keyUpdatedAt: kf.updatedAt })
    return { needPass: false }
  }
  return { needPass: true }
}

/** 새 드라이브 암호구: 열쇠 파일로 확인한 뒤 vault pass(열쇠 파일과 같은 감싸기)와 backupKeyRaw를 바꾼다. 틀리면 WRONG_DRIVE_PASS. */
export async function applyNewPass(p: { db: AppDB; store: Pick<DriveStore, 'readKeyFile'>; dek: Uint8Array; keyId: string; vault: VaultAccess; pass: string }): Promise<{ notice: string }> {
  const st = await getSyncState(p.db)
  if (!st.enabled || !st.rootId) throw new Error('SYNC_NOT_ENABLED')
  const kf = await p.store.readKeyFile(st.rootId)
  if (!kf) throw new Error(RECREATE_KEY_TEXT)
  if (kf.keyId !== p.keyId) throw new Error(REKEY_NEEDED_TEXT)
  const opened = await openKeyFile(kf, p.pass)
  if (!opened || !eq(opened.dek, p.dek)) throw new Error(WRONG_DRIVE_PASS)
  await adoptKeyFilePass(p.db, p.dek, p.keyId, p.vault, kf, opened.k)
  await setSyncState(p.db, { keyUpdatedAt: kf.updatedAt })
  return { notice: OLD_BACKUP_NOTICE }
}

/**
 * 이 PC에서 암호구를 바꿀 때(VaultRewrapContext의 rewrap 안, vault.store보다 먼저): 동기화가 켜져 있으면 열쇠 파일을 새 passKey로 바꾼다
 * (expectKeyId: 다른 열쇠로 바뀐 열쇠 파일은 덮지 않는다). 꺼져 있으면 null. 실패하면 던진다 → 암호구 바꾸기 전체가 멈춘다(아무것도 안 바뀜).
 * keyUpdatedAt은 여기서 바꾸지 않는다: vault.store·backupKeyRaw까지 끝나면 다음 checkKeyChange가 맞춘다(중간에 실패하면 묻는다).
 */
export async function rewrapKeyFile(p: { db: AppDB; store: Pick<DriveStore, 'writeKeyFile'>; dek: Uint8Array; keyId: string; k: DerivedPassKey; now?: () => Date }): Promise<string | null> {
  const st = await getSyncState(p.db)
  if (!st.enabled || !st.rootId) return null
  const kf = await keyFileFor(p.dek, p.keyId, p.k, nowOf(p))
  try {
    await p.store.writeKeyFile(st.rootId, kf, { expectKeyId: p.keyId })
  } catch (e) {
    if (e instanceof Error && e.message === 'KEY_EXISTS') throw new Error(REKEY_NEEDED_TEXT)
    throw e
  }
  return kf.updatedAt
}

// ---------- 끊기·기기 빼기 ----------

/** 이 기기의 .wsync를 지우고 meta 'sync'와 sync_rows를 비운다(자료는 남음). 드라이브에서 못 지웠으면 remoteDeleted:false. */
export async function disconnect(p: { db: AppDB; store: Pick<DriveStore, 'listDevices' | 'deleteDevice'> }): Promise<{ remoteDeleted: boolean }> {
  const st = await getSyncState(p.db)
  let remoteDeleted = true
  if (st.rootId) {
    try {
      for (const d of await p.store.listDevices(st.rootId)) if (d.deviceId === st.deviceId) await p.store.deleteDevice(d.fileId)
    } catch { remoteDeleted = false }
  }
  await p.db.transaction('rw', p.db.meta, p.db.sync_rows, async () => {
    await p.db.meta.delete('sync')
    await p.db.sync_rows.clear()
  })
  return { remoteDeleted }
}

/** 다른 기기(잃어버린 PC)의 .wsync만 지운다. 이 기기는 disconnect로. 지운 파일 수. */
export async function removeDevice(p: { db: AppDB; store: Pick<DriveStore, 'listDevices' | 'deleteDevice'>; deviceId: string }): Promise<number> {
  const st = await getSyncState(p.db)
  if (p.deviceId === st.deviceId) throw new Error('이 기기는 “이 기기 연결 끊기”로 빼세요.')
  if (!st.enabled || !st.rootId) throw new Error('SYNC_NOT_ENABLED')
  const files = (await p.store.listDevices(st.rootId)).filter((d) => d.deviceId === p.deviceId)
  for (const f of files) await p.store.deleteDevice(f.fileId)
  const seen = { ...st.seen }
  delete seen[p.deviceId]
  await setSyncState(p.db, { devices: (st.devices ?? []).filter((d) => d.deviceId !== p.deviceId), seen })
  return files.length
}
