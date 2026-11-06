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

/** 화면·엑셀·hwpx 공용 표. 마지막 줄은 합계. */
export function statsTable(students: StudentRec[], stats: Map<string, StudentStats>): string[][] {
  const total = empty()
  const rows = students.map((s) => {
    const st = stats.get(s.id) ?? empty()
    return [
      String(s.number),
      s.name,
      ...KINDS.flatMap((k) =>
        CATEGORIES.map((c) => {
          const cell = st[`${k}:${c}`]
          total[`${k}:${c}`].count += cell.count
          total[`${k}:${c}`].days += cell.days
          return show(k, cell)
        }),
      ),
    ]
  })
  const sum = ['', '합계', ...KINDS.flatMap((k) => CATEGORIES.map((c) => show(k, total[`${k}:${c}`])))]
  return [STATS_HEADER, ...rows, sum]
}
