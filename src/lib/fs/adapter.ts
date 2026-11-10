export interface BackupFolder {
  name: string
  writeFile(name: string, bytes: Uint8Array): Promise<void>
  readFile(name: string): Promise<Uint8Array>
  listFiles(): Promise<string[]>
  deleteFile(name: string): Promise<void>
}

export type FolderState =
  | { status: 'ready'; folder: BackupFolder }
  | { status: 'needs-permission' }
  | { status: 'none' }

export interface FsAdapter {
  isFolderSupported(): boolean
  /** 사용자 동작 안에서 호출. 취소하면 null. */
  pickFolder(): Promise<BackupFolder | null>
  /** 저장된 폴더의 권한만 조회한다(요청하지 않음). */
  restoreFolder(): Promise<FolderState>
  /** 사용자 동작 안에서 호출. */
  requestPermission(): Promise<BackupFolder | null>
  downloadFile(name: string, bytes: Uint8Array): void
  /** accept: 파일 선택 창의 확장자 필터(기본 '.enc') */
  /** accept ''이면 모든 파일. maxBytes를 넘으면 읽지 않고 tooBig: true(bytes 빈 값). */
  pickFileToRead(accept?: string, opts?: { maxBytes?: number }): Promise<{ name: string; bytes: Uint8Array; tooBig?: boolean } | null>
}
