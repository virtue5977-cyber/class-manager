import { createDb } from '../db/schema'
import { attachFile, createNote, deleteNote, listNotes, readFile, saveNote, MAX_FILE } from './notes'

test('노트 만들기·고정 먼저·첨부 읽기·50MB 넘으면 거절·지우면 첨부도', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const a = await createNote(db, '가')
  const b = await createNote(db, '나')
  await saveNote(db, { ...a, pinned: true })
  expect((await listNotes(db)).map((n) => n.title)).toEqual(['가', '나'])
  const f = await attachFile(db, b.id, { name: '공문.hwpx', mime: 'application/hwp+zip', bytes: new Uint8Array([80, 75, 3, 4]) })
  expect((await readFile(db, f.id)).bytes).toEqual(new Uint8Array([80, 75, 3, 4]))
  expect(MAX_FILE).toBe(50 * 1024 * 1024)
  await expect(attachFile(db, b.id, { name: 'big', mime: '', bytes: { length: MAX_FILE + 1 } as Uint8Array })).rejects.toThrow('50MB까지 붙일 수 있습니다.')
  await deleteNote(db, b.id)
  expect((await db.note_files.toArray()).filter((x) => !x.deleted)).toEqual([])
})
