/** /내보내기 화면 형식: 화면을 옮긴 뒤 그 화면의 내보내기 메뉴가 생기면 바로 실행할 형식 */
export type ExportRequest = 'hwpx' | 'xlsx' | 'pdf' | 'print'
let pending: ExportRequest | null = null
export function requestExport(f: ExportRequest) {
  pending = f
  window.dispatchEvent(new Event('watson-export-request'))
}
export function takeExport(): ExportRequest | null {
  const f = pending
  pending = null
  return f
}
