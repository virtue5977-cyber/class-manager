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
  /** 이 PC에서 DPAPI(safeStorage 비동기)를 쓸 수 있는지. 옛 메인은 보내지 않는다(모름). */
  dpapiAvailable?: boolean
}

export interface DesktopVaultApi {
  status(): Promise<VaultStatus>
  unlockDpapi(): Promise<string | null>
  readBackup(): Promise<PublicVault | null>
  /** dpapi 뺀 열쇠 + dekB64. 메인이 DPAPI로 감싸 vault.json에 쓴다. 오류는 정해진 한국어 문구. */
  store(payload: VaultPayload): Promise<boolean>
  /** vault.json·.bak 지우기. 끝나지 않은 옮기기·첫 설치를 처음부터 할 때만(렌더러가 조건을 확인한 뒤). */
  reset?(): Promise<boolean>
}

export type SaveAsResult = { ok: true; name: string } | { ok: false }

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
    /** scopes ⊆ BASE_SCOPES ∪ CALENDAR_SCOPES(메인이 확인). incremental이면 prompt=consent 없이 더한다. */
    login(scopes: string[], opts: { incremental: boolean }): Promise<unknown>
    logout(): Promise<unknown>
    /** 응답 { status, headers?, json? | bytes? }. 2xx가 아니어도 던지지 않는다. */
    api(method: string, url: string, body?: unknown, opts?: { binary?: boolean; wantHeaders?: boolean; contentType?: string }): Promise<unknown>
    /** { ok: true, id } | { ok: false, status, reason? } — HTTP 실패는 던지지 않는다. */
    uploadResumable?(meta: Record<string, unknown>, bytes: Uint8Array, fileId?: string): Promise<unknown>
    /** { ok: true, bytes } | { ok: false, status, reason? } */
    download?(fileId: string): Promise<unknown>
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
    pathOf(file: File): string | Promise<string>
  }
  folder?: { pick(): Promise<unknown>; open(p: string): Promise<unknown>; list(p: string): Promise<unknown>; allow?(p: string): Promise<unknown> }
  pdf?: { sizes: string[]; save(name: string, opts: unknown): Promise<unknown> }
  agy?: { status(): Promise<unknown>; ask(prompt: string): Promise<unknown> }
  backup?: DesktopBackupApi
  vault?: DesktopVaultApi
  /** 다른 이름으로 저장: 실제로 쓰고 크기를 확인했을 때만 ok(취소·실패는 ok:false). */
  file?: { saveAs(name: string, bytes: Uint8Array): Promise<SaveAsResult> }
  /** Task 15: 렌더러가 붙었음을 메인에 알린다(되돌리기 판정). */
  bundle?: { alive?(): Promise<unknown> | void; [k: string]: unknown }
  app?: { [k: string]: unknown }
  /** Task 16: 대화상자로 폴더 허용(paths:pick-folder)·놓은 파일 등록(File만 받음). */
  paths?: { pickFolder?(defaultPath?: string): Promise<unknown>; registerDrop?(file: File): Promise<unknown>; [k: string]: unknown }
  autostart?: { [k: string]: unknown }
  device?: { [k: string]: unknown }
}

/** exe 안이면 preload API, 아니면 null. */
export function getDesktop(): DesktopApi | null {
  if (typeof window === 'undefined') return null
  const d = (window as { desktop?: unknown }).desktop
  return d && typeof d === 'object' ? (d as DesktopApi) : null
}
