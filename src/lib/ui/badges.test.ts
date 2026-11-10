import { expect, test } from 'vitest'
import { createDb } from '../db/schema'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { saveAttendance } from '../attendance/attendance'
import { reconcileStudent } from '../absenceReports/reconcile'
import { setSubmittedMany } from '../absenceReports/list'
import { deleteLog, saveLog, updateNuga } from '../counseling/counseling'
import { countBadges } from './badges'

test('이번 달 미제출 신고서와 미정리 상담 기록(지운 것 빼고)을 센다', async () => {
  const db = createDb('badge-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  const att = (date: string) => ({ student_id: s.id, date, kind: '결석' as const, category: '질병' as const, period: null, reason: '', evidence_type: null, memo: '' })
  for (const d of ['2026-11-02', '2026-11-09', '2026-11-16']) {
    await saveAttendance(db, att(d))
  }
  await reconcileStudent(db, s.id)
  const reps = await db.absence_reports.toArray()
  expect(reps).toHaveLength(3)
  await setSubmittedMany(db, [reps[0].id], true)
  const log = (content: string) => ({ student_id: s.id, date: '2026-11-03', place: '', content })
  await saveLog(db, log('하나'))
  const done = await saveLog(db, log('둘'))
  await updateNuga(db, done.id, { nuga_text: '정리', nuga_status: '정리됨' })
  const gone = await saveLog(db, log('셋'))
  await deleteLog(db, gone.id)
  expect(await countBadges(db, c.id, '2026-11')).toEqual({ openReports: 2, unorganizedLogs: 1 })
})
