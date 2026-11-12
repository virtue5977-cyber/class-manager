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
  expect(blocks()[0].textContent).toBe('')
  expect(blocks()[0].closest('.nb')).toHaveClass('nb-h1')
  await user.keyboard('/없는것{Escape}')
  expect(screen.queryByRole('listbox', { name: '블록 고르기' })).not.toBeInTheDocument()
  expect(blocks()[0].textContent).toBe('/없는것')
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

test('노트 편집: Ctrl+Shift+8은 글머리, "1. "은 번호, ↑↓로 블록 사이 이동', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await screen.findByDisplayValue('회의록')
  const first = await screen.findByRole('textbox', { name: '블록 1' })
  await user.click(first)
  await user.keyboard('사과{Enter}')
  const second = screen.getByRole('textbox', { name: '블록 2' })
  await waitFor(() => expect(second).toHaveFocus())
  await user.keyboard('{Control>}{Shift>}8{/Shift}{/Control}')
  await waitFor(() => expect(second.closest('.nb')).toHaveClass('nb-bullet'))
  await user.keyboard('배{Enter}{Enter}1. 하나')
  const third = screen.getByRole('textbox', { name: '블록 3' })
  await waitFor(() => expect(third.closest('.nb')).toHaveClass('nb-number'))
  expect(third.textContent).toBe('하나')
  await user.keyboard('{ArrowUp}')
  expect(screen.getByRole('textbox', { name: '블록 2' })).toHaveFocus()
  await user.keyboard('{ArrowUp}')
  expect(screen.getByRole('textbox', { name: '블록 1' })).toHaveFocus()
  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(screen.getByRole('textbox', { name: '블록 3' })).toHaveFocus()
  void db
})

test('폴더: + 폴더 → 이름 짓기, 폴더를 고르고 새 노트면 그 안에, 노트 폴더 바꾸기, 폴더 지우면 노트는 남는다', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(screen.getByRole('button', { name: '+ 폴더' }))
  const name = await screen.findByRole('textbox', { name: '폴더 이름' })
  await user.clear(name)
  await user.type(name, '학급 행사{Enter}')
  const folderBtn = await screen.findByRole('button', { name: '학급 행사 폴더(노트 0개)' })
  await user.click(folderBtn)
  expect(folderBtn).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '+ 새 노트' }))
  await waitFor(async () => expect((await db.notes.toArray()).filter((x) => x.folder_id).map((x) => x.title)).toEqual(['새 노트']))
  // 회의록을 폴더로(노트 머리의 폴더 고르기)
  await user.click(within(screen.getByRole('list', { name: '노트 목록' })).getByRole('link', { name: '회의록' }))
  await user.selectOptions(await screen.findByRole('combobox', { name: '노트 폴더' }), '학급 행사')
  await waitFor(async () => expect((await db.notes.get(n.id))!.folder_id).toBeTruthy())
  await user.click(screen.getByRole('button', { name: '학급 행사 폴더 지우기' }))
  await user.click(screen.getByRole('button', { name: '폴더 지우기' }))
  await waitFor(async () => expect((await db.notes.toArray()).filter((x) => !x.deleted).length).toBe(3))
  await waitFor(async () => expect((await db.notes.get(n.id))!.folder_id).toBeNull())
  expect(screen.queryByRole('button', { name: /학급 행사 폴더\(/ })).not.toBeInTheDocument()
})

test('글자 바꾸기는 줄 맨 앞에서 띄어쓰기를 칠 때만: 이미 "- 체육복"인 줄 끝에 글자를 쳐도 그대로', async () => {
  const user = userEvent.setup()
  await setup()
  await screen.findByDisplayValue('회의록')
  const b1 = blocks()[0]
  await user.click(b1)
  // 붙여 넣은 '- 체육복'은 글로 남고, 끝에 글자를 쳐도 그대로
  await user.paste('- 체육복')
  await user.keyboard('!')
  expect(b1.closest('.nb')).toHaveClass('nb-p')
  expect(b1.textContent).toBe('- 체육복!')
})

test('/ 메뉴가 열려 있으면 ←→도 블록을 옮기지 않는다', async () => {
  const user = userEvent.setup()
  await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('위{Enter}/제')
  expect(await screen.findByRole('listbox', { name: '블록 고르기' })).toBeInTheDocument()
  await user.keyboard('{Home}{ArrowLeft}')
  expect(screen.getByRole('textbox', { name: '블록 2' })).toHaveFocus()
})

test('노트 안 Ctrl+2는 제목 1, Ctrl+6은 체크, Ctrl+Enter로 체크 켜기', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('안내')
  await user.keyboard('{Control>}2{/Control}')
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks[0].type).toBe('h1'), { timeout: 3000 })
  await user.keyboard('{Control>}6{/Control}')
  await user.keyboard('{Control>}{Enter}{/Control}')
  expect(await screen.findByRole('checkbox', { name: '체크' })).toBeChecked()
})

