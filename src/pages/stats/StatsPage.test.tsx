import { render, screen, waitFor } from '@testing-library/react'
import { pickExport } from '../../test/exportMenu'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { saveAttendance } from '../../lib/attendance/attendance'
import StatsPage from './StatsPage'

test('학년도 누적 표와 hwpx·엑셀 내보내기', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  const base = { student_id: s.id, kind: '결석', category: '질병', period: null, reason: '', evidence_type: null, memo: '' } as const
  await saveAttendance(db, { ...base, date: '2026-11-06' })
  await saveAttendance(db, { ...base, date: '2026-11-09' })
  const fs = createMemoryFsAdapter()
  render(
    <AppProviders db={db} fs={fs}>
      <StatsPage />
    </AppProviders>,
  )
  expect(await screen.findByText('가나')).toBeInTheDocument()
  expect(screen.getAllByText('2일(1건)')).toHaveLength(2)
  await pickExport(user, '한글(hwpx)')
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name).sort().join('|')).toBe('1학년_5반_출결_통계_2026학년도_전체.hwpx|1학년_5반_출결_통계_2026학년도_전체.xlsx'))
})

test('칸 고르기·신고서 칸·숫자 링크, 내보내기도 고른 칸만', async () => {
  const user = userEvent.setup()
  localStorage.removeItem('watson.stats.cols')
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  await saveAttendance(db, { student_id: s.id, kind: '결석', category: '질병', period: null, reason: '', evidence_type: null, memo: '', date: '2026-11-06' })
  const { reconcileStudent } = await import('../../lib/absenceReports/reconcile')
  await reconcileStudent(db, s.id)
  const fs = createMemoryFsAdapter()
  render(
    <AppProviders db={db} fs={fs}>
      <StatsPage />
    </AppProviders>,
  )
  expect(await screen.findByText('가나')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '미제출 1 / 1' })).toHaveAttribute('href', `#/attendance/reports?sid=${s.id}`)
  expect(screen.getByRole('link', { name: '1일(1건)' })).toHaveAttribute('href', `#/attendance?date=2026-11-06&sid=${s.id}`)
  expect(screen.getAllByRole('columnheader', { name: '질병' })).toHaveLength(4)
  await user.click(screen.getByText('칸 ▾'))
  await user.click(screen.getByRole('checkbox', { name: '조퇴 질병' }))
  await waitFor(() => expect(screen.getAllByRole('columnheader', { name: '질병' })).toHaveLength(3))
  expect(JSON.parse(localStorage.getItem('watson.stats.cols')!)).not.toContain('조퇴:질병')
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads).toHaveLength(1))
  const { readFirstSheet } = await import('../../lib/xlsx/read')
  const head = (await readFirstSheet(fs.downloads[0].bytes))[0]
  expect(head).not.toContain('조퇴 질병')
  expect(head).toContain('결석 질병')
  expect(head).toContain('신고서')
})
