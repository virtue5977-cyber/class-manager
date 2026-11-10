import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createNote } from '../../lib/notes/notes'
import { addTodo } from '../../lib/todos/todos'
import { noticesOn } from '../../lib/notices/notices'
import NotesPage from './NotesPage'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const n = await createNote(db, '회의록')
  await createNote(db, '다른 노트')
  await addTodo(db, ['회신 ', { note: n.id }])
  render(
    <MemoryRouter initialEntries={[`/notes?id=${n.id}`]}>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <NotesPage today="2026-11-10" />
      </AppProviders>
    </MemoryRouter>,
  )
  return { db, n }
}
const blocks = () => screen.getAllByRole('textbox', { name: /블록/ })

test('목록·열린 노트·가리키는 할 일', async () => {
  await setup()
  const list = await screen.findByRole('list', { name: '노트 목록' })
  await waitFor(() => expect(within(list).getAllByRole('link').map((a) => a.textContent)).toEqual(expect.arrayContaining(['회의록', '다른 노트'])))
  expect(await screen.findByDisplayValue('회의록')).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: '이 노트를 가리키는 할 일' })).toHaveTextContent('회신')
})

test('/ 메뉴로 체크 목록 만들고, Enter로 다음 체크 블록', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('/체')
  expect(await screen.findByRole('option', { name: /체크 목록/ })).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('checkbox', { name: '체크' })).toBeInTheDocument()
  await user.keyboard('동의서{Enter}회신')
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks.map((b) => [b.type, b.text])).toEqual([['check', '동의서'], ['check', '회신']]), { timeout: 3000 })
})

test('파일을 놓으면 파일 블록, 50MB 넘으면 오류', async () => {
  await setup()
  await screen.findByDisplayValue('회의록')
  const editor = screen.getByRole('region', { name: '노트 편집' })
  const small = new File([new Uint8Array([1, 2, 3])], '공문.hwpx', { type: 'application/hwp+zip' })
  fireEvent.drop(editor, { dataTransfer: { files: [small], types: ['Files'] } })
  expect(await screen.findByRole('button', { name: /공문\.hwpx/ })).toBeInTheDocument()
  const big = new File([new Uint8Array([1])], '큰파일.mp4')
  Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 })
  fireEvent.drop(editor, { dataTransfer: { files: [big], types: ['Files'] } })
  expect(await screen.findByText('50MB까지 붙일 수 있습니다.')).toBeInTheDocument()
})

test('블록 메뉴: 전달사항으로 보내기', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('체육복 지참')
  await user.click(screen.getAllByRole('button', { name: '블록 메뉴' })[0])
  await user.click(screen.getByRole('menuitem', { name: '전달사항으로 보내기' }))
  await user.click(within(screen.getByRole('group', { name: '전달사항 기간' })).getByRole('button', { name: '보내기' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-10')).map((x) => x.text)).toEqual(['체육복 지참']))
})

test('폴더 블록: 옛 exe·HTML판이면 새 exe 안내', async () => {
  const user = userEvent.setup()
  await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('/폴')
  await user.keyboard('{Enter}')
  expect(await screen.findByText('폴더 연결은 새 설치형(Windows 앱)에서만 됩니다.')).toBeInTheDocument()
})

test('개요: 번호 목록에서 Tab이면 한 칸 들어가 "가."로', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('/번호')
  await user.keyboard('{Enter}')
  await user.keyboard('목적{Enter}')
  await user.keyboard('{Tab}세부')
  expect(screen.getByText('가.')).toBeInTheDocument()
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks.map((b) => [b.type, b.text, b.indent ?? 0])).toEqual([['number', '목적', 0], ['number', '세부', 1]]), { timeout: 3000 })
})

