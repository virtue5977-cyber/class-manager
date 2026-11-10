import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, type AppDB } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { putCache } from '../../lib/neis/cache'
import type { ClassPeriod } from '../../lib/neis/timetable'
import { saveManualSlot } from '../../lib/timetable/estimate'
import MyTimetable from './MyTimetable'

const p = (date: string, grade: number, classNo: string, period: number, subject: string): ClassPeriod => ({ date, grade, classNo, period, subject })
const WEEK = [
  p('2026-11-02', 1, '1', 1, '수학'), p('2026-11-02', 1, '1', 2, '과학'),
  p('2026-11-02', 1, '2', 1, '국어'), p('2026-11-03', 1, '2', 1, '수학'),
  p('2026-11-03', 1, '1', 1, '수학'), p('2026-11-04', 2, '1', 3, '영어'),
]

async function seeded() {
  const db = createDb('test-' + crypto.randomUUID())
  await putCache(db, 'class_timetable', '2026-11-02~2026-11-06', WEEK)
  return db
}
const renderWith = (db: AppDB) =>
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <MyTimetable today="2026-11-05" />
    </AppProviders>,
  )
const cell = (day: string, period: number) => within(screen.getByRole('table', { name: '내 시간표' })).getByRole('button', { name: `${day} ${period}교시` })

test('캐시가 없으면 안내 문구', async () => {
  renderWith(createDb('test-' + crypto.randomUUID()))
  expect(await screen.findByText("먼저 '이번 주 급식·시간표 가져오기'를 하세요.")).toBeInTheDocument()
})

test('학급을 고르면 그 학급의 과목만 체크박스로 보인다', async () => {
  const user = userEvent.setup()
  renderWith(await seeded())
  await user.click(await screen.findByLabelText('1-1'))
  const subjects = screen.getByRole('group', { name: '담당 과목' })
  expect(within(subjects).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['과학', '수학'])
})

test('추정하면 표에 "1-1 수학"이 해당 칸에 나온다', async () => {
  const user = userEvent.setup()
  renderWith(await seeded())
  await user.click(await screen.findByLabelText('1-1'))
  await user.click(screen.getByLabelText('수학'))
  await user.click(screen.getByRole('button', { name: '시간표 추정' }))
  await waitFor(() => expect(cell('월', 1)).toHaveTextContent('1-1 수학'))
  expect(cell('화', 1)).toHaveTextContent('1-1 수학')
  expect(cell('월', 2)).toHaveTextContent('')
})

test('칸을 고쳐 저장하면 다시 추정해도 고친 값이 남는다', async () => {
  const user = userEvent.setup()
  renderWith(await seeded())
  await user.click(await screen.findByLabelText('1-1'))
  await user.click(screen.getByLabelText('수학'))
  await user.click(screen.getByRole('button', { name: '시간표 추정' }))
  await waitFor(() => expect(cell('월', 1)).toHaveTextContent('1-1 수학'))
  await user.click(cell('월', 1))
  await user.clear(screen.getByLabelText('과목'))
  await user.type(screen.getByLabelText('과목'), '수학 보강')
  await user.click(screen.getByRole('button', { name: '칸 저장' }))
  await user.click(screen.getByRole('button', { name: '시간표 추정' }))
  await waitFor(() => expect(cell('월', 1)).toHaveTextContent('1-1 수학 보강'))
  expect(cell('화', 1)).toHaveTextContent('1-1 수학')
})

test('충돌이 있으면 안내 목록이 보인다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await putCache(db, 'class_timetable', '2026-11-02~2026-11-06', [p('2026-11-02', 1, '1', 1, '수학'), p('2026-11-02', 1, '2', 1, '수학')])
  renderWith(db)
  await user.click(await screen.findByLabelText('1-1'))
  await user.click(screen.getByLabelText('1-2'))
  await user.click(screen.getByLabelText('수학'))
  await user.click(screen.getByRole('button', { name: '시간표 추정' }))
  expect(await screen.findByText('같은 시간에 여러 학급: 월 1교시 (1-1, 1-2)')).toBeInTheDocument()
})

test('고른 학급·과목은 다시 열어도 유지된다', async () => {
  const user = userEvent.setup()
  const db = await seeded()
  const first = renderWith(db)
  await user.click(await screen.findByLabelText('1-1'))
  await user.click(screen.getByLabelText('수학'))
  first.unmount()
  renderWith(db)
  expect(await screen.findByLabelText('1-1')).toBeChecked()
  expect(await screen.findByLabelText('수학')).toBeChecked()
})

test('가져온 주 정보가 없어도 저장된 내 시간표가 있으면 안내 대신 시간표를 보여 준다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await saveManualSlot(db, { weekday: 1, period: 2, subject: '도덕', class_label: '1-5' })
  renderWith(db)
  expect(await screen.findByText(/저장된 내 시간표 1시간/)).toBeInTheDocument()
  expect(screen.queryByText("먼저 '이번 주 급식·시간표 가져오기'를 하세요.")).not.toBeInTheDocument()
})
