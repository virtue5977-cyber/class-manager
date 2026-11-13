/** /내보내기 화면 형식: 그 화면(route)으로 옮긴 뒤, 그 화면의 내보내기 메뉴가 생기면 한 번만 실행할 형식.
 * 다른 화면의 메뉴는 받지 않고, 기다리는 시간이 지나면 버리고 실패로 알린다(엉뚱한 화면에서 나중에 내려받지 않게). */
export type ExportRequest = 'hwpx' | 'xlsx' | 'pdf' | 'print'
export interface ExportResult {
  ok: boolean
  message?: string
}
/** 메뉴를 기다리는 시간(시험에서 줄인다) */
export const EXPORT_WAIT = { ms: 5000 }

let pending: { route: string; f: ExportRequest; at: number; settle: (r: ExportResult) => void } | null = null
const here = () => (typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '').split('?')[0] || '/')

/** 부탁하고, 그 화면이 실제로 내보낸 결과(또는 받지 못함)를 기다린다. */
export function requestExport(route: string, f: ExportRequest): Promise<ExportResult> {
  pending?.settle({ ok: false, message: '다른 내보내기 부탁으로 바뀌었습니다.' })
  return new Promise((resolve) => {
    let done = false
    const settle = (r: ExportResult) => {
      if (done) return
      done = true
      resolve(r)
    }
    const me = { route, f, at: Date.now(), settle }
    pending = me
    // 화면을 옮긴 다음 차례에 알린다(지금 화면의 메뉴가 먼저 받지 않게 — 받더라도 주소가 달라 무시)
    setTimeout(() => window.dispatchEvent(new Event('watson-export-request')), 50)
    // 아무 화면도 받지 않았을 때만 실패(받은 뒤 저장 창을 오래 보고 있어도 기다린다)
    setTimeout(() => {
      if (pending !== me) return
      pending = null
      settle({ ok: false, message: '그 화면의 내보내기 메뉴를 찾지 못했습니다.' })
    }, EXPORT_WAIT.ms)
  })
}

/** 이 화면에 온 부탁을 받는다. 실행한 뒤 settle로 결과를 알려야 한다. */
export function takeExport(): { f: ExportRequest; settle: (r: ExportResult) => void } | null {
  if (!pending) return null
  if (Date.now() - pending.at > EXPORT_WAIT.ms) {
    pending = null
    return null
  }
  if (pending.route !== here()) return null
  const { f, settle } = pending
  pending = null
  return { f, settle }
}
