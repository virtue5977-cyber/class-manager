import { render, screen, waitFor } from '@testing-library/react'
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
  await user.click(screen.getByRole('button', { name: 'hwpx로 내보내기' }))
  await user.click(screen.getByRole('button', { name: '엑셀로 내보내기' }))
  await waitFor(() => expect(fs.downloads.map((d) => d.name).sort().join('|')).toBe('1학년_5반_출결_통계_2026학년도_전체.hwpx|1학년_5반_출결_통계_2026학년도_전체.xlsx'))
})
