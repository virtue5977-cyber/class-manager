import { writeSimpleXlsx } from '../xlsx/simple'
import type { AbsenceReportRec, SeatingChartRec, StudentRec } from '../db/types'
import { seatLabel } from '../docs/seating-doc'

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const period = (r: { start_date: string; end_date: string }) => (r.start_date === r.end_date ? md(r.start_date) : `${md(r.start_date)}~${md(r.end_date)}`)

/** 결석신고서 목록 엑셀. stuName은 이름 가림 등을 위한 표시 이름. */
export function reportsXlsx(rows: { report: AbsenceReportRec; student: StudentRec }[], stuName: (s: StudentRec) => string): Promise<Uint8Array> {
  return writeSimpleXlsx('결석신고서', [
    ['번호', '이름', '기간', '출결', '수업일', '증빙', '진단서', '제출'],
    ...rows.map(({ report: r, student: s }) => [
      String(s.number),
      stuName(s),
      period(r),
      `${r.kind}${r.period ? ` ${r.period}교시` : ''}(${r.category})`,
      r.kind === '결석' ? String(r.school_days) : '',
      r.evidence_type ?? '',
      r.diagnosis_required ? (r.diagnosis_received ? '수령' : '필요') : '-',
      r.submitted ? '제출' : '미제출',
    ]),
  ])
}

/** 자리배치 엑셀: 첫 줄 제목, 칸은 자리 그대로(책상 없음 ×), 교탁 줄은 위·아래 그대로. */
export function seatingXlsx(chart: SeatingChartRec, students: StudentRec[]): Promise<Uint8Array> {
  const byId = new Map(students.map((s) => [s.id, s]))
  const grid = Array.from({ length: chart.rows }, (_, r) =>
    Array.from({ length: chart.cols }, (_, c) => {
      const seat = chart.seats.find((x) => x.row === r && x.col === c)
      if (!seat || seat.disabled) return '×'
      const st = seat.student_id ? byId.get(seat.student_id) : undefined
      return st ? seatLabel(st) : ''
    }),
  )
  const podium = [['교탁']]
  return writeSimpleXlsx('자리배치', [[chart.title], ...(chart.podium_position === 'top' ? podium : []), ...grid, ...(chart.podium_position === 'top' ? [] : podium)])
}

/** 달력 엑셀: 그달 일정(학사·구글·출결·상담)을 날짜 순으로. */
export function calendarXlsx(items: { date: string; kind: string; text: string }[]): Promise<Uint8Array> {
  const sorted = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return writeSimpleXlsx('달력', [['날짜', '종류', '내용'], ...sorted.map((x) => [x.date, x.kind, x.text])])
}
