import type { AppDB } from '../db/schema'
import type { BackupFolder } from '../fs/adapter'
import { decrypt, deriveKey, encrypt, makeKeyCheck, PBKDF2_ITERATIONS, randomBytes } from './crypto'
import { decodeBackupFile, encodeBackupFile, encodeHeader, type BackupHeader } from './format'
import { exportSnapshot, importSnapshot, parseSnapshot, serializeSnapshot, validateSnapshot } from './snapshot'
import { SYNCED_TABLES } from '../db/schema'

export const BACKUP_KEEP_DEFAULT = 14
export const AUTO_BACKUP_INTERVAL_MS = 86_400_000
export const BACKUP_FILE_RE = /^백업_(\d{8})_(\d{4})(?:_(\d+))?\.enc$/
export const APP_SETTINGS_ID = 'app'
/** 복원 직전 안전 백업 파일 접두어. 보관 정리 대상이 아니다. */
export const SAFETY_FILE_PREFIX = '복원전_'
const MIN_PASSPHRASE = 8

export interface CachedKey {
  key: CryptoKey
  salt: Uint8Array
  iterations: number
  check: string
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function backupFileName(now: Date, existing: Set<string>, prefix = '백업_'): string {
  const stem = `${prefix}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
  let name = `${stem}.enc`
  for (let i = 2; existing.has(name); i++) name = `${stem}_${i}.enc`
  return name
}

export async function setupPassphrase(db: AppDB, passphrase: string, opts: { iterations?: number } = {}): Promise<void> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error('암호구는 8자 이상이어야 합니다.')
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS
  const salt = randomBytes(16)
  const key = await deriveKey(passphrase, salt, iterations)
  const cached: CachedKey = { key, salt, iterations, check: await makeKeyCheck(key) }
  await db.device_local.put({ id: 'backupKey', value: cached })
}

export async function getCachedKey(db: AppDB): Promise<CachedKey | null> {
  return ((await db.device_local.get('backupKey'))?.value as CachedKey | undefined) ?? null
}

export async function getLastBackupAt(db: AppDB): Promise<string | undefined> {
  return (await db.device_local.get('lastBackupAt'))?.value as string | undefined
}

/** 날짜·시각·번호(없으면 1) 순 정렬 키. */
function sortKey(name: string): [string, number] | null {
  const m = BACKUP_FILE_RE.exec(name)
  if (!m) return null
  return [`${m[1]}${m[2]}`, m[3] ? Number(m[3]) : 1]
}

/**
 * 보관 정리: 가장 최근 날짜(오늘)의 백업은 모두 남기고, 지난 날은 날마다 마지막 하나만 남긴다.
 * 그렇게 남은 것 중 최근 keep일치만 둔다(하루에 여러 번 눌러도 지난 날 백업이 밀려나지 않게).
 */
export async function rotateBackups(folder: BackupFolder, keep: number): Promise<string[]> {
  const backups = (await folder.listFiles())
    .map((n) => ({ n, k: sortKey(n) }))
    .filter((x): x is { n: string; k: [string, number] } => x.k !== null)
    .sort((a, b) => (a.k[0] === b.k[0] ? a.k[1] - b.k[1] : a.k[0] < b.k[0] ? -1 : 1))
  const safeKeep = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : BACKUP_KEEP_DEFAULT
  const day = (x: { k: [string, number] }) => x.k[0].slice(0, 8)
  const days = [...new Set(backups.map(day))]
  const newest = days.at(-1)
  const keptDays = new Set(days.slice(-safeKeep))
  const lastOfDay = new Map<string, string>()
  for (const x of backups) lastOfDay.set(day(x), x.n)
  const remove = backups.filter((x) => !keptDays.has(day(x)) || (day(x) !== newest && lastOfDay.get(day(x)) !== x.n)).map((x) => x.n)
  for (const n of remove) await folder.deleteFile(n)
  return remove
}

async function buildBackupFile(db: AppDB, cached: CachedKey, now: Date): Promise<Uint8Array> {
  const header: BackupHeader = { formatVersion: 1, iterations: cached.iterations, salt: cached.salt }
  const data = serializeSnapshot(await exportSnapshot(db, now))
  const { iv, ciphertext } = await encrypt(cached.key, data, encodeHeader(header))
  return encodeBackupFile(header, iv, ciphertext)
}

export async function runBackup(db: AppDB, folder: BackupFolder, opts: { now?: Date; keep?: number } = {}): Promise<string> {
  const cached = await getCachedKey(db)
  if (!cached) throw new Error('백업 암호구가 설정되지 않았습니다.')
  const now = opts.now ?? new Date()
  const file = await buildBackupFile(db, cached, now)
  const name = backupFileName(now, new Set(await folder.listFiles()))
  await folder.writeFile(name, file)
  const keep = opts.keep ?? (await db.app_settings.get(APP_SETTINGS_ID))?.backup_keep_count ?? BACKUP_KEEP_DEFAULT
  await rotateBackups(folder, keep)
  await db.device_local.put({ id: 'lastBackupAt', value: now.toISOString() })
  return name
}

export interface SafetyTarget {
  folder?: BackupFolder
  download?: (name: string, bytes: Uint8Array) => void
}

async function hasAnyData(db: AppDB): Promise<boolean> {
  for (const t of SYNCED_TABLES) if ((await db.syncedTable(t).count()) > 0) return true
  return false
}

/** 복원 직전 현재 상태를 복원전_ 파일로 남긴다. 보관 정리하지 않는다. */
async function writeSafetyBackup(db: AppDB, target: SafetyTarget | undefined, now: Date): Promise<void> {
  if (!(await hasAnyData(db))) return
  const cached = await getCachedKey(db)
  if (!cached) throw new Error('현재 데이터를 보호하는 백업을 만들 수 없습니다. 먼저 이 기기에서 백업 암호구를 설정하세요.')
  if (!target?.folder && !target?.download) {
    throw new Error('복원 전에 현재 데이터를 백업할 곳이 없습니다. 백업 폴더를 지정하거나 내려받기를 허용하세요.')
  }
  const file = await buildBackupFile(db, cached, now)
  if (target.folder) {
    const name = backupFileName(now, new Set(await target.folder.listFiles()), SAFETY_FILE_PREFIX)
    await target.folder.writeFile(name, file)
  } else {
    target.download!(backupFileName(now, new Set(), SAFETY_FILE_PREFIX), file)
  }
}

/**
 * 순서: 파일 형식 → 복호화 → 스냅샷 검증(버전·레코드) → 안전 백업 → 가져오기.
 * 검증에 실패하면 폴더와 데이터 어느 것도 바뀌지 않는다.
 */
export async function restoreFromBytes(
  db: AppDB,
  bytes: Uint8Array,
  passphrase: string,
  opts: { safety?: SafetyTarget; now?: Date } = {},
): Promise<void> {
  const { header, headerBytes, iv, ciphertext } = decodeBackupFile(bytes)
  const key = await deriveKey(passphrase, header.salt, header.iterations)
  const snapshot = validateSnapshot(parseSnapshot(await decrypt(key, iv, ciphertext, headerBytes)))
  await writeSafetyBackup(db, opts.safety, opts.now ?? new Date())
  await importSnapshot(db, snapshot)
}

export function needsAutoBackup(lastBackupAt: string | undefined, now: Date): boolean {
  if (!lastBackupAt) return true
  const last = Date.parse(lastBackupAt)
  if (Number.isNaN(last) || last > now.getTime()) return true
  return now.getTime() - last >= AUTO_BACKUP_INTERVAL_MS
}
