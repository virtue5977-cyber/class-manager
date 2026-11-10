import type { AttendanceCategory, AttendanceKind, AttendanceRec, StudentRec } from './db/types'
import type { SchoolDays } from './schoolDays'

export const KINDS: AttendanceKind[] = ['결석', '지각', '조퇴', '결과']
export const CATEGORIES: AttendanceCategory[] = ['질병', '미인정', '출석인정']

export interface Cell {
  /** 결석은 수업일 기준으로 이어진 묶음 수, 나머지는 기록 수 */
  count: number
  /** 결석의 수업일 일수(나머지는 0) */
  days: number
}
export type StudentStats = Record<string, Cell>

const empty = (): StudentStats => Object.fromEntries(KINDS.flatMap((k) => CATEGORIES.map((c) => [`${k}:${c}`, { count: 0, days: 0 }])))

/** 학생별 구분×종류 집계. range는 날짜(포함) 필터. */
export function computeAttendanceStats(atts: AttendanceRec[], days: SchoolDays, range: { from?: string; to?: string } = {}): Map<string, StudentStats> {
  const out = new Map<string, StudentStats>()
  const live = atts
    .filter((a) => !a.deleted && (!range.from || a.date >= range.from) && (!range.to || a.date <= range.to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const lastAbsence = new Map<string, string>() // `${학생}:${종류}` → 마지막 수업일 결석 날짜
  for (const a of live) {
    const st = out.get(a.student_id) ?? empty()
    out.set(a.student_id, st)
    const cell = st[`${a.kind}:${a.category}`]
    if (a.kind !== '결석') {
      cell.count++
      continue
    }
    if (!days.isClassDay(a.date)) {
      cell.count++
      continue
    }
    cell.days++
    const key = `${a.student_id}:${a.category}`
    const prev = lastAbsence.get(key)
    if (!prev || days.nextClassDay(prev) !== a.date) cell.count++
    lastAbsence.set(key, a.date)
  }
  return out
}

export const STATS_HEADER = ['번호', '이름', ...KINDS.flatMap((k) => CATEGORIES.map((c) => `${k} ${c}`))]

const show = (kind: AttendanceKind, c: Cell) => {
  if (kind === '결석') return c.count || c.days ? `${c.days}일(${c.count}건)` : ''
  return c.count ? String(c.count) : ''
}

/** 통계 칸 열쇠 12개: '결석:질병' 꼴(종류 순서 × 구분 순서) */
export const STAT_COLS: string[] = KINDS.flatMap((k) => CATEGORIES.map((c) => `${k}:${c}`))

/** 화면·엑셀·hwpx 공용 표. 마지막 줄은 합계. cols로 보일 칸만, reports를 주면 끝에 '신고서'(미제출 n / 전체 m). */
export function statsTable(students: StudentRec[], stats: Map<string, StudentStats>, opts: { cols?: string[]; reports?: Map<string, { open: number; total: number }> } = {}): string[][] {
  const cols = opts.cols ? STAT_COLS.filter((k) => opts.cols!.includes(k)) : STAT_COLS
  const total = empty()
  const rep = (o?: { open: number; total: number }) => (o && o.total ? `미제출 ${o.open} / ${o.total}` : '')
  const repTotal = { open: 0, total: 0 }
  const rows = students.map((s) => {
    const st = stats.get(s.id) ?? empty()
    for (const k of STAT_COLS) {
      total[k].count += st[k].count
      total[k].days += st[k].days
    }
    const r = opts.reports?.get(s.id)
    if (r) {
      repTotal.open += r.open
      repTotal.total += r.total
    }
    return [String(s.number), s.name, ...cols.map((k) => show(k.split(':')[0] as AttendanceKind, st[k])), ...(opts.reports ? [rep(r)] : [])]
  })
  const head = ['번호', '이름', ...cols.map((k) => k.replace(':', ' ')), ...(opts.reports ? ['신고서'] : [])]
  const sum = ['', '합계', ...cols.map((k) => show(k.split(':')[0] as AttendanceKind, total[k])), ...(opts.reports ? [rep(repTotal)] : [])]
  return [head, ...rows, sum]
}

/** 그 학생·종류의 기간 안 첫 날짜(통계 숫자를 누르면 출결 화면 그날로). */
export function firstAbsenceDate(atts: AttendanceRec[], studentId: string, kind: AttendanceKind, range: { from?: string; to?: string }): string | undefined {
  return atts
    .filter((a) => !a.deleted && a.student_id === studentId && a.kind === kind && (!range.from || a.date >= range.from) && (!range.to || a.date <= range.to))
    .map((a) => a.date)
    .sort()[0]
}
