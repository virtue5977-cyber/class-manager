import type { AppDB } from '../lib/db/schema'
import type { FsAdapter } from '../lib/fs/adapter'
import { getCachedKey, getLastBackupAt, needsAutoBackup, runBackup } from '../lib/backup/service'

export type StartupStatus = 'done' | 'not-due' | 'needs-setup' | 'needs-folder' | 'needs-permission' | 'failed'

async function requestPersistence(): Promise<boolean> {
  try {
    return (await globalThis.navigator?.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** 앱 시작 때 저장소 영구 보관을 요청하고, 기한이 지났으면 자동 백업한다. */
export async function runStartup(
  db: AppDB,
  fs: FsAdapter,
  now: Date = new Date(),
): Promise<{ backup: StartupStatus; error?: string; persisted: boolean }> {
  const persisted = await requestPersistence()
  return { ...(await runAutoBackup(db, fs, now)), persisted }
}

let queue: Promise<unknown> = Promise.resolve()

/** 기한이 지났으면 자동 백업(켤 때·켜 둔 동안 1시간마다·창이 다시 보일 때). 한 번에 하나씩만 돈다. */
export function runAutoBackup(db: AppDB, fs: FsAdapter, now: Date = new Date()): Promise<{ backup: StartupStatus; error?: string }> {
  const run = queue.then(async (): Promise<{ backup: StartupStatus; error?: string }> => {
    try {
      if (!(await getCachedKey(db))) return { backup: 'needs-setup' }
      if (!needsAutoBackup(await getLastBackupAt(db), now)) return { backup: 'not-due' }
      const state = await fs.restoreFolder()
      if (state.status === 'none') return { backup: 'needs-folder' }
      if (state.status === 'needs-permission') return { backup: 'needs-permission' }
      await runBackup(db, state.folder, { now })
      return { backup: 'done' }
    } catch (e) {
      return { backup: 'failed', error: e instanceof Error ? e.message : String(e) }
    }
  })
  queue = run.catch(() => {})
  return run
}

export type BackupHealth = 'ok' | 'needs-setup' | 'needs-folder' | 'needs-permission'

/** 백업을 실행하지 않고 지금 설정 상태만 확인한다(배너 갱신용). */
export async function checkBackupStatus(db: AppDB, fs: FsAdapter): Promise<BackupHealth> {
  if (!(await getCachedKey(db))) return 'needs-setup'
  const state = await fs.restoreFolder()
  if (state.status === 'none') return 'needs-folder'
  if (state.status === 'needs-permission') return 'needs-permission'
  return 'ok'
}
