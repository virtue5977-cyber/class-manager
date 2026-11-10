import { vi } from 'vitest'
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
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  await user.type(input, '@ㅂㄷ', { skipClick: true })
  await user.keyboard('{Enter}')
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  await user.type(input, '결석 질병 감기', { skipClick: true })
  expect(input).toHaveValue('/출결 @박도윤 결석 질병 감기')
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

test('대화 기록 끝으로 스크롤해도(Promise를 돌려주는 브라우저) 화면이 깨지지 않는다', async () => {
  const orig = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function () {
    return Promise.resolve() as unknown as void
  }
  try {
    const user = userEvent.setup()
    await setup()
    const input = await screen.findByRole('combobox', { name: '명령 입력' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, '/노트 회의록')
    await user.keyboard('{Escape}{Enter}')
    expect(await screen.findByRole('article', { name: '결과' })).toHaveTextContent('회의록')
    await user.type(input, '/노트 두번째')
    await user.keyboard('{Escape}{Enter}')
    await waitFor(() => expect(screen.getAllByRole('article', { name: '결과' })).toHaveLength(2))
  } finally {
    Element.prototype.scrollIntoView = orig
  }
})

test('W 막대의 확인 카드 "이렇게 실행"은 그 명령을 실행한다', async () => {
  const { remember } = await import('./session')
  const { appendChat } = await import('../../lib/command/chatLog')
  const { ResultCardRunner } = await import('./WButton')
  const { db } = await setup('/calendar')
  const chat = await appendChat(db, { input: '내일 3번 지각', mode: 'ai', summary: '이렇게 실행할까요?', links: [], status: '확인 필요' })
  remember(chat.id, { summary: '', links: [], card: { kind: 'confirm', data: { command: '/할일 동의서 걷기', preview: '할일' } } })
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <ResultCardRunner chat={chat} />
      </AppProviders>
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: '이렇게 실행' }))
  await waitFor(async () => expect((await db.todos.toArray()).length).toBe(1))
})

test('글을 치는 동안에는 커서를 옮기지 않는다(한글 조합 보호)', async () => {
  await setup()
  const input = (await screen.findByRole('combobox', { name: '명령 입력' })) as HTMLInputElement
  await waitFor(() => expect(input).toBeEnabled())
  const spy = vi.spyOn(input, 'setSelectionRange')
  fireEvent.change(input, { target: { value: '/찾기 가' } })
  await new Promise((r) => setTimeout(r, 50))
  expect(spy).not.toHaveBeenCalled()
})
