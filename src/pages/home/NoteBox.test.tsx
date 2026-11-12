import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProviders } from '../../app/context'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { createNote, listNotes, saveNoteContent } from '../../lib/notes/notes'
import { noticesOn } from '../../lib/notices/notices'
import { openNoticeNote } from '../../lib/notices/noteSync'
import { useLive } from '../../lib/ui/useLive'
import NoteBox from './NoteBox'
import type { AppDB } from '../../lib/db/schema'

const D = '2026-11-12'
function Live({ db }: { db: AppDB }) {
  const notes = useLive(() => listNotes(db), [db], [])
  return <NoteBox notes={notes} today={D} />
}
const show = (db: AppDB) =>
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <Live db={db} />
      </AppProviders>
    </MemoryRouter>,
  )

test('홈 노트함: 마우스 올리면 전달사항으로 지정·해제, 표는 [전달 11/12], 제목 앞 [전달사항]은 빼고 보임', async () => {
  const user = userEvent.setup()
  const db = createDb('t-' + crypto.randomUUID())
  const n = await createNote(db, '체육대회 안내')
  await saveNoteContent(db, n.id, { title: '체육대회 안내', blocks: [{ id: 'a', type: 'p', text: '체육복 지참' }] })
  show(db)
  await user.click(await screen.findByRole('button', { name: '체육대회 안내 전달사항으로' }))
  await waitFor(async () => expect((await noticesOn(db, D)).map((x) => x.text)).toEqual(['체육복 지참']))
  expect(await screen.findByText('[전달 11/12]')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '체육대회 안내 전달사항에서 빼기' }))
  await waitFor(async () => expect((await db.notes.get(n.id))!.notice_date).toBeUndefined())
})

test('홈 노트함: 오늘 짝 노트가 이미 있으면 합치기·바꾸기를 묻는다', async () => {
  const user = userEvent.setup()
  const db = createDb('t-' + crypto.randomUUID())
  const old = await openNoticeNote(db, D)
  const n = await createNote(db, '새 안내')
  await saveNoteContent(db, n.id, { title: '새 안내', blocks: [{ id: 'a', type: 'p', text: '우유' }] })
  show(db)
  expect(await screen.findByText('11/12(목)')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: '새 안내 전달사항으로' }))
  await user.click(screen.getByRole('button', { name: '바꾸기' }))
  await waitFor(async () => expect((await db.notes.get(n.id))!.notice_date).toBe(D))
  expect((await db.notes.get(old.id))!.notice_date).toBeUndefined()
})
