import type { AppDB } from '../db/schema'
import type { BackupFolder, FolderState, FsAdapter } from './adapter'

const HANDLE_ID = 'backupFolder'

function wrap(dir: FileSystemDirectoryHandle): BackupFolder {
  return {
    name: dir.name,
    async writeFile(name, bytes) {
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(bytes)
      await w.close()
    },
    async readFile(name) {
      const fh = await dir.getFileHandle(name)
      return new Uint8Array(await (await fh.getFile()).arrayBuffer())
    },
    async listFiles() {
      const names: string[] = []
      for await (const [n, h] of dir.entries()) if (h.kind === 'file') names.push(n)
      return names
    },
    async deleteFile(name) {
      await dir.removeEntry(name)
    },
  }
}

/** 크롬의 File System Access API를 쓰는 어댑터. 폴더 핸들은 device_local에 저장한다. */
export function createWebFsAdapter(db: AppDB): FsAdapter {
  const supported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

  async function savedHandle(): Promise<FileSystemDirectoryHandle | null> {
    const rec = await db.device_local.get(HANDLE_ID)
    return (rec?.value as FileSystemDirectoryHandle | undefined) ?? null
  }

  return {
    isFolderSupported: supported,
    async pickFolder() {
      if (!supported()) return null
      try {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
        await db.device_local.put({ id: HANDLE_ID, value: dir })
        return wrap(dir)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null
        throw e
      }
    },
    async restoreFolder(): Promise<FolderState> {
      const dir = await savedHandle()
      if (!dir) return { status: 'none' }
      const p = await dir.queryPermission({ mode: 'readwrite' })
      return p === 'granted' ? { status: 'ready', folder: wrap(dir) } : { status: 'needs-permission' }
    },
    async requestPermission() {
      const dir = await savedHandle()
      if (!dir) return null
      const p = await dir.requestPermission({ mode: 'readwrite' })
      return p === 'granted' ? wrap(dir) : null
    },
    downloadFile(name, bytes) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    pickFileToRead(accept = '.enc', opts = {}) {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = accept
        // 문서에 붙여 두고 누른다(떨어진 입력 칸은 일부 브라우저·자동 시험에서 change가 안 온다)
        input.style.display = 'none'
        document.body.appendChild(input)
        const done = () => input.remove()
        input.onchange = async () => {
          done()
          const file = input.files?.[0]
          if (!file) return resolve(null)
          // 너무 큰 파일은 읽지 않는다(메모리에 다 올리기 전에 알림).
          if (opts.maxBytes != null && file.size > opts.maxBytes) return resolve({ name: file.name, bytes: new Uint8Array(0), tooBig: true })
          resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
        }
        input.oncancel = () => (done(), resolve(null))
        input.click()
      })
    },
  }
}
