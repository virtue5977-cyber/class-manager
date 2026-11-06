import { buildHwpx } from '../hwpx/package'
import { CharPrRegistry } from '../hwpx/charPr'
import { paragraphXml, tableXml, PARA_CENTER } from '../hwpx/xml'
import { A4_PORTRAIT_BODY_WIDTH } from './roster-doc'

/** A4 가로 본문 폭: 84188 - 4251*2 */
export const A4_LANDSCAPE_BODY_WIDTH = 75686

/** 비율대로 나누고 남는 폭은 마지막 열에 더해 본문 폭을 정확히 채운다. */
export function tableColWidths(ratios: number[], total: number): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0)
  const w = ratios.map((r) => Math.floor((total * r) / sum))
  w[w.length - 1] += total - w.reduce((a, b) => a + b, 0)
  return w
}

export interface TableDoc {
  title: string
  header: string[]
  rows: string[][]
  /** 열 너비 비율(없으면 균등) */
  colRatios?: number[]
  landscape?: boolean
  fontSizePt?: number
  /** 제목 아래 한 줄(예: 기간) */
  subtitle?: string
}

/** 제목 + 머리글 반복 표 한 개짜리 문서(통계·상담일지·청소배치 등 공용). 한 쪽을 넘으면 한글이 쪽을 나눈다. */
export async function buildTableHwpx(doc: TableDoc, now?: Date): Promise<Uint8Array> {
  const size = doc.fontSizePt ?? 10
  const cp = new CharPrRegistry()
  const titleCp = cp.id(size + 6, true)
  const headCp = cp.id(size, true)
  const bodyCp = cp.id(size)
  const total = doc.landscape ? A4_LANDSCAPE_BODY_WIDTH : A4_PORTRAIT_BODY_WIDTH
  const all = [doc.header, ...doc.rows]
  const rowHeight = Math.round(size * 170)
  const body =
    paragraphXml(doc.title, { charPr: titleCp, paraPr: PARA_CENTER }) +
    (doc.subtitle ? paragraphXml(doc.subtitle, { charPr: bodyCp, paraPr: PARA_CENTER }) : '') +
    paragraphXml('', { charPr: bodyCp }) +
    tableXml({
      rows: all.map((row, r) => row.map((text) => ({ text, charPr: r === 0 ? headCp : bodyCp }))),
      colWidths: tableColWidths(doc.colRatios ?? doc.header.map(() => 1), total),
      rowHeights: all.map(() => rowHeight),
      repeatHeader: true,
    })
  const previewText = [doc.title, ...all.map((r) => r.join(' '))].join('\n').slice(0, 2000)
  return buildHwpx({ landscape: !!doc.landscape, bodyXml: body, charPrXml: cp.xml(), previewText, title: doc.title }, now)
}
