/** /내보내기 화면 형식: 그 화면(route)으로 옮긴 뒤, 그 화면의 내보내기 메뉴가 생기면 한 번만 실행할 형식.
 * 다른 화면의 메뉴는 받지 않고, 5초가 지나면 버린다(엉뚱한 화면에서 나중에 내려받지 않게). */
export type ExportRequest = 'hwpx' | 'xlsx' | 'pdf' | 'print'
let pending: { route: string; f: ExportRequest; at: number } | null = null
const here = () => (typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '').split('?')[0] || '/')

export function requestExport(route: string, f: ExportRequest) {
  pending = { route, f, at: Date.now() }
  // 화면을 옮긴 다음 차례에 알린다(지금 화면의 메뉴가 먼저 받지 않게 — 받더라도 주소가 달라 무시)
  setTimeout(() => window.dispatchEvent(new Event('watson-export-request')), 50)
}
export function takeExport(): ExportRequest | null {
  if (!pending) return null
  if (Date.now() - pending.at > 5000) {
    pending = null
    return null
  }
  if (pending.route !== here()) return null
  const f = pending.f
  pending = null
  return f
}
