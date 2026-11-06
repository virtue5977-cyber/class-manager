import type { SchoolCalendarRec } from './db/types'

/** 양력 고정 공휴일(MM-DD). 음력·대체공휴일·선거일은 학사일정으로만 안다. */
export const FIXED_HOLIDAYS = ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25']

const pad = (n: number) => String(n).padStart(2, '0')

/** 기기 현지 날짜를 YYYY-MM-DD로 */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 날짜 문자열을 UTC 정오로 다뤄 시간대·서머타임 영향을 없앤다. */
function utcNoon(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

export function addDays(date: string, n: number): string {
  const t = utcNoon(date)
  t.setUTCDate(t.getUTCDate() + n)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** 월=1 … 일=7 */
export function weekday(date: string): number {
  const w = utcNoon(date).getUTCDay()
  return w === 0 ? 7 : w
}

/** 3월 기준 학년도 */
function schoolYearOf(date: string): number {
  const [y, m] = date.split('-').map(Number)
  return m < 3 ? y - 1 : y
}

export class SchoolDays {
  private closed = new Set<string>()
  private neisYears = new Set<number>()

  constructor(calendar: SchoolCalendarRec[]) {
    for (const r of calendar) {
      if (r.deleted) continue
      if (!r.is_class_day) this.closed.add(r.date)
      if (r.source === 'neis') this.neisYears.add(schoolYearOf(r.date))
    }
  }

  isClassDay(date: string): boolean {
    if (weekday(date) >= 6) return false
    if (FIXED_HOLIDAYS.includes(date.slice(5))) return false
    return !this.closed.has(date)
  }

  classDaysBetween(start: string, end: string): string[] {
    const out: string[] = []
    for (let d = start; d <= end; d = addDays(d, 1)) if (this.isClassDay(d)) out.push(d)
    return out
  }

  countClassDays(start: string, end: string): number {
    return start > end ? 0 : this.classDaysBetween(start, end).length
  }

  nextClassDay(date: string): string {
    let d = date
    for (let i = 0; i < 400; i++) {
      d = addDays(d, 1)
      if (this.isClassDay(d)) return d
    }
    throw new Error('다음 수업일을 찾지 못했습니다.')
  }

  /** 그 날짜가 속한 학년도의 NEIS 학사일정을 가져왔는지 */
  hasCalendarFor(date: string): boolean {
    return this.neisYears.has(schoolYearOf(date))
  }
}
