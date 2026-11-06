/** XML 1.0에 쓸 수 없는 제어 문자(탭·줄바꿈 제외) */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

export function escapeXml(s: string): string {
  return s.replace(INVALID_XML_CHARS, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** 기본 양식 ID */
export const PARA_JUSTIFY = 13
export const PARA_CENTER = 14
export const BORDER_NONE = 1
export const BORDER_THIN = 3

const textXml = (text: string) => `<hp:t>${text.split('\n').map(escapeXml).join('<hp:lineBreak/>')}</hp:t>`

function runXml(text: string, charPr: number): string {
  return text === '' ? `<hp:run charPrIDRef="${charPr}"/>` : `<hp:run charPrIDRef="${charPr}">${textXml(text)}</hp:run>`
}

export function paragraphXml(text: string, opts: { charPr: number; paraPr?: number }): string {
  return `<hp:p id="0" paraPrIDRef="${opts.paraPr ?? PARA_JUSTIFY}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runXml(text, opts.charPr)}</hp:p>`
}

export interface TableCell {
  text: string
  charPr: number
  paraPr?: number
  borderFill?: number
  colSpan?: number
}

let tableSeq = 0

const CELL_MARGIN = { left: 510, right: 510, top: 141, bottom: 141 }

export interface TableSpec {
  rows: TableCell[][]
  colWidths: number[]
  rowHeights: number[]
  repeatHeader?: boolean
  borderFill?: number
  /** 기본 TOP_AND_BOTTOM. 표 두 개를 나란히 둘 때 SQUARE + horzOffset */
  wrap?: 'TOP_AND_BOTTOM' | 'SQUARE'
  horzOffset?: number
  vertOffset?: number
  zOrder?: number
}

/** 표를 한 문단으로 감싼다. */
export function tableXml(t: TableSpec): string {
  return `<hp:p id="0" paraPrIDRef="${PARA_CENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${tblXml(t)}</hp:run></hp:p>`
}

/** 여러 표를 한 문단에 띄워 둔다(자리배치표 + 옆 명렬표처럼). */
export function floatingTablesXml(tables: TableSpec[]): string {
  return `<hp:p id="0" paraPrIDRef="${PARA_JUSTIFY}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${tables.map((t) => `<hp:run charPrIDRef="0">${tblXml(t)}</hp:run>`).join('')}</hp:p>`
}

function tblXml(t: TableSpec): string {
  const id = 1_000_000_000 + ++tableSeq
  const width = t.colWidths.reduce((a, b) => a + b, 0)
  const height = t.rowHeights.reduce((a, b) => a + b, 0)
  const border = t.borderFill ?? BORDER_THIN
  const m = CELL_MARGIN
  const rowsXml = t.rows
    .map((row, r) => {
      let col = 0
      const cells = row.map((c) => {
        const span = c.colSpan ?? 1
        const w = t.colWidths.slice(col, col + span).reduce((a, b) => a + b, 0)
        const x =
          `<hp:tc name="" header="${r === 0 && t.repeatHeader !== false ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${c.borderFill ?? border}">` +
          `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
          `<hp:p id="2147483648" paraPrIDRef="${c.paraPr ?? PARA_CENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runXml(c.text, c.charPr)}</hp:p>` +
          `</hp:subList>` +
          `<hp:cellAddr colAddr="${col}" rowAddr="${r}"/><hp:cellSpan colSpan="${span}" rowSpan="1"/><hp:cellSz width="${w}" height="${t.rowHeights[r]}"/>` +
          `<hp:cellMargin left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}"/></hp:tc>`
        col += span
        return x
      })
      return `<hp:tr>${cells.join('')}</hp:tr>`
    })
    .join('')
  return (
    `<hp:tbl id="${id}" zOrder="${t.zOrder ?? 0}" numberingType="TABLE" textWrap="${t.wrap ?? 'TOP_AND_BOTTOM'}" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${t.repeatHeader === false ? 0 : 1}" rowCnt="${t.rows.length}" colCnt="${t.colWidths.length}" cellSpacing="0" borderFillIDRef="${border}" noAdjust="0">` +
    `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="${t.vertOffset ?? 0}" horzOffset="${t.horzOffset ?? 0}"/>` +
    `<hp:outMargin left="283" right="283" top="283" bottom="283"/>` +
    `<hp:inMargin left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}"/>` +
    rowsXml +
    `</hp:tbl>`
  )
}
