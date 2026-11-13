import type { AppDB } from '../db/schema'
import { createDb } from '../db/schema'
import { attachFile, createNote, deleteNote, listNotes, readFile, saveNote, MAX_FILE } from './notes'

/** 첨부 내용이 남아 있는가(평문 DB: data 칸, 암호화 DB: note_blobs 행) */
const hasContent = async (db: AppDB, id: string) => (db.isVault ? !!(await db.note_blobs.get(id)) : (await db.note_files.get(id))!.data !== '')

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

test('파일 블록을 빼고 저장해도 첨부는 남는다(되돌리기·다른 노트에 붙여넣기). 노트를 지우면 비운다', async () => {
  const { saveNoteContent } = await import('./notes')
  const db = createDb('test-' + crypto.randomUUID())
  const n = await createNote(db, '가')
  const f1 = await attachFile(db, n.id, { name: 'a', mime: '', bytes: new Uint8Array([1, 2, 3]) })
  const f2 = await attachFile(db, n.id, { name: 'b', mime: '', bytes: new Uint8Array([4]) })
  await saveNoteContent(db, n.id, { title: '가', blocks: [{ id: 'x', type: 'file', file_id: f1.id }] }, Date.now() + 86_400_000)
  expect(await hasContent(db, f2.id)).toBe(true)
  await deleteNote(db, n.id)
  expect(await db.note_files.get(f1.id)).toMatchObject({ deleted: true })
  expect(await hasContent(db, f1.id)).toBe(false)
})

test('앱을 켤 때: 어느 노트에서도 안 쓰고 하루 지난 첨부만 비운다', async () => {
  const { cleanupOrphanFiles } = await import('./notes')
  const db = createDb('test-' + crypto.randomUUID())
  const a = await createNote(db, '가')
  const b = await createNote(db, '나')
  const used = await attachFile(db, a.id, { name: 'u', mime: '', bytes: new Uint8Array([1]) })
  const moved = await attachFile(db, a.id, { name: 'm', mime: '', bytes: new Uint8Array([2]) })
  const orphan = await attachFile(db, a.id, { name: 'o', mime: '', bytes: new Uint8Array([3]) })
  const fresh = await attachFile(db, a.id, { name: 'f', mime: '', bytes: new Uint8Array([4]) })
  await db.notes.update(a.id, { blocks: [{ id: '1', type: 'image', file_id: used.id }] })
  // 다른 노트로 잘라 붙인 그림
  await db.notes.update(b.id, { blocks: [{ id: '2', type: 'image', file_id: moved.id }] })
  const later = Date.parse(fresh.created_at) + 86_400_000 + 1
  await db.note_files.update(fresh.id, { created_at: new Date(later - 1000).toISOString() })
  expect(await cleanupOrphanFiles(db, later)).toBe(1)
  expect(await hasContent(db, used.id)).toBe(true)
  expect(await hasContent(db, moved.id)).toBe(true)
  expect(await hasContent(db, fresh.id)).toBe(true)
  expect(await db.note_files.get(orphan.id)).toMatchObject({ deleted: true })
  expect(await hasContent(db, orphan.id)).toBe(false)
})

test('첨부는 모두 합쳐 MAX_TOTAL까지(지운 첨부는 빼고 센다)', async () => {
  const { MAX_TOTAL } = await import('./notes')
  expect(MAX_TOTAL).toBe(150 * 1024 * 1024)
  const db = createDb('test-' + crypto.randomUUID())
  const n = await createNote(db)
  const big = (size: number) => ({ name: 'x', mime: '', size, data: '', note_id: n.id })
  const { newRecord } = await import('../db/records')
  for (let i = 0; i < 3; i++) await db.note_files.add(newRecord(big(45 * 1024 * 1024)) as never)
  await expect(attachFile(db, n.id, { name: 'c', mime: '', bytes: { length: 20 * 1024 * 1024 } as Uint8Array })).rejects.toThrow('첨부 파일은 모두 합쳐 150MB까지')
  const one = (await db.note_files.toArray())[0]
  await db.note_files.update(one.id, { deleted: true })
  await expect(attachFile(db, n.id, { name: 'c', mime: '', bytes: new Uint8Array(3) })).resolves.toBeTruthy()
})

test('찾기 글·서식 없는 글에 표 칸과 그림 설명도 들어간다', async () => {
  const { noteText } = await import('./notes')
  const { noteToPlain } = await import('./toHtml')
  const n = { title: '명단', blocks: [{ id: 't', type: 'table' as const, cells: [['이름', '확인'], ['가상일', '✔']] }, { id: 'i', type: 'image' as const, file_id: 'f', caption: '운동장 사진' }] }
  expect(noteText(n as never)).toContain('가상일')
  expect(noteText(n as never)).toContain('운동장 사진')
  expect(noteToPlain(n, { withTitle: false })).toBe('이름\t확인\n가상일\t✔\n[그림] 운동장 사진')
})
