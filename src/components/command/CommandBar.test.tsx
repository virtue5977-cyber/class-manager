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
  await waitFor(() => expect(screen.queryByRole('combobox', { name: '명령 입력' })).not.toBeInTheDocument())
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

test("'/'만 치거나 명령 이름을 치는 중에는 빨간 오류 대신 고르기 안내", async () => {
  const user = userEvent.setup()
  await setup()
  const input = await screen.findByRole('combobox', { name: '명령 입력' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, '/')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('↑↓로 고르고 Enter')).toBeInTheDocument()
  await user.type(input, '없는명령 ')
  expect(await screen.findByRole('alert')).toHaveTextContent("'/없는명령' 명령을 모릅니다")
})

test('다른 곳을 누르면 자동완성이 닫히고, 다시 들어오면 열린다', async () => {
  const user = userEvent.setup()
  await setup()
  const input = await screen.findByRole('combobox', { name: '명령 입력' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, '/')
  expect(screen.getByRole('listbox', { name: '자동완성' })).toBeInTheDocument()
  await user.click(document.body)
  expect(screen.queryByRole('listbox', { name: '자동완성' })).toBeNull()
  await user.click(input)
  expect(screen.getByRole('listbox', { name: '자동완성' })).toBeInTheDocument()
})

test('Ctrl+Z(입력 칸이 비었을 때): 방금 실행한 명령을 되돌린다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  const input = await screen.findByRole('combobox', { name: '명령 입력' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: '/할일 회신하기' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(async () => expect((await db.todos.toArray()).filter((t) => !t.deleted)).toHaveLength(1))
  expect(input).toHaveValue('')
  await user.click(input)
  await user.keyboard('{Control>}z{/Control}')
  await waitFor(async () => expect((await db.todos.toArray()).filter((t) => !t.deleted)).toHaveLength(0))
  expect(await screen.findByText(/되돌렸습니다/)).toBeInTheDocument()
})

test('보내면 입력 칸이 바로 비고 내 말이 올라가며, 대답 동안 ● ● ●가 보인다', async () => {
  const { updateSettings } = await import('../../lib/settings')
  ;(await import('../../lib/command/pending')).resetPending()
  let release!: (v: string) => void
  const ai = () => new Promise<string>((r) => (release = r))
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  await updateSettings(db, { ai_enabled: true })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()} ai={ai}>
        <ChatLog today="2026-11-10" onRun={() => {}} />
        <CommandBar today="2026-11-10" />
      </AppProviders>
    </MemoryRouter>,
  )
  const user = userEvent.setup()
  const input = await screen.findByRole('combobox', { name: '명령 입력' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.type(input, '오늘 할 일 알려줘{Enter}')
  expect(input).toHaveValue('')
  const log = screen.getByRole('region', { name: '대화 기록' })
  expect(within(log).getByText('오늘 할 일 알려줘')).toBeInTheDocument()
  expect(await within(log).findByRole('status', { name: '대답을 만드는 중' })).toBeInTheDocument()
  release(JSON.stringify({ answer: '할 일이 없습니다.' }))
  expect(await within(log).findByText(/할 일이 없습니다/)).toBeInTheDocument()
  await waitFor(() => expect(within(log).queryByRole('status', { name: '대답을 만드는 중' })).toBeNull())
  expect(within(log).getAllByText('오늘 할 일 알려줘')).toHaveLength(1)
})

test('W 창: 바깥을 누르면 두루마리처럼 말려 닫힌다(닫히는 동안 closing)', async () => {
  const user = userEvent.setup()
  await setup('/calendar')
  await user.click(screen.getByRole('button', { name: '명령 입력 열기(Ctrl+K)' }))
  expect(await screen.findByRole('combobox', { name: '명령 입력' })).toBeInTheDocument()
  fireEvent.mouseDown(document.body)
  expect(document.querySelector('.w-panel')).toHaveClass('closing')
  await waitFor(() => expect(screen.queryByRole('combobox', { name: '명령 입력' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '명령 입력 열기(Ctrl+K)' })).toBeInTheDocument()
})
