import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, type AppDB } from '../../lib/db/schema'
import { createMemoryFsAdapter, type MemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { saveAttendance } from '../../lib/attendance/attendance'
import { reconcileStudent } from '../../lib/absenceReports/reconcile'
import type { StudentRec } from '../../lib/db/types'
import ReportPanel from './ReportPanel'

async function withAbsences(dates: string[]) {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(3, '가나'))
  for (const date of dates) await saveAttendance(db, { student_id: s.id, date, kind: '결석', category: '질병', period: null, reason: '감기', evidence_type: null, memo: '' })
  await reconcileStudent(db, s.id)
  return { db, s }
}
const renderPanel = (db: AppDB, s: StudentRec, fs: MemoryFsAdapter = createMemoryFsAdapter()) => {
  const r = render(
    <AppProviders db={db} fs={fs}>
      <ReportPanel student={s} onChanged={() => {}} />
    </AppProviders>,
  )
  return { ...r, fs }
}

test('3일 질병 결석 → "3일 이상 질병"과 "진단서 수령"', async () => {
  const { db, s } = await withAbsences(['2026-11-09', '2026-11-10', '2026-11-11'])
  renderPanel(db, s)
  expect(await screen.findByLabelText('증빙')).toHaveValue('3일 이상 질병')
  expect(screen.getByLabelText('진단서 수령')).toBeInTheDocument()
  expect(screen.getByText(/수업일 3일/)).toBeInTheDocument()
})

test('사유를 고치면 "자동으로 되돌리기", 누르면 원래 값', async () => {
  const user = userEvent.setup()
  const { db, s } = await withAbsences(['2026-11-09'])
  renderPanel(db, s)
  const input = await screen.findByLabelText('상세 사유')
  await user.clear(input)
  await user.type(input, '병원 진료')
  await user.tab()
  const reset = await screen.findByRole('button', { name: '상세 사유 자동으로 되돌리기' })
  await user.click(reset)
  await waitFor(() => expect(screen.getByLabelText('상세 사유')).toHaveValue('감기'))
  expect(screen.queryByRole('button', { name: '상세 사유 자동으로 되돌리기' })).not.toBeInTheDocument()
})

test('제출 후 출결 추가 → stale 안내', async () => {
  const user = userEvent.setup()
  const { db, s } = await withAbsences(['2026-11-09', '2026-11-10'])
  const first = renderPanel(db, s)
  await user.click(await screen.findByLabelText('제출'))
  await waitFor(() => expect(screen.getByLabelText('제출')).toBeChecked())
  first.unmount()
  await saveAttendance(db, { student_id: s.id, date: '2026-11-11', kind: '결석', category: '질병', period: null, reason: '', evidence_type: null, memo: '' })
  await reconcileStudent(db, s.id)
  renderPanel(db, s)
  expect(await screen.findByText('출결이 바뀌었습니다. 내용을 확인하세요.')).toBeInTheDocument()
})

test('한글로 받기 → 파일명, PK 바이트', async () => {
  const user = userEvent.setup()
  const { db, s } = await withAbsences(['2026-11-09'])
  const { fs } = renderPanel(db, s)
  await user.click(await screen.findByRole('button', { name: '한글로 받기' }))
  await waitFor(() => expect(fs.downloads).toHaveLength(1))
  expect(fs.downloads[0].name).toMatch(/\.hwpx$/)
  expect([...fs.downloads[0].bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
})
