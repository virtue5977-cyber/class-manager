/** exe(SHELL 3)가 넣어 주는 PDF 저장(화면을 A4로). */
export interface PdfOptions {
  /** 기본 A4. 반성문 B4 양식은 'B4'(새 exe SHELL 4에서 반영, 옛 exe는 A4) */
  pageSize?: 'A4' | 'B4'
}
interface PdfApi {
  save(fileName: string, opts?: PdfOptions): Promise<boolean>
}
const bridge = () => (globalThis as { desktop?: { pdf?: PdfApi } }).desktop?.pdf

/** 지금 화면을 PDF로. 브리지가 없으면 인쇄 창을 열어 'PDF로 저장'을 고르게 한다. */
export async function exportPdf(fileName: string, opts?: PdfOptions): Promise<'saved' | 'canceled' | 'printed'> {
  const b = bridge()
  if (!b) {
    window.print()
    return 'printed'
  }
  return (await (opts ? b.save(fileName, opts) : b.save(fileName))) ? 'saved' : 'canceled'
}
