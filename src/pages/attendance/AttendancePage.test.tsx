import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, type AppDB } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent, setCurrentClassId } from '../../lib/roster/roster'
import { saveAttendance, listAttendanceByStudent } from '../../lib/attendance/attendance'
import { reconcileStudent, listReportsByStudent, updateReport } from '../../lib/absenceReports/reconcile'
import AttendancePage from './AttendancePage'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  const s1 = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  await saveStudent(db, c.id, emptyStudent(2, '다라'))
  return { db, c, s1 }
}
const renderAt = (db: AppDB, today: string) =>
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <AttendancePage today={today} />
    </AppProviders>,
  )
const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^\\d+번 ${name}`) })

test('질병 결석 저장 → "결석(질병)"과 "신고서" 뱃지', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  renderAt(db, '2026-11-06')
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  await user.click(screen.getByRole('button', { name: '결석' }))
  await user.click(screen.getByRole('button', { name: '질병' }))
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('신고서를 만들었습니다.')).toBeInTheDocument()
  await waitFor(() => expect(row('가나')).toHaveTextContent('결석(질병)'))
  expect(row('가나')).toHaveTextContent('신고서')
})

test('지각 선택 시 교시 칸, 비우면 "교시를 입력하세요."', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  renderAt(db, '2026-11-06')
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  expect(screen.queryByLabelText('교시')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '지각' }))
  expect(screen.getByLabelText('교시')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('교시를 입력하세요.')).toBeInTheDocument()
})

test('출석인정일 때만 증빙 구분', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  renderAt(db, '2026-11-06')
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  expect(screen.queryByLabelText('증빙 구분')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '출석인정' }))
  expect(screen.getByLabelText('증빙 구분')).toBeInTheDocument()
})

test('주말이면 "수업일이 아닙니다" 안내', async () => {
  const { db } = await setup()
  renderAt(db, '2026-11-07')
  expect(await screen.findByText('수업일이 아닙니다(휴업일·주말).')).toBeInTheDocument()
})

test('제출된 신고서에 영향 주는 삭제는 확인(취소하면 그대로)', async () => {
  const user = userEvent.setup()
  const { db, s1 } = await setup()
  await saveAttendance(db, { student_id: s1.id, date: '2026-11-06', kind: '결석', category: '질병', period: null, reason: '감기', evidence_type: null, memo: '' })
  await reconcileStudent(db, s1.id)
  await updateReport(db, (await listReportsByStudent(db, s1.id))[0].id, { submitted: true })
  renderAt(db, '2026-11-06')
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  await user.click(screen.getByRole('button', { name: '삭제' }))
  expect(await screen.findByText(/제출했거나 직접 고친 신고서\(.*\)에 영향을 줍니다\. 계속할까요\?/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '취소' }))
  expect(await listAttendanceByStudent(db, s1.id)).toHaveLength(1)
})

test('미인정 지각은 저장되지만 신고서 뱃지 없음', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  renderAt(db, '2026-11-06')
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  await user.click(screen.getByRole('button', { name: '지각' }))
  await user.click(screen.getByRole('button', { name: '미인정' }))
  await user.type(screen.getByLabelText('교시'), '1')
  await user.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(row('가나')).toHaveTextContent('지각 1교시(미인정)'))
  expect(within(row('가나')).queryByText('신고서')).not.toBeInTheDocument()
})

test('저장하면 입력 칸이 닫히고 그 학생 칸으로 커서가 돌아간다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  renderAt(db, '2026-11-06')
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  await user.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument())
  await waitFor(() => expect(row('가나')).toHaveFocus())
})

test('숫자키 1~4로 구분을 고르고, 사유 칸에서 Enter로 저장한다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  renderAt(db, '2026-11-06')
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  await user.keyboard('2')
  expect(screen.getByRole('button', { name: '지각' })).toHaveAttribute('aria-pressed', 'true')
  await user.type(screen.getByLabelText('교시'), '1')
  await user.click(screen.getByRole('button', { name: '미인정' }))
  await user.type(screen.getByLabelText('사유'), '늦잠{Enter}')
  await waitFor(() => expect(row('가나')).toHaveTextContent('지각 1교시(미인정)'))
})

test('전날·다음날은 주말·휴업일을 건너뛴다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  renderAt(db, '2026-11-06') // 금요일
  await screen.findByRole('button', { name: /^1번 가나/ })
  await user.click(screen.getByRole('button', { name: '다음날' }))
  await waitFor(() => expect(screen.getByLabelText('날짜')).toHaveValue('2026-11-09'))
  await user.click(screen.getByRole('button', { name: '전날' }))
  await waitFor(() => expect(screen.getByLabelText('날짜')).toHaveValue('2026-11-06'))
})
