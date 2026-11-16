/** 새 exe(SHELL 4)의 폴더 연결 다리. 없으면 undefined(HTML판·옛 exe). */
export interface FolderBridge {
  pick(): Promise<{ path: string } | null>
  open(path: string): Promise<void>
  list(path: string): Promise<{ name: string; dir: boolean }[]>
  /** 1.0+: 대화상자로 폴더를 다시 골라 메인에 허용 등록(기본 위치 = path). 취소면 null. */
  allow?(path: string): Promise<{ path: string } | null>
}
export function getFolderBridge(): FolderBridge | undefined {
  return (globalThis as { desktop?: { folder?: FolderBridge } }).desktop?.folder
}
export const NEED_EXE = '폴더 연결은 새 설치형(Windows 앱)에서만 됩니다.'
/** 메인이 고른 적 없는(허용 목록에 없는) 폴더를 열려 할 때 던지는 말. electron/main.cjs와 같아야 한다. */
export const NOT_ALLOWED = '이 폴더를 열려면 먼저 허용해야 합니다.'
/** IPC 오류 앞의 "Error invoking remote method ..." 를 뗀다. */
export const ipcMessage = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
