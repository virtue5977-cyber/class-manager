import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent, setCurrentClassId } from '../../lib/roster/roster'
import CommandBar from './CommandBar'
import ChatLog from './ChatLog'
import WButton from './WButton'

async function setup(path = '/') {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  const s3 = await saveStudent(db, c.id, emptyStudent(3, '박도윤'))
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <Routes>
          <Route path="/" element={<><ChatLog today="2026-11-10" onRun={() => {}} /><CommandBar today="2026-11-10" /></>} />
          <Route path="*" element={<WButton />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  )
  return { db, s3 }
}

test('키보드만으로 /출결 → 카드·되돌리기·저장', async () => {
  const user = userEvent.setup()
  const { db, s3 } = await setup()
  const input = await screen.findByRole('combobox', { name: '명령 입력' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, '/출')
  expect(await screen.findByRole('option', { name: /\/출결/ })).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(input).toHaveValue('/출결 ')
  await user.type(input, '@ㅂㄷ')
  await user.keyboard('{Enter}')
  await user.type(input, '결석 질병 감기')
  expect(screen.getByRole('status')).toHaveTextContent('출결 · 3번 박도윤 · 11/10(화) · 결석(질병) · 사유: 감기')
  await user.keyboard('{Escape}{Enter}')
  const card = await screen.findByRole('article', { name: '결과' })
  expect(card).toHaveTextContent('3번 박도윤')
  expect(within(card).getByRole('button', { name: /되돌리기 \d+초/ })).toBeInTheDocument()
  expect(within(card).getByRole('link', { name: '출결 보기' })).toHaveAttribute('href', '/attendance?date=2026-11-10')
  await waitFor(async () => expect((await db.attendance.toArray()).filter((a) => a.student_id === s3.id)).toHaveLength(1))
  expect(input).toHaveValue('')
})

test('한글 조합 중 Enter는 실행하지 않는다', async () => {
  const { db } = await setup()
  const input = await screen.findByRole('combobox', { name: '명령 입력' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: '/찾기 감기' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  await new Promise((r) => setTimeout(r, 100))
  expect(await db.chat_log.count()).toBe(0)
})

test('다른 화면의 W: 누르면 입력 칸, Esc로 접힘', async () => {
  const user = userEvent.setup()
  await setup('/calendar')
  await user.click(await screen.findByRole('button', { name: /명령 입력 열기/ }))
  const input = await screen.findByRole('combobox', { name: '명령 입력' })
  await waitFor(() => expect(input).toHaveFocus())
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('combobox', { name: '명령 입력' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /명령 입력 열기/ })).toBeInTheDocument()
})
