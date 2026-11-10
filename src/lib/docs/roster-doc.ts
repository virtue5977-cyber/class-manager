import type { RosterField } from '../db/types'
import { fieldValue } from '../roster/fields'
import type { ClassRec, StudentRec } from '../db/types'
import { classLabel } from '../roster/roster'
import { buildHwpx } from '../hwpx/package'
import { CharPrRegistry } from '../hwpx/charPr'
import { paragraphXml, tableXml, PARA_CENTER } from '../hwpx/xml'
import { writeSimpleXlsx } from '../xlsx/simple'

export interface RosterDocOptions {
  title: string
  blankColumns: number
  fontSizePt: number
  includeInactive: boolean
  /** 이름 뒤에 넣을 명단 칸(양식 고치기의 칸) */
  fields?: RosterField[]
}

/** A4 세로 본문 폭: 59528 - 4251*2 */
export const A4_PORTRAIT_BODY_WIDTH = 51026
/** A4 본문 높이: 84188 - 위·아래 여백 2834×2 - 머리말 2834 - 꼬리말 1417 */
const A4_BODY_HEIGHT = 74269
/** 제목(최대 20pt)·빈 줄(최대 14pt)·표 바깥 여백을 빼고 5% 여유를 둔 표 높이 한도 */
export const ROSTER_TABLE_AVAILABLE_HEIGHT = Math.floor((A4_BODY_HEIGHT - 3200 - 2240 - 566) * 0.95)
const NUMBER_COL = 4000
const NAME_COL = 9000

export function defaultRosterDocOptions(c: ClassRec): RosterDocOptions {
  return { title: `${classLabel(c)} 명렬표`, blankColumns: 3, fontSizePt: 11, includeInactive: false }
}

export function rosterTable(students: StudentRec[], opts: RosterDocOptions): string[][] {
  const blanks = Array.from({ length: opts.blankColumns }, () => '')
  const fields = opts.fields ?? []
  const rows = students.filter((s) => opts.includeInactive || s.active).map((s) => [String(s.number), s.name, ...fields.map((f) => fieldValue(s, f)), ...blanks])
  return [['번호', '이름', ...fields.map((f) => f.label), ...blanks], ...rows]
}

/** 번호 4000, 이름 9000, 나머지는 더한 칸·빈 열에 균등(나머지는 마지막 열). 둘 다 0이면 이름이 나머지 전부. */
export function rosterColumnWidths(blankColumns: number, dataColumns = 0): number[] {
  const rest = A4_PORTRAIT_BODY_WIDTH - NUMBER_COL
  const n = Math.max(0, blankColumns) + Math.max(0, dataColumns)
  if (n <= 0) return [NUMBER_COL, rest]
  const each = Math.floor((rest - NAME_COL) / n)
  const widths = [NUMBER_COL, NAME_COL, ...Array.from({ length: n }, () => each)]
  widths[widths.length - 1] += rest - NAME_COL - each * n
  return widths
}

/**
 * 기본 행 높이(글자 크기 × 180)로 한 쪽에 들어가면 그대로, 넘치면 최소 높이까지 줄여 한 쪽에 맞춘다.
 * 최소 높이로도 넘치면 기본 높이로 두고 쪽을 나눈다(머리글 줄 반복).
 */
export function rosterRowHeight(fontSizePt: number, rowCount: number): number {
  const normal = Math.round(fontSizePt * 180)
  const minimum = Math.round(fontSizePt * 125) + 282
  if (normal * rowCount <= ROSTER_TABLE_AVAILABLE_HEIGHT) return normal
  const fit = Math.floor(ROSTER_TABLE_AVAILABLE_HEIGHT / rowCount)
  return fit >= minimum ? fit : normal
}

export async function buildRosterHwpx(students: StudentRec[], opts: RosterDocOptions, now?: Date): Promise<Uint8Array> {
  const cp = new CharPrRegistry()
  const titleCp = cp.id(opts.fontSizePt + 6, true)
  const headCp = cp.id(opts.fontSizePt, true)
  const bodyCp = cp.id(opts.fontSizePt)
  const table = rosterTable(students, opts)
  const rowHeight = rosterRowHeight(opts.fontSizePt, table.length)
  const body =
    paragraphXml(opts.title, { charPr: titleCp, paraPr: PARA_CENTER }) +
    paragraphXml('', { charPr: bodyCp }) +
    tableXml({
      rows: table.map((row, r) => row.map((text) => ({ text, charPr: r === 0 ? headCp : bodyCp }))),
      colWidths: rosterColumnWidths(opts.blankColumns, opts.fields?.length ?? 0),
      rowHeights: table.map(() => rowHeight),
      repeatHeader: true,
    })
  const previewText = [opts.title, ...table.slice(1).map((r) => `${r[0]} ${r[1]}`)].join('\n')
  return buildHwpx({ landscape: false, bodyXml: body, charPrXml: cp.xml(), previewText, title: opts.title }, now)
}

export async function buildRosterXlsx(students: StudentRec[], opts: RosterDocOptions): Promise<Uint8Array> {
  return writeSimpleXlsx('명렬표', rosterTable(students, opts))
}

export function rosterFileName(c: ClassRec, ext: 'hwpx' | 'xlsx'): string {
  return `${c.grade}학년${c.class_no}반_명렬표.${ext}`
}
