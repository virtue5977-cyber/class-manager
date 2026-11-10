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
  await waitFor(async () => expect((await noticesOn(db, '2026-11-10')).map((x) => x.text)).toEqual(['체육복 지참']))
})

test('폴더 블록: 옛 exe·HTML판이면 새 exe 안내', async () => {
  const user = userEvent.setup()
  await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('/폴')
  await user.keyboard('{Enter}')
  expect(await screen.findByText('폴더 연결은 새 Watson exe에서만 됩니다.')).toBeInTheDocument()
})
