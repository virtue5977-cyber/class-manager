import { render, screen, waitFor } from '@testing-library/react'
import { pickExport } from '../../test/exportMenu'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { listSeatingCharts, seatAt } from '../../lib/seating/seating'
import SeatingTab from './SeatingTab'
import CleaningTab from './CleaningTab'
import { getCleaningChart, rowsOf, studentsIn, columnsOf } from '../../lib/cleaning/cleaning'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  const b = await saveStudent(db, c.id, emptyStudent(2, '다라'))
  return { db, c, a, b, fs: createMemoryFsAdapter() }
}

test('자리: 누르고 칸 누르기로 배치·맞바꿈, 크기, 고정, hwpx', async () => {
  const user = userEvent.setup()
  const { db, c, a, b, fs } = await setup()
  render(<AppProviders db={db} fs={fs}><SeatingTab classRec={c} today="2026-11-05" /></AppProviders>)
  expect(await screen.findByText('자리 없는 학생 2명')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '1.가나' }))
  await user.click(screen.getByRole('gridcell', { name: '1행 1열 빈자리' }))
  await user.click(screen.getByRole('button', { name: '2.다라' }))
  await user.click(screen.getByRole('gridcell', { name: '1행 2열 빈자리' }))
  expect(await screen.findByText('자리 없는 학생 0명')).toBeInTheDocument()
  await user.click(screen.getByRole('gridcell', { name: '1행 1열 1.가나' }))
  await user.click(screen.getByRole('gridcell', { name: '1행 2열 2.다라' }))
  await waitFor(async () => {
    const [chart] = await listSeatingCharts(db, c.id)
    expect(seatAt(chart.seats, 0, 0)!.student_id).toBe(b.id)
    expect(seatAt(chart.seats, 0, 1)!.student_id).toBe(a.id)
  })
  await user.click(screen.getByRole('button', { name: '1행 1열 고정' }))
  await user.clear(screen.getByLabelText('행'))
  await user.type(screen.getByLabelText('행'), '3')
  await user.click(screen.getByRole('button', { name: '크기 적용' }))
  await waitFor(async () => expect((await listSeatingCharts(db, c.id))[0]).toMatchObject({ rows: 3 }))
  expect(seatAt((await listSeatingCharts(db, c.id))[0].seats, 0, 0)!.fixed).toBe(true)
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['1학년_5반_자리배치표(11월).hwpx']))
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads.at(-1)!.name).toBe('1학년_5반_자리배치표(11월).xlsx'))
})

test('청소: 줄 추가, 구역 이름, 학생 넣기, 자동 분배, hwpx', async () => {
  const user = userEvent.setup()
  const { db, c, fs } = await setup()
  render(<AppProviders db={db} fs={fs}><CleaningTab classRec={c} /></AppProviders>)
  await user.click(await screen.findByRole('button', { name: '구역(줄) 추가' }))
  await user.click(screen.getByRole('button', { name: '구역(줄) 추가' }))
  await user.type(screen.getByLabelText('1번째 줄 구역'), '교실')
  await user.tab()
  await user.click(screen.getByRole('button', { name: '1.가나' }))
  await user.click(screen.getByLabelText('2번째 줄 담당 학생'))
  expect(await screen.findByText('담당 학생 배정 안 된 학생 1명')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '남은 학생 자동 분배' }))
  await waitFor(async () => {
    const ch = await getCleaningChart(db, c)
    const col = columnsOf(ch)[1].id
    expect(rowsOf(ch).map((r) => studentsIn(r, col).length)).toEqual([1, 1])
  })
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['1학년_5반_청소_구역.hwpx']))
})
