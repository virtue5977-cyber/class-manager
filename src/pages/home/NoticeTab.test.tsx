import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { addNotice, noticesOn } from '../../lib/notices/notices'
import { listNotes } from '../../lib/notes/notes'
import { updateSettings } from '../../lib/settings'
import { pickExport } from '../../test/exportMenu'
import NoticeTab from './NoticeTab'

async function setup(ai?: () => Promise<string>) {
  const db = createDb('test-' + crypto.randomUUID())
  const fs = createMemoryFsAdapter()
  await addNotice(db, { text: '동의서 걷기', start_date: '2026-11-10', end_date: '2026-11-12' })
  await addNotice(db, { text: '체육복', start_date: '2026-11-11' })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={fs} ai={ai}>
        <NoticeTab date="2026-11-11" />
      </AppProviders>
    </MemoryRouter>,
  )
  return { db, fs }
}
const rows = () => within(screen.getByRole('list', { name: '전달사항 목록' })).getAllByRole('listitem')

test('기간 안 항목이 보이고, 고정하면 맨 위, 체크·지우기·되돌리기', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await waitFor(() => expect(rows().map((r) => (r.querySelector('textarea.notice-text') as HTMLTextAreaElement | null)?.value)).toEqual(['동의서 걷기', '체육복']))
  expect(within(rows()[0]).getByText('11/10~11/12')).toBeInTheDocument()
  await user.click(within(rows()[1]).getByRole('button', { name: '체육복 고정' }))
  await waitFor(() => expect(rows()[0].querySelector('textarea.notice-text')).toHaveValue('체육복'))
  await user.click(within(rows()[1]).getByRole('checkbox', { name: '동의서 걷기 완료' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).find((n) => n.text === '동의서 걷기')!.done).toBe(true))
  await user.click(within(rows()[0]).getByRole('button', { name: '체육복 지우기' }))
  await waitFor(() => expect(rows()).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: /되돌리기/ }))
  await waitFor(() => expect(rows()).toHaveLength(2))
})

test('+ 추가 → 빈 줄에 쓰고 Enter면 저장되고 다음 빈 줄로, 빈 줄은 떠나면 사라진다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await waitFor(() => expect(rows()).toHaveLength(2))
  expect(screen.queryByLabelText('새 전달사항')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '+ 추가' }))
  const draft = screen.getByRole('textbox', { name: '새 전달사항 줄' })
  expect(draft).toHaveFocus()
  await user.keyboard('우산{Enter}')
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).map((n) => n.text)).toContain('우산'))
  const next = screen.getByRole('textbox', { name: '새 전달사항 줄' })
  expect(next).toHaveFocus()
  expect(next).toHaveValue('')
  await user.click(document.body)
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '새 전달사항 줄' })).not.toBeInTheDocument())
  expect((await noticesOn(db, '2026-11-11')).length).toBe(3)
})

test('줄에서 Enter는 저장하고 다음 줄로, 마지막 줄이면 새 빈 줄. ↑↓로 줄 사이를 오간다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await waitFor(() => expect(rows()).toHaveLength(2))
  const first = screen.getByRole('textbox', { name: '1번 내용' })
  await user.click(first)
  await user.keyboard('{End} 꼭{Enter}')
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).map((n) => n.text)).toContain('동의서 걷기 꼭'))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '2번 내용' })).toHaveFocus())
  await user.keyboard('{ArrowUp}')
  await waitFor(() => expect(screen.getByRole('textbox', { name: '1번 내용' })).toHaveFocus())
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() => expect(screen.getByRole('textbox', { name: '새 전달사항 줄' })).toHaveFocus())
})

test('노트로 열기 → 이날 짝 노트(체크 줄), 내보내기 엑셀', async () => {
  const user = userEvent.setup()
  const { db, fs } = await setup()
  await waitFor(() => expect(rows()).toHaveLength(2))
  await user.click(screen.getByRole('button', { name: '노트로 열기' }))
  await waitFor(async () => expect((await listNotes(db, '2026-11-11'))[0]).toMatchObject({ title: '[전달사항] 11/11(수)', notice_date: '2026-11-11' }))
  expect((await listNotes(db, '2026-11-11'))[0].blocks.map((b) => [b.type, b.text])).toEqual([['check', '체육복']]) // 여러 날 전달사항(동의서 걷기)은 노트에 넣지 않는다
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['전달사항_2026-11-11.xlsx']))
})

test('붙여넣어 AI로 나누기 → 항목 추가', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { ai_enabled: true })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{"조례":["강당 집합"],"종례":["체육복"]}'}>
        <NoticeTab date="2026-11-11" />
      </AppProviders>
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: '가져오기(붙여넣어 AI로 나누기)' }))
  await user.type(screen.getByLabelText('붙여 넣을 글'), '공지 글')
  await user.click(screen.getByRole('button', { name: 'AI로 나누기' }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).map((n) => n.text)).toEqual(['강당 집합', '체육복']))
})

test('저장된 줄을 다 지우고 떠나면 그 줄을 없애고(되돌리기 있음), 한글 조합 중(229) 방향키·Enter는 줄을 옮기지 않는다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await waitFor(() => expect(rows()).toHaveLength(2))
  const second = screen.getByRole('textbox', { name: '2번 내용' })
  fireEvent.keyDown(second, { key: 'ArrowUp', keyCode: 229 })
  fireEvent.keyDown(second, { key: 'Enter', keyCode: 229 })
  expect(screen.queryByRole('textbox', { name: '새 전달사항 줄' })).not.toBeInTheDocument()
  await user.clear(second)
  await user.click(document.body)
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).map((n) => n.text)).toEqual(['동의서 걷기']))
  expect(screen.getByRole('button', { name: /되돌리기/ })).toBeInTheDocument()
})

test('머리 아이콘의 전체 지우기: 한 번 더 묻고, 되돌리기로 모두 돌아온다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await waitFor(() => expect(rows()).toHaveLength(2))
  await user.click(screen.getByRole('button', { name: '전체 지우기' }))
  await user.click(screen.getByRole('button', { name: '모두 지우기' }))
  await waitFor(async () => expect(await noticesOn(db, '2026-11-11')).toEqual([]))
  await user.click(screen.getByRole('button', { name: /되돌리기/ }))
  await waitFor(async () => expect((await noticesOn(db, '2026-11-11')).length).toBe(2))
})
