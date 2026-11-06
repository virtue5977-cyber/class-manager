/** 업데이트 안내(exe는 메인 프로세스가 받아 두고, HTML 버전은 새 파일을 내려받게 한다). */

export const UPDATE_BASE = 'https://raw.githubusercontent.com/virtue5977-cyber/class-manager/updates/'
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export type UpdateState =
  | { status: 'idle' | 'checking' | 'latest'; current: string }
  | { status: 'ready' | 'need-exe'; current: string; version: string; note?: string }
  | { status: 'error'; current: string; message: string }
  | { status: 'html-available'; current: string; version: string; note?: string }

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

type GetJson = (url: string) => Promise<unknown>
const defaultGet: GetJson = async (url) => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

/** HTML(브라우저) 버전: 새 버전이 있는지만 본다. */
export async function checkHtmlUpdate(get: GetJson = defaultGet, current = APP_VERSION): Promise<UpdateState> {
  try {
    const info = (await get(`${UPDATE_BASE}update.json?t=${Date.now()}`)) as { version: string; note?: string }
    return isNewer(info.version, current) ? { status: 'html-available', current, version: info.version, note: info.note } : { status: 'latest', current }
  } catch {
    return { status: 'error', current, message: '업데이트를 확인하지 못했습니다. 인터넷 연결을 확인하세요.' }
  }
}

/** HTML 버전의 새 파일 내용 */
export async function fetchNewHtml(): Promise<Uint8Array> {
  const r = await fetch(`${UPDATE_BASE}${encodeURIComponent('담임업무.html')}?t=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error('새 파일을 받지 못했습니다.')
  return new Uint8Array(await r.arrayBuffer())
}
