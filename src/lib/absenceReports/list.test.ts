// @vitest-environment node
import { createDb } from '../db/schema'
import { saveAttendance, type AttendanceInput } from '../attendance/attendance'
import { createClass, saveStudent, emptyStudent } from '../roster/roster'
import { reconcileStudent, listReportsByStudent } from './reconcile'
import { listReportsForMonth, setSubmittedMany } from './list'

const a = (student_id: string, date: string, over: Partial<AttendanceInput> = {}): AttendanceInput => ({
  student_id, date, kind: '결석', category: '질병', period: null, reason: '감기', evidence_type: null, memo: '', ...over,
})

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const other = await createClass(db, { school_year: 2026, grade: 1, class_no: 6 })
  const s1 = await saveStudent(db, c.id, emptyStudent(2, '나'))
  const s2 = await saveStudent(db, c.id, emptyStudent(1, '가'))
  const o = await saveStudent(db, other.id, emptyStudent(1, '다'))
  for (const [s, d] of [[s1, '2026-10-30'], [s1, '2026-11-02'], [s2, '2026-11-20'], [o, '2026-11-10']] as const) {
    await saveAttendance(db, a(s.id, d))
    await reconcileStudent(db, s.id)
  }
  return { db, c, s1, s2 }
}

test('월과 기간이 겹치는 신고서를 번호순으로, 다른 학급은 빼고', async () => {
  const { db, c } = await setup()
  const nov = await listReportsForMonth(db, c.id, '2026-11')
  expect(nov.map((r) => `${r.student.number}:${r.report.start_date}~${r.report.end_date}`)).toEqual(['1:2026-11-20~2026-11-20', '2:2026-10-30~2026-11-02'])
  const oct = await listReportsForMonth(db, c.id, '2026-10')
  expect(oct.map((r) => r.student.name)).toEqual(['나'])
})

test('setSubmittedMany는 여러 건을 한 번에 제출/해제한다', async () => {
  const { db, c, s1, s2 } = await setup()
  const ids = (await listReportsForMonth(db, c.id, '2026-11')).map((r) => r.report.id)
  await setSubmittedMany(db, ids, true)
  const all = [...(await listReportsByStudent(db, s1.id)), ...(await listReportsByStudent(db, s2.id))]
  expect(all.every((r) => r.submitted && r.submitted_at)).toBe(true)
  await setSubmittedMany(db, ids, false)
  expect((await listReportsByStudent(db, s1.id))[0]).toMatchObject({ submitted: false, submitted_at: null })
})
