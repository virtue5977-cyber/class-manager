import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../lib/db/schema'
import { createMemoryFsAdapter } from '../lib/fs/memory'
import { AppProviders } from '../app/context'
import { createClass, emptyStudent, saveStudent, setCurrentClassId } from '../lib/roster/roster'
import { saveLog } from '../lib/counseling/counseling'
import { updateSettings } from '../lib/settings'
import Sidebar from './Sidebar'

async function renderAt(path: string) {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  await updateSettings(db, { school_name: '가상중학교' })
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <Sidebar />
      </AppProviders>
    </MemoryRouter>,
  )
}

test('출결 하위 화면에 있으면 결석신고서·통계가 펼쳐지고 학급 하위는 접힌다', async () => {
  await renderAt('/attendance/stats')
  const nav = screen.getByRole('navigation', { name: '메뉴' })
  expect(within(nav).getByRole('link', { name: '결석신고서' })).toHaveAttribute('href', '/attendance/reports')
  expect(within(nav).getByRole('link', { name: '통계' })).toBeInTheDocument()
  expect(within(nav).queryByRole('link', { name: '명단' })).not.toBeInTheDocument()
})

test('학급 하위 화면에선 명단·명렬표·자리배치·청소배치·반성문이 보인다', async () => {
  await renderAt('/class/sheet')
  const nav = screen.getByRole('navigation', { name: '메뉴' })
  for (const n of ['명단', '명렬표', '자리배치', '청소배치', '반성문']) expect(within(nav).getByRole('link', { name: n })).toBeInTheDocument()
})

test('맨 위에 Watson·학교명·학년도 반, 맨 아래 버전이 있고 이름 가림 버튼은 없다', async () => {
  await renderAt('/')
  expect(screen.getByText('Watson')).toBeInTheDocument()
  expect(await screen.findByText('가상중학교')).toBeInTheDocument()
  expect(await screen.findByText('2026학년도 1학년 5반')).toBeInTheDocument()
  expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /이름 보임|이름 가림/ })).not.toBeInTheDocument()
})

test('미정리 상담이 있으면 누가기록 옆에 숫자가 붙는다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  const s = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  await saveLog(db, { student_id: s.id, date: '2026-11-03', place: '', content: '메모' })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <Sidebar />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('link', { name: '누가기록, 미정리 1건' })).toBeInTheDocument()
})
