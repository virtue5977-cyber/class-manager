import type { AppDB } from '../db/schema'
import { save } from '../db/records'
import type { AbsenceReportRec, StudentRec } from '../db/types'

export interface ReportRow {
  report: AbsenceReportRec
  student: StudentRec
}

const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/** 그 달(YYYY-MM)과 기간이 겹치는 학급 신고서. 번호 → 시작일 순. */
export async function listReportsForMonth(db: AppDB, classId: string, ym: string): Promise<ReportRow[]> {
  const from = `${ym}-01`
  const to = monthEnd(ym)
  const students = (await db.students.where('class_id').equals(classId).toArray()).filter((s) => !s.deleted)
  const byId = new Map(students.map((s) => [s.id, s]))
  const reports = (await db.absence_reports.where('start_date').belowOrEqual(to).toArray()).filter(
    (r) => !r.deleted && byId.has(r.student_id) && r.end_date >= from,
  )
  return reports
    .map((report) => ({ report, student: byId.get(report.student_id)! }))
    .sort((x, y) => x.student.number - y.student.number || (x.report.start_date < y.report.start_date ? -1 : x.report.start_date > y.report.start_date ? 1 : 0))
}

export async function setSubmittedMany(db: AppDB, ids: string[], on: boolean): Promise<void> {
  const at = on ? new Date().toISOString() : null
  await db.transaction('rw', db.absence_reports, async () => {
    for (const id of ids) {
      const cur = await db.absence_reports.get(id)
      if (!cur || cur.deleted || cur.submitted === on) continue
      await save(db.absence_reports, { ...cur, submitted: on, submitted_at: at })
    }
  })
}
