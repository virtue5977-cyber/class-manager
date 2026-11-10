/** 새 exe(SHELL 4)의 폴더 연결 다리. 없으면 undefined(HTML판·옛 exe). */
export interface FolderBridge {
  pick(): Promise<{ path: string } | null>
  open(path: string): Promise<void>
  list(path: string): Promise<{ name: string; dir: boolean }[]>
}
export function getFolderBridge(): FolderBridge | undefined {
  return (globalThis as { desktop?: { folder?: FolderBridge } }).desktop?.folder
}
export const NEED_EXE = '폴더 연결은 새 설치형(Windows 앱)에서만 됩니다.'
