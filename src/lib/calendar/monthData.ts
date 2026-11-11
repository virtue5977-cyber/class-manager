import type { AppDB } from '../db/schema'
import type { AttendanceRec, CounselingLogRec, GoogleEventRec, LocalEventRec, SchoolCalendarRec, StudentRec } from '../db/types'
import { listLocalEvents } from '../events/localEvents'
import { listGoogleEvents } from '../google/google'
import { listStudents } from '../roster/roster'
import { listCalendar } from '../neis/schedule'
import { listAttendanceInRange } from '../attendance/attendance'
import { listLogsByStudents } from '../counseling/counseling'
import { addDays, weekday } from '../schoolDays'

export interface DayData {
  events: SchoolCalendarRec[]
  google: GoogleEventRec[]
  local: LocalEventRec[]
  atts: { a: AttendanceRec; s: StudentRec }[]
  logs: { l: CounselingLogRec; s: StudentRec }[]
}

export const emptyDay = (): DayData => ({ events: [], google: [], local: [], atts: [], logs: [] })

/** 달력 칸: 월요일부터 6주 중 그달이 끝나는 주까지. weekends=false면 평일만. */
/** sundayFirst: 일요일부터 시작(달력 화면). 기본은 월요일부터(출결 작은 달력). */
export function monthCells(month: string, weekends: boolean, sundayFirst = false): string[] {
  const first = `${month}-01`
  const gridStart = addDays(first, sundayFirst ? -(weekday(first) % 7) : -(weekday(first) - 1))
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  let lastRow = 0
  cells.forEach((d, i) => d.startsWith(month) && (lastRow = i))
  return cells.slice(0, Math.ceil((lastRow + 1) / 7) * 7).filter((d) => weekends || weekday(d) <= 5)
}

/** 기간 안의 학사일정·구글·내 일정·출결·상담을 날짜별로 모은다(읽기만). */
export async function loadMonthData(db: AppDB, classId: string | undefined, from: string, to: string): Promise<Record<string, DayData>> {
  const map: Record<string, DayData> = {}
  const day = (d: string) => (map[d] ??= emptyDay())
  for (const e of await listCalendar(db, from, to)) if (e.title && e.title !== '토요휴업일') day(e.date).events.push(e)
  for (const ge of await listGoogleEvents(db, from, to)) for (let d = ge.date; d <= ge.end_date && d <= to; d = addDays(d, 1)) day(d).google.push(ge)
  for (const le of await listLocalEvents(db, from, to)) for (let d = le.date < from ? from : le.date; d <= (le.end_date ?? le.date) && d <= to; d = addDays(d, 1)) day(d).local.push(le)
  if (classId) {
    const studs = await listStudents(db, classId, { includeInactive: true })
    const byId = new Map(studs.map((s) => [s.id, s]))
    const ids = studs.map((s) => s.id)
    for (const a of await listAttendanceInRange(db, ids, from, to)) day(a.date).atts.push({ a, s: byId.get(a.student_id)! })
    const logs = await listLogsByStudents(db, ids)
    for (const list of Object.values(logs)) for (const l of list) if (l.date >= from && l.date <= to) day(l.date).logs.push({ l, s: byId.get(l.student_id)! })
  }
  return map
}
