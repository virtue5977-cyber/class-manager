import { render, screen, waitFor } from '@testing-library/react'
import { pickExport } from '../../test/exportMenu'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { saveAttendance } from '../../lib/attendance/attendance'
import { reconcileStudent, listReportsByStudent } from '../../lib/absenceReports/reconcile'
import ReportsPage from './ReportsPage'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s1 = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  const s2 = await saveStudent(db, c.id, emptyStudent(2, '다라'))
  const base = { kind: '결석', category: '질병', period: null, reason: '감기', evidence_type: null, memo: '' } as const
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11']) await saveAttendance(db, { ...base, student_id: s1.id, date: d })
  await saveAttendance(db, { ...base, student_id: s2.id, date: '2026-11-20' })
  await reconcileStudent(db, s1.id)
  await reconcileStudent(db, s2.id)
  const fs = createMemoryFsAdapter()
  render(
    <AppProviders db={db} fs={fs}>
      <ReportsPage month="2026-11" />
    </AppProviders>,
  )
  return { db, s1, s2, fs }
}

test('월 목록·요약, 제출 체크, 미제출 필터', async () => {
  const user = userEvent.setup()
  const { db, s1 } = await setup()
  expect(await screen.findByText('1번 가나')).toBeInTheDocument()
  expect(screen.getByText('2번 다라')).toBeInTheDocument()
  expect(screen.getByText('전체 2건 · 미제출 2건 · 진단서 미수령 1건')).toBeInTheDocument()
  await user.click(screen.getByRole('switch', { name: '1번 가나 11/9~11/11 제출' }))
  await waitFor(async () => expect((await listReportsByStudent(db, s1.id))[0].submitted).toBe(true))
  expect(await screen.findByText('전체 2건 · 미제출 1건 · 진단서 미수령 1건')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '1번 가나 11/9~11/11 제출' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByLabelText('미제출만'))
  expect(screen.queryByText('1번 가나')).not.toBeInTheDocument()
  expect(screen.getByText('2번 다라')).toBeInTheDocument()
})

test('선택 건 일괄 제출과 hwpx 내보내기', async () => {
  const user = userEvent.setup()
  const { db, s1, s2, fs } = await setup()
  await screen.findByText('1번 가나')
  await user.click(screen.getByRole('checkbox', { name: '모두 선택' }))
  await user.click(screen.getByRole('button', { name: '선택 제출로 표시' }))
  await waitFor(async () => {
    expect((await listReportsByStudent(db, s1.id))[0].submitted).toBe(true)
    expect((await listReportsByStudent(db, s2.id))[0].submitted).toBe(true)
  })
  await user.click(screen.getByRole('button', { name: '선택 hwpx 한 파일' }))
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['결석신고서_2026-11-09_2명.hwpx']))
  await user.click(screen.getByRole('button', { name: '학생별 zip' }))
  await waitFor(() => expect(fs.downloads.at(-1)!.name).toMatch(/\.zip$/))
})

test('아무것도 고르지 않으면 선택 버튼 줄이 숨고, 위에 "미제출 모두 hwpx"가 있다', async () => {
  const user = userEvent.setup()
  const { fs } = await setup()
  await screen.findByText('1번 가나')
  expect(screen.queryByRole('button', { name: '선택 제출로 표시' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '미제출 2건 한글로 받기' }))
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['결석신고서_2026-11-09_2명.hwpx']))
})

test('학생 이름은 그 신고서 첫날의 출결 화면으로 가는 링크다', async () => {
  await setup()
  expect(await screen.findByRole('link', { name: '1번 가나' })).toHaveAttribute('href', '#/attendance?date=2026-11-09')
})

test('내보내기 메뉴: 보이는 신고서를 엑셀 목록으로', async () => {
  const user = userEvent.setup()
  const { fs } = await setup()
  await screen.findByText('1번 가나')
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['결석신고서_2026-11.xlsx']))
  expect(fs.downloads[0].bytes[0]).toBe(0x50)
})
