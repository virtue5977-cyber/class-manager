/** 업데이트 안내(exe는 메인 프로세스가 받아 두고 서명을 확인한다). HTML판은 0.17로 끝나 업데이트하지 않는다. */

export const UPDATE_BASE = 'https://raw.githubusercontent.com/virtue5977-cyber/class-manager/updates/'
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/** 어떤 판으로 빌드됐나: single = HTML 단일 파일(0.17로 종료). 시험에서 바꾼다. */
export const edition = { single: typeof __SINGLE__ !== 'undefined' && __SINGLE__ === true }

export type UpdateState =
  | { status: 'idle' | 'checking' | 'latest'; current: string }
  | { status: 'ready' | 'need-exe'; current: string; version: string; note?: string }
  | { status: 'error'; current: string; message: string }

export interface DesktopUpdateApi {
  get(): Promise<UpdateState>
  check(): Promise<UpdateState>
  restart(): Promise<void>
  onState(cb: (s: UpdateState) => void): () => void
}

export function getDesktopUpdate(): DesktopUpdateApi | undefined {
  return (globalThis as { desktop?: { update?: DesktopUpdateApi } }).desktop?.update
}

/** 1.2.10 > 1.2.9 */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}
