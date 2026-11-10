import { useEffect, useState } from 'react'
import { useDb } from '../../app/context'
import type { AttendanceRec, StudentRec } from '../../lib/db/types'
import { listAttendanceByDate } from '../../lib/attendance/attendance'
import { saveLog } from '../../lib/counseling/counseling'
import AttendanceForm from '../../pages/attendance/AttendanceForm'
import { blankFields, LogFieldsForm } from '../../pages/counseling/CounselingPage'
import type { RunResult } from '../../lib/command/run'

/** 명령에서 빠진 것을 채우는 떠 있는 창(기존 출결·상담 입력 부품을 그대로 씀). */
export default function FloatingForm({ form, onClose }: { form: NonNullable<RunResult['form']>; onClose: (message?: string) => void }) {
  const db = useDb()
  const [student, setStudent] = useState<StudentRec>()
  const [records, setRecords] = useState<AttendanceRec[] | null>(null)
  useEffect(() => {
    ;(async () => {
      setStudent(await db.students.get(form.studentId))
      setRecords(await listAttendanceByDate(db, [form.studentId], form.date))
    })()
  }, [db, form])
  if (!student || !records) return null
  return (
    <div className="floating-form card" role="dialog" aria-label={form.kind === 'attendance' ? '출결 입력' : '상담 기록'}>
      {form.kind === 'attendance' ? (
        <AttendanceForm student={student} date={form.date} records={records} onDone={(m) => onClose(m)} onClose={() => onClose()} />
      ) : (
        <div className="stack">
          <h3 className="pii">{`${student.number}번 ${student.name} 상담 기록`}</h3>
          <LogFieldsForm
            initial={blankFields(form.date)}
            submitLabel="저장"
            onSubmit={async (f) => {
              await saveLog(db, { student_id: student.id, ...f })
              onClose('상담 기록을 저장했습니다.')
            }}
            onCancel={() => onClose()}
          />
        </div>
      )}
    </div>
  )
}
