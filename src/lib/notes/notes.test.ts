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

test('편집 저장은 최신 노트에 제목·블록만 바꾸고, 지운 노트는 되살리지 않는다', async () => {
  const { saveNoteContent } = await import('./notes')
  const db = createDb('test-' + crypto.randomUUID())
  const n = await createNote(db, '가')
  await saveNote(db, { ...n, pinned: true })
  await saveNoteContent(db, n.id, { title: '나', blocks: [] })
  expect(await db.notes.get(n.id)).toMatchObject({ title: '나', pinned: true })
  await deleteNote(db, n.id)
  await saveNoteContent(db, n.id, { title: '다', blocks: [] })
  expect(await db.notes.get(n.id)).toMatchObject({ title: '', deleted: true }) // 지우면 글을 비우고, 그 뒤 저장도 되살리지 않음
})

test('노트를 지우거나 파일 블록을 빼면 첨부 내용은 비운다(백업이 커지지 않게)', async () => {
  const { saveNoteContent } = await import('./notes')
  const db = createDb('test-' + crypto.randomUUID())
  const n = await createNote(db, '가')
  const f1 = await attachFile(db, n.id, { name: 'a', mime: '', bytes: new Uint8Array([1, 2, 3]) })
  const f2 = await attachFile(db, n.id, { name: 'b', mime: '', bytes: new Uint8Array([4]) })
  await saveNoteContent(db, n.id, { title: '가', blocks: [{ id: 'x', type: 'file', file_id: f1.id }] })
  expect((await db.note_files.get(f2.id))!.deleted).toBe(false) // 막 붙인 파일은 1분 기다림
  await saveNoteContent(db, n.id, { title: '가', blocks: [{ id: 'x', type: 'file', file_id: f1.id }] }, Date.now() + 61_000)
  expect(await db.note_files.get(f2.id)).toMatchObject({ deleted: true, data: '' })
  expect((await db.note_files.get(f1.id))!.data).not.toBe('')
  await deleteNote(db, n.id)
  expect(await db.note_files.get(f1.id)).toMatchObject({ deleted: true, data: '' })
})

test('첨부는 모두 합쳐 MAX_TOTAL까지(지운 첨부는 빼고 센다)', async () => {
  const { MAX_TOTAL } = await import('./notes')
  expect(MAX_TOTAL).toBe(500 * 1024 * 1024)
  const db = createDb('test-' + crypto.randomUUID())
  const n = await createNote(db)
  const big = (size: number) => ({ name: 'x', mime: '', size, data: '', note_id: n.id })
  const { newRecord } = await import('../db/records')
  for (let i = 0; i < 10; i++) await db.note_files.add(newRecord(big(49 * 1024 * 1024)) as never)
  await expect(attachFile(db, n.id, { name: 'c', mime: '', bytes: { length: 20 * 1024 * 1024 } as Uint8Array })).rejects.toThrow('첨부 파일은 모두 합쳐 500MB까지')
  const one = (await db.note_files.toArray())[0]
  await db.note_files.update(one.id, { deleted: true })
  await expect(attachFile(db, n.id, { name: 'c', mime: '', bytes: new Uint8Array(3) })).resolves.toBeTruthy()
})
