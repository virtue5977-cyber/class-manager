import type { ClassRec, SeatingChartRec, StudentRec } from '../db/types'
import { buildHwpx } from '../hwpx/package'
import { CharPrRegistry } from '../hwpx/charPr'
import { BORDER_NONE, BORDER_THIN, floatingTablesXml, paragraphXml, PARA_CENTER, type TableCell } from '../hwpx/xml'
import { A4_LANDSCAPE_BODY_WIDTH } from './table-doc'
import { seatAt } from '../seating/seating'

/** A4 가로 본문 높이에서 제목·여백을 뺀 표 높이 한도 */
const TABLE_HEIGHT = 40000
const ROSTER_WIDTH = 10442
const ROSTER_GAP = 1600
/** 글자 크기(pt)를 담는 데 필요한 칸 높이(줄 간격 160% + 칸 여백) */
const needH = (pt: number) => pt * 160 + 282
const fitPt = (h: number) => Math.floor((h - 282) / 160)

export const seatLabel = (s: StudentRec) => `${s.number}.${s.name}`

/** 자리배치표 hwpx(예시 양식 기준: 가로, 제목, 책상 상자, 교탁, 오른쪽 작은 명렬표). */
export async function buildSeatingHwpx(chart: SeatingChartRec, c: ClassRec, students: StudentRec[], now?: Date): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const byId = new Map(students.map((s) => [s.id, s]))
  const warnings: string[] = []
  const cp = new CharPrRegistry()
  const titleCp = cp.id(20, true)
  const avail = chart.show_roster ? A4_LANDSCAPE_BODY_WIDTH - ROSTER_WIDTH - ROSTER_GAP : A4_LANDSCAPE_BODY_WIDTH
  const deskW = Math.floor(avail / (chart.cols + (chart.cols - 1) / 5))
  const gapW = Math.floor(deskW / 5)
  const unitsTall = chart.rows + (chart.rows - 1) * 0.25 + 0.25 + 0.6
  const deskH = Math.min(5810, Math.floor(TABLE_HEIGHT / unitsTall))
  const gapH = Math.max(300, Math.floor(deskH * 0.25))
  const labels = chart.seats.map((s) => (s.student_id && byId.get(s.student_id) ? seatLabel(byId.get(s.student_id)!) : ''))
  const longest = Math.max(4, ...labels.map((l) => l.length))
  const size = Math.max(8, Math.min(22, Math.floor((deskW * 0.8) / (longest * 100)), fitPt(deskH)))
  const podiumH = Math.max(Math.floor(deskH * 0.6), needH(size))
  if (size === 8 && longest * 800 > deskW * 0.8) warnings.push('칸이 좁아 이름이 줄바꿈될 수 있습니다. 열 수를 줄이거나 명렬표를 끄세요.')
  const deskCp = cp.id(size, true)
  const smallCp = cp.id(9)
  const gapCp = cp.id(1) // 빈 칸·사이 칸: 글자 높이 때문에 줄이 늘어나지 않게
  const blank = (w = BORDER_NONE): TableCell => ({ text: '', charPr: gapCp, borderFill: w })

  const gridCols = chart.cols * 2 - 1
  const colWidths = Array.from({ length: gridCols }, (_, i) => (i % 2 === 0 ? deskW : gapW))
  const seatRows: TableCell[][] = []
  const seatHeights: number[] = []
  for (let r = 0; r < chart.rows; r++) {
    if (r > 0) {
      seatRows.push(colWidths.map(() => blank()))
      seatHeights.push(gapH)
    }
    seatRows.push(
      colWidths.map((_, gc) => {
        if (gc % 2 === 1) return blank()
        const seat = seatAt(chart.seats, r, gc / 2)
        if (!seat || seat.disabled) return blank()
        const st = seat.student_id ? byId.get(seat.student_id) : undefined
        return { text: st ? seatLabel(st) : '', charPr: deskCp, borderFill: BORDER_THIN }
      }),
    )
    seatHeights.push(deskH)
  }
  // 교탁 줄: 가운데 책상 칸(짝수 열이면 가운데 두 책상과 사이 칸)을 묶는다.
  const mid = chart.cols % 2 === 1 ? [chart.cols - 1, 1] : [chart.cols - 2, 3]
  const podiumRow: TableCell[] = []
  for (let gc = 0; gc < gridCols; ) {
    if (gc === mid[0]) {
      podiumRow.push({ text: '교탁', charPr: deskCp, borderFill: BORDER_THIN, colSpan: mid[1] })
      gc += mid[1]
    } else {
      podiumRow.push(blank())
      gc++
    }
  }
  const gapRow = colWidths.map(() => blank())
  const rows = chart.podium_position === 'top' ? [podiumRow, gapRow, ...seatRows] : [...seatRows, gapRow, podiumRow]
  const heights = chart.podium_position === 'top' ? [podiumH, gapH, ...seatHeights] : [...seatHeights, gapH, podiumH]

  const tables = [{ rows, colWidths, rowHeights: heights, repeatHeader: false, borderFill: BORDER_NONE, wrap: 'SQUARE' as const, horzOffset: 0, zOrder: 0 }]
  if (chart.show_roster) {
    const list = [...students].sort((a, b) => a.number - b.number)
    // 학생이 많으면 두 묶음(번호·이름 | 번호·이름)으로 나눠 한 쪽에 맞춘다.
    const split = list.length > 26
    const per = split ? Math.ceil(list.length / 2) : list.length
    const rh = Math.max(needH(7), Math.min(1800, Math.floor(TABLE_HEIGHT / (per + 1))))
    const pt = Math.max(7, Math.min(10, fitPt(rh)))
    const rosterCp = cp.id(pt)
    const headCp = cp.id(pt, true)
    const cell = (t: string, c = rosterCp): TableCell => ({ text: t, charPr: c, borderFill: BORDER_THIN })
    const body: TableCell[][] = []
    for (let i = 0; i < per; i++) {
      const a = list[i]
      const b = split ? list[i + per] : undefined
      body.push(split ? [cell(String(a.number)), cell(a.name), cell(b ? String(b.number) : ''), cell(b ? b.name : '')] : [cell(String(c.class_no)), cell(String(a.number)), cell(a.name)])
    }
    const width = ROSTER_WIDTH - 283 // 오른쪽 바깥 여백만큼 줄여 본문 폭을 넘지 않게
    tables.push({
      rows: [(split ? ['번호', '이름', '번호', '이름'] : ['반', '번호', '이름']).map((t) => cell(t, headCp)), ...body],
      colWidths: split ? [1700, width / 2 - 1700, 1700, width / 2 - 1700].map(Math.floor) : [2400, 2400, width - 4800],
      rowHeights: Array.from({ length: per + 1 }, () => rh),
      repeatHeader: false,
      borderFill: BORDER_THIN,
      wrap: 'SQUARE',
      horzOffset: avail + ROSTER_GAP - 283,
      zOrder: 1,
    })
  }
  const empty = chart.seats.filter((s) => !s.disabled).length
  const placedCount = chart.seats.filter((s) => s.student_id && byId.has(s.student_id)).length
  if (students.length > empty) warnings.push(`학생 ${students.length}명이 책상 ${empty}개보다 많습니다.`)
  else if (placedCount < students.length) warnings.push(`자리에 앉지 않은 학생이 ${students.length - placedCount}명 있습니다.`)
  const body = paragraphXml(chart.title, { charPr: titleCp, paraPr: PARA_CENTER }) + paragraphXml('', { charPr: smallCp }) + floatingTablesXml(tables)
  const previewText = [chart.title, ...labels.filter(Boolean)].join('\n')
  return { bytes: await buildHwpx({ landscape: true, bodyXml: body, charPrXml: cp.xml(), previewText, title: chart.title }, now), warnings }
}
