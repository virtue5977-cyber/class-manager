import type { Wrapped, VaultPayload } from '../vault/keys'
import type { DesktopBackupApi } from '../fs/desktop'

/** vault:status의 공개 열쇠(dpapi는 메인 밖으로 나오지 않는다). */
export interface PublicVault {
  v: 1
  keyId: string
  dbName: string
  pass: Wrapped & { updatedAt: string }
  recovery?: Wrapped
}

export type VaultState = 'none' | 'ok' | 'needs-pass' | 'broken'

export interface VaultStatus {
  state: VaultState
  dekB64?: string
  vault?: PublicVault
  /** 메인이 알려 주면(나중 판): 이 PC에서 DPAPI를 쓸 수 있는지. 없으면 모름. */
  dpapi?: boolean
}

export interface DesktopVaultApi {
  status(): Promise<VaultStatus>
  unlockDpapi(): Promise<string | null>
  readBackup(): Promise<PublicVault | null>
  /** dpapi 뺀 열쇠 + dekB64. 메인이 DPAPI로 감싸 vault.json에 쓴다. 오류는 정해진 한국어 문구. */
  store(payload: VaultPayload): Promise<boolean>
}

type Off = () => void

/**
 * preload(window.desktop)가 내보내는 API. 뒤 작업에서 더하는 것(bundle·app·paths·autostart·device 등)은
 * 옛 exe에 없을 수 있으니 선택 항목이다.
 */
export interface DesktopApi {
  shell?: number
  isDesktop?: boolean
  onLock?(cb: () => void): Off
  update?: {
    get(): Promise<unknown>
    check(): Promise<unknown>
    restart(): Promise<unknown>
    onState(cb: (st: unknown) => void): Off
  }
  google?: {
    status(): Promise<unknown>
    setClient(json: string): Promise<unknown>
    login(): Promise<unknown>
    logout(): Promise<unknown>
    api(method: string, path: string, body?: unknown): Promise<unknown>
    [k: string]: unknown
  }
  ai?: { status(): Promise<unknown>; ask(req: unknown): Promise<unknown> }
  stt?: {
    status(): Promise<unknown>
    install(model: string): Promise<unknown>
    remove(): Promise<unknown>
    run(opts: unknown): Promise<unknown>
    cancel(): Promise<unknown>
    onProgress(cb: (p: unknown) => void): Off
    pathOf(file: File): string
  }
  folder?: { pick(): Promise<unknown>; open(p: string): Promise<unknown>; list(p: string): Promise<unknown> }
  pdf?: { sizes: string[]; save(name: string, opts: unknown): Promise<unknown> }
  agy?: { status(): Promise<unknown>; ask(prompt: string): Promise<unknown> }
  backup?: DesktopBackupApi
  vault?: DesktopVaultApi
  /** Task 15: 렌더러가 붙었음을 메인에 알린다(되돌리기 판정). */
  bundle?: { alive?(): Promise<unknown> | void; [k: string]: unknown }
  app?: { [k: string]: unknown }
  paths?: { [k: string]: unknown }
  autostart?: { [k: string]: unknown }
  device?: { [k: string]: unknown }
}

/** exe 안이면 preload API, 아니면 null. */
export function getDesktop(): DesktopApi | null {
  if (typeof window === 'undefined') return null
  const d = (window as { desktop?: unknown }).desktop
  return d && typeof d === 'object' ? (d as DesktopApi) : null
}
