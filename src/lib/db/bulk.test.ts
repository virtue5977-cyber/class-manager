import { expect, test } from 'vitest'
import { createDb } from './schema'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { saveAttendance, listAttendanceInRange } from '../attendance/attendance'
import { reconcileStudent, listReportsByStudents } from '../absenceReports/reconcile'
import { saveLog, listLogsByStudents, deleteLog } from '../counseling/counseling'

async function setup() {
  const db = createDb('bulk-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  const b = await saveStudent(db, c.id, emptyStudent(2, '다라'))
  return { db, a, b }
}
const att = (student_id: string, date: string) => ({ student_id, date, kind: '결석' as const, category: '질병' as const, period: null, reason: '', evidence_type: null, memo: '' })

test('여러 학생의 신고서를 한 번에 학생별로 묶어 읽는다', async () => {
  const { db, a, b } = await setup()
  await saveAttendance(db, att(a.id, '2026-11-05'))
  await reconcileStudent(db, a.id)
  const m = await listReportsByStudents(db, [a.id, b.id])
  expect(m[a.id]).toHaveLength(1)
  expect(m[b.id]).toEqual([])
})

test('기간 안의 출결만 고른 학생 것만 읽는다', async () => {
  const { db, a, b } = await setup()
  await saveAttendance(db, att(a.id, '2026-11-05'))
  await saveAttendance(db, att(b.id, '2026-11-20'))
  await saveAttendance(db, att(b.id, '2026-12-02'))
  const rows = await listAttendanceInRange(db, [a.id, b.id], '2026-11-01', '2026-11-30')
  expect(rows.map((r) => r.date).sort()).toEqual(['2026-11-05', '2026-11-20'])
  expect(await listAttendanceInRange(db, [a.id], '2026-11-01', '2026-11-30')).toHaveLength(1)
})

test('여러 학생의 상담 기록을 학생별로 묶고, 지운 기록은 빼고 날짜순(listLogsByStudent와 같게)으로 둔다', async () => {
  const { db, a, b } = await setup()
  const log = (date: string) => ({ student_id: a.id, date, place: '', content: '메모' })
  await saveLog(db, log('2026-11-01'))
  await saveLog(db, log('2026-11-03'))
  const gone = await saveLog(db, log('2026-11-02'))
  await deleteLog(db, gone.id)
  const m = await listLogsByStudents(db, [a.id, b.id])
  expect(m[a.id].map((l) => l.date)).toEqual(['2026-11-01', '2026-11-03'])
  expect(m[b.id]).toEqual([])
})