test('/ 메뉴는 띄어쓴 이름(제목 1)도 거르고, Esc로 닫으면 글로 남는다', async () => {
  const user = userEvent.setup()
  await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('/제목 1')
  expect(await screen.findByRole('option', { name: '제목 1' })).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(blocks()[0]).toHaveValue('')
  expect(blocks()[0].closest('.nb')).toHaveClass('nb-h1')
  await user.keyboard('/없는것{Escape}')
  expect(screen.queryByRole('listbox', { name: '블록 고르기' })).not.toBeInTheDocument()
  expect(blocks()[0]).toHaveValue('/없는것')
})

test('노트 지우기는 한 번 더 묻는다', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  const list = await screen.findByRole('list', { name: '노트 목록' })
  await user.click(await within(list).findByRole('button', { name: '회의록 지우기' }))
  expect(await db.notes.get(n.id)).toMatchObject({ deleted: false })
  await user.click(screen.getByRole('button', { name: '정말 지우기' }))
  await waitFor(async () => expect((await db.notes.get(n.id))!.deleted).toBe(true))
})

test('블록·노트 전체를 기간을 정해 전달사항으로', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('체육복 지참')
  await user.click(screen.getAllByRole('button', { name: '블록 메뉴' })[0])
  await user.click(screen.getByRole('menuitem', { name: '전달사항으로 보내기' }))
  const dlg = screen.getByRole('group', { name: '전달사항 기간' })
  await user.clear(within(dlg).getByLabelText('끝'))
  await user.type(within(dlg).getByLabelText('끝'), '2026-11-12')
  await user.click(within(dlg).getByRole('button', { name: '보내기' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-12')).map((x) => x.text)).toEqual(['체육복 지참']))
})

test('블록 메뉴는 Esc나 바깥을 누르면 닫히고, Esc면 손잡이로 초점이 돌아간다', async () => {
  const user = userEvent.setup()
  await setup()
  await screen.findByDisplayValue('회의록')
  const handle = screen.getAllByRole('button', { name: '블록 메뉴' })[0]
  await user.click(handle)
  expect(screen.getByRole('menu')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(handle).toHaveFocus()
  await user.click(handle)
  expect(screen.getByRole('menu')).toBeInTheDocument()
  await user.click(screen.getByRole('list', { name: '노트 목록' }))
  expect(screen.queryByRole('menu')).toBeNull()
})

test('@명렬표 + Enter → 학생 체크 표(제목·체크 저장), 노트 안 단축키 Ctrl+Alt+1 제목', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const { createClass, emptyStudent, saveStudent, setCurrentClassId } = await import('../../lib/roster/roster')
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  await saveStudent(db, c.id, emptyStudent(1, '가나'))
  await saveStudent(db, c.id, emptyStudent(2, '다라'))
  const n = await createNote(db, '동의서')
  render(
    <MemoryRouter initialEntries={[`/notes?id=${n.id}`]}>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <NotesPage today="2026-11-10" />
      </AppProviders>
    </MemoryRouter>,
  )
  const first = (await screen.findAllByRole('textbox', { name: /블록/ }))[0]
  await user.click(first)
  await user.type(first, '@명렬표{Enter}')
  const table = await screen.findByRole('table', { name: '학생 체크 표' })
  await user.type(within(table).getByLabelText('표 제목'), '동의서 제출')
  await user.click(within(table).getByRole('checkbox', { name: '1번 가나 체크' }))
  expect(within(table).getByText('1 / 2')).toBeInTheDocument()
  await waitFor(async () => {
    const b = (await db.notes.get(n.id))!.blocks.find((x) => x.type === 'roster')!
    expect(b.text).toBe('동의서 제출')
    expect(b.rows!.map((r) => [r.label, r.checked])).toEqual([['1번 가나', true], ['2번 다라', false]])
  }, { timeout: 3000 })
  const after = screen.getAllByRole('textbox', { name: /블록/ }).at(-1)!
  await user.click(after)
  await user.type(after, '안내')
  await user.keyboard('{Control>}{Alt>}1{/Alt}{/Control}')
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks.some((x) => x.type === 'h1' && x.text === '안내')).toBe(true), { timeout: 3000 })
})
