import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProviders } from '../../app/context'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { saveAttendance } from '../../lib/attendance/attendance'
import AttendanceForm from './AttendanceForm'

test('결석 기간: 기본 1일, 끝날을 고르면 수업일 수를 보이고, 이미 있는 날은 덮어쓸지 묻는다', async () => {
  const user = userEvent.setup()
  const db = createDb('t-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(3, '박도윤'))
  await saveAttendance(db, { student_id: s.id, date: '2026-11-16', kind: '지각', category: '미인정', period: '1', reason: '', evidence_type: null, memo: '' })
  const done = vi.fn()
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <AttendanceForm student={s} date="2026-11-12" records={[]} onDone={done} onClose={() => {}} />
    </AppProviders>,
  )
  const end = screen.getByLabelText('결석 끝날')
  expect(end).toHaveValue('2026-11-12')
  fireEvent.change(end, { target: { value: '2026-11-16' } })
  expect(await screen.findByText('수업일 3일(11/12, 11/13, 11/16)에 넣습니다.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '저장' }))
  const g = await screen.findByRole('group', { name: '이미 출결이 있는 날' })
  expect(g).toHaveTextContent('11/16')
  await user.click(screen.getByRole('button', { name: '덮어쓰기' }))
  await waitFor(async () => expect((await db.attendance.toArray()).filter((r) => !r.deleted).map((r) => `${r.date} ${r.kind}`).sort()).toEqual(['2026-11-12 결석', '2026-11-13 결석', '2026-11-16 결석']))
  expect(done).toHaveBeenCalled()
})
