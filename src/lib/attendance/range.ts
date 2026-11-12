/** 결석 기간 넣기: 시작~끝 사이 수업일(주말·휴업일 제외)마다 같은 결석 기록 */
import type { AppDB } from '../db/schema'
import { listCalendar } from '../neis/schedule'
import { SchoolDays } from '../schoolDays'
import { deleteAttendance, saveAttendance, type AttendanceInput } from './attendance'

/** 넣을 날(수업일)과 그중 이미 출결이 있는 날 */
export async function planAbsenceRange(db: AppDB, studentId: string, start: string, end: string): Promise<{ days: string[]; taken: string[] }> {
  if (end < start) throw new Error('끝날이 시작날보다 앞입니다.')
  const days = new SchoolDays(await listCalendar(db, '0000-01-01', '9999-12-31')).classDaysBetween(start, end)
  const recs = (await db.attendance.where('student_id').equals(studentId).toArray()).filter((r) => !r.deleted && r.date >= start && r.date <= end)
  const taken = days.filter((d) => recs.some((r) => r.date === d))
  return { days, taken }
}

/** days마다 결석을 넣는다. overwrite면 그날 있던 출결을 지우고, 아니면 그날은 건너뛴다. 넣은 날 수를 돌려준다. */
export async function saveAbsenceRange(db: AppDB, input: AttendanceInput, days: string[], overwrite: boolean): Promise<number> {
  let n = 0
  for (const d of days) {
    const same = (await db.attendance.where('student_id').equals(input.student_id).toArray()).filter((r) => !r.deleted && r.date === d)
    if (same.length && !overwrite) continue
    for (const r of same) await deleteAttendance(db, r.id)
    await saveAttendance(db, { ...input, date: d, kind: '결석', period: null })
    n++
  }
  return n
}