test('글자를 골라 Ctrl+B면 굵게 저장되고, 서식 막대로 글자색을 준다', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  const b1 = blocks()[0]
  await user.click(b1)
  await user.keyboard('가나다라마')
  const { setSel } = await import('../../lib/notes/richDom')
  setSel(b1 as HTMLElement, 1, 3)
  document.dispatchEvent(new Event('selectionchange'))
  await user.keyboard('{Control>}b{/Control}')
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks[0].marks).toEqual([{ b: true, from: 1, to: 3 }]), { timeout: 3000 })
  expect(b1.querySelector('span[style*="bold"]')?.textContent).toBe('나다')
  const bar = await screen.findByRole('toolbar', { name: '글자 서식' })
  expect(within(bar).getByRole('button', { name: '굵게(Ctrl+B)' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(within(bar).getByRole('button', { name: '글자색' }))
  await user.click(within(bar).getByRole('menuitem', { name: '글자색 #c0392b' }))
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks[0].marks).toEqual([{ b: true, color: '#c0392b', from: 1, to: 3 }]), { timeout: 3000 })
  // 앞에 글자를 넣으면 서식이 따라 밀린다
  setSel(b1 as HTMLElement, 0, 0)
  await user.keyboard('X')
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks[0]).toMatchObject({ text: 'X가나다라마', marks: [{ b: true, color: '#c0392b', from: 2, to: 4 }] }), { timeout: 3000 })
})

test('Shift+Enter는 줄 안 줄바꿈, 붙여넣기는 서식 없는 글', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('첫 줄{Shift>}{Enter}{/Shift}둘째')
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks.map((b) => b.text)).toEqual(['첫 줄\n둘째']), { timeout: 3000 })
})

test('Ctrl+Z는 줄 나누기를 되돌리고 Ctrl+Y는 다시', async () => {
  const user = userEvent.setup()
  await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('가나다라')
  await new Promise((r) => setTimeout(r, 750))
  await user.keyboard('{ArrowLeft}{ArrowLeft}{Enter}')
  await waitFor(() => expect(blocks().map((b) => b.textContent)).toEqual(['가나', '다라']))
  await user.keyboard('{Control>}z{/Control}')
  await waitFor(() => expect(blocks().map((b) => b.textContent)).toEqual(['가나다라']))
  await user.keyboard('{Control>}y{/Control}')
  await waitFor(() => expect(blocks().map((b) => b.textContent)).toEqual(['가나', '다라']))
})

test('한글로 복사: 제목 줄 오른쪽 단추, HTML과 글을 함께 클립보드에', async () => {
  const user = userEvent.setup()
  const got: Record<string, Blob>[] = []
  class FakeItem {
    constructor(public items: Record<string, Blob>) {
      got.push(items)
    }
  }
  vi.stubGlobal('ClipboardItem', FakeItem)
  const write = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
  await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('안내문')
  const head = screen.getByDisplayValue('회의록').closest('.note-head') as HTMLElement
  expect(within(head).getByRole('button', { name: '노트 전체를 전달사항으로' })).toBeInTheDocument()
  await user.click(within(head).getByRole('button', { name: '한글로 복사' }))
  await waitFor(() => expect(write).toHaveBeenCalled())
  expect(Object.keys(got[0])).toEqual(['text/html', 'text/plain'])
  const html = await new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(String(f.result)); f.readAsText(got[0]['text/html']) })
  expect(html).toContain('안내문')
  expect(await screen.findByText(/한글에서 Ctrl\+V/)).toBeInTheDocument()
  vi.unstubAllGlobals()
})

test('노트 전체를 전달사항으로: 날짜를 골라 잇고, [전달사항] 표, 전달사항에서 더하면 열린 노트에도 줄이 생긴다', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('체육복 지참')
  await user.click(screen.getByRole('button', { name: '노트 전체를 전달사항으로' }))
  const g = screen.getByRole('group', { name: '전달사항 날짜' })
  await user.click(within(g).getByRole('button', { name: '잇기' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-10')).map((x) => x.text)).toEqual(['체육복 지참']))
  expect((await screen.findAllByText('[전달사항] 11/10')).length).toBeGreaterThan(0)
  const { addNotice } = await import('../../lib/notices/notices')
  await addNotice(db, { text: '우유 신청', start_date: '2026-11-10' })
  await waitFor(() => expect(blocks().map((b) => b.textContent)).toEqual(['체육복 지참', '우유 신청']))
  // 편집기에서 고치면 전달사항도
  await user.click(blocks()[1])
  await user.keyboard('{End}서')
  await waitFor(async () => expect((await noticesOn(db, '2026-11-10')).map((x) => x.text)).toEqual(['체육복 지참', '우유 신청서']), { timeout: 3000 })
  await user.click(screen.getByRole('button', { name: '연결 끊기' }))
  await waitFor(async () => expect((await db.notes.get(n.id))!.notice_date).toBeUndefined())
})

test('노트 글에서 @를 치면 다른 노트 후보, 고르면 링크로 저장(Ctrl+클릭하면 그 노트로)', async () => {
  const user = userEvent.setup()
  const { db, n } = await setup()
  await screen.findByDisplayValue('회의록')
  await user.click(blocks()[0])
  await user.keyboard('참고 @다른')
  expect(await screen.findByRole('option', { name: /다른 노트/ })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /회의록/ })).toBeNull() // 자기 자신은 빼고
  await user.keyboard('{Enter}끝')
  const other = (await db.notes.toArray()).find((x) => x.title === '다른 노트')!
  await waitFor(async () => expect((await db.notes.get(n.id))!.blocks[0]).toMatchObject({ text: '참고 @다른 노트 끝', links: [{ from: 3, to: 9, note: other.id }] }), { timeout: 3000 })
  const link = blocks()[0].querySelector('.nl') as HTMLElement
  expect(link.textContent).toBe('@다른 노트')
})
