import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { createDb } from './lib/db/schema'
import { createMemoryFsAdapter } from './lib/fs/memory'
import { AppProviders } from './app/context'
import { createClass, setCurrentClassId } from './lib/roster/roster'
import { AppRoutes } from './App'

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}

async function renderAt(path: string) {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <AppRoutes />
        <Where />
      </AppProviders>
    </MemoryRouter>,
  )
}

test('옛 /reports 주소는 쿼리를 지닌 채 출결 > 결석신고서로 간다', async () => {
  await renderAt('/reports?x=1')
  expect(await screen.findByRole('heading', { name: '결석신고서' })).toBeInTheDocument()
  expect(screen.getByTestId('where')).toHaveTextContent('/attendance/reports?x=1')
})

test('옛 /stats 는 출결 > 통계', async () => {
  await renderAt('/stats')
  expect(await screen.findByRole('heading', { name: '통계' })).toBeInTheDocument()
})

test('/class 는 명단으로 넘어간다', async () => {
  await renderAt('/class')
  await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/class/roster'))
  expect(await screen.findByRole('heading', { name: '명단' })).toBeInTheDocument()
})

test('/class/seating 은 자리배치 화면', async () => {
  await renderAt('/class/seating')
  expect(await screen.findByRole('button', { name: '무작위 배치' })).toBeInTheDocument()
})

test('/class/reflection 은 준비 중 안내', async () => {
  await renderAt('/class/reflection')
  expect(await screen.findByText(/반성문은 다음 업데이트에서/)).toBeInTheDocument()
})
