import type { BackupFolder, FolderState, FsAdapter } from './adapter'

export type MemoryFolder = BackupFolder & { files: Map<string, Uint8Array> }

export function createMemoryFolder(name = '메모리 폴더'): MemoryFolder {
  const files = new Map<string, Uint8Array>()
  return {
    name,
    files,
    async writeFile(n, bytes) {
      files.set(n, bytes.slice())
    },
    async readFile(n) {
      const b = files.get(n)
      if (!b) throw new Error(`파일이 없습니다: ${n}`)
      return b.slice()
    },
    async listFiles() {
      return [...files.keys()]
    },
    async deleteFile(n) {
      files.delete(n)
    },
  }
}

export type MemoryFsAdapter = FsAdapter & {
  /** 다음 pickFileToRead가 돌려줄 파일(테스트용). */
  nextFileToRead: { name: string; bytes: Uint8Array } | null
  downloads: { name: string; bytes: Uint8Array }[]
  /** true면 restoreFolder가 needs-permission을 돌려준다. */
  permissionRevoked: boolean
}

/** 테스트용 어댑터. folder를 주면 이미 지정된 상태로 시작한다. */
export function createMemoryFsAdapter(folder?: BackupFolder): MemoryFsAdapter {
  let current: BackupFolder | null = folder ?? null
  const adapter: MemoryFsAdapter = {
    nextFileToRead: null,
    downloads: [],
    permissionRevoked: false,
    isFolderSupported: () => true,
    async pickFolder() {
      current = current ?? createMemoryFolder()
      adapter.permissionRevoked = false
      return current
    },
    async restoreFolder(): Promise<FolderState> {
      if (!current) return { status: 'none' }
      if (adapter.permissionRevoked) return { status: 'needs-permission' }
      return { status: 'ready', folder: current }
    },
    async requestPermission() {
      if (!current) return null
      adapter.permissionRevoked = false
      return current
    },
    downloadFile(name, bytes) {
      adapter.downloads.push({ name, bytes })
    },
    async pickFileToRead() {
      const f = adapter.nextFileToRead
      adapter.nextFileToRead = null
      return f
    },
  }
  return adapter
}
