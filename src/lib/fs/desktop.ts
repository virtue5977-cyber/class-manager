import type { AppDB } from '../db/schema'
import type { BackupFolder, FsAdapter } from './adapter'
import { createWebFsAdapter } from './web'

/** exe(Electron)의 preload가 넣어 주는 백업 폴더 기능. 폴더 경로는 메인 프로세스가 기억한다. */
export interface DesktopBackupApi {
  pick(): Promise<string | null>
  /** 고른 폴더(없으면 null, 폴더가 사라졌으면 {missing}) */
  current(): Promise<string | { missing: string } | null>
  write(name: string, bytes: Uint8Array): Promise<void>
  read(name: string): Promise<Uint8Array>
  list(): Promise<string[]>
  delete(name: string): Promise<void>
}

function wrap(api: DesktopBackupApi, dir: string): BackupFolder {
  return {
    name: dir,
    writeFile: (n, b) => api.write(n, b),
    readFile: (n) => api.read(n),
    listFiles: () => api.list(),
    deleteFile: (n) => api.delete(n),
  }
}

/** exe에서는 백업 폴더를 실제 경로로 기억해, 다시 열 때 권한을 묻지 않는다. 내려받기·파일 열기는 웹과 같다. */
export function createDesktopFsAdapter(db: AppDB, api: DesktopBackupApi): FsAdapter {
  const web = createWebFsAdapter(db)
  return {
    ...web,
    isFolderSupported: () => true,
    async pickFolder() {
      const dir = await api.pick()
      return dir ? wrap(api, dir) : null
    },
    async restoreFolder() {
      const cur = await api.current()
      if (!cur) return { status: 'none' }
      return typeof cur === 'string' ? { status: 'ready', folder: wrap(api, cur) } : { status: 'needs-permission' }
    },
    async requestPermission() {
      const cur = await api.current()
      return typeof cur === 'string' ? wrap(api, cur) : null
    },
  }
}
