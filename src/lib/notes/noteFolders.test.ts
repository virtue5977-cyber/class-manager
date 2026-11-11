import { createDb } from '../db/schema'
import { createNote } from './notes'
import { addFolder, deleteFolder, folderTree, listFolders, moveFolder, moveNote, renameFolder, MAX_FOLDER_DEPTH } from './noteFolders'

const mk = () => createDb('test-' + crypto.randomUUID())

test('폴더 만들기·이름 바꾸기, 깊이는 3단까지(넘으면 오류), 빈 이름은 오류', async () => {
  const db = mk()
  expect(MAX_FOLDER_DEPTH).toBe(3)
  const a = await addFolder(db, '학급')
  const b = await addFolder(db, '행사', a.id)
  const c = await addFolder(db, '체육대회', b.id)
  await expect(addFolder(db, '너무 깊음', c.id)).rejects.toThrow('폴더는 3단까지')
  await expect(addFolder(db, '  ')).rejects.toThrow('폴더 이름')
  await renameFolder(db, a.id, '우리 반')
  expect((await listFolders(db)).map((f) => f.name)).toEqual(['우리 반', '행사', '체육대회'])
})

test('폴더를 지우면 안의 노트·하위 폴더는 위 폴더로(노트는 지우지 않음)', async () => {
  const db = mk()
  const a = await addFolder(db, '학급')
  const b = await addFolder(db, '행사', a.id)
  const c = await addFolder(db, '체육대회', b.id)
  const n = await createNote(db, '계획')
  await moveNote(db, n.id, b.id)
  await deleteFolder(db, b.id)
  const fs = await listFolders(db)
  expect(fs.map((f) => f.name)).toEqual(['학급', '체육대회'])
  expect(fs.find((f) => f.id === c.id)!.parent).toBe(a.id)
  const got = await db.notes.get(n.id)
  expect(got!.folder_id).toBe(a.id)
  expect(got!.deleted).toBeFalsy()
})

test('폴더 옮기기: 자기 아래로는 못 옮기고, 옮겨서 3단을 넘으면 오류', async () => {
  const db = mk()
  const a = await addFolder(db, 'A')
  const b = await addFolder(db, 'B', a.id)
  const c = await addFolder(db, 'C')
  const d = await addFolder(db, 'D', c.id)
  await expect(moveFolder(db, a.id, b.id)).rejects.toThrow('자기 안')
  await expect(moveFolder(db, c.id, b.id)).rejects.toThrow('폴더는 3단까지')
  await moveFolder(db, d.id, null)
  expect((await listFolders(db)).find((f) => f.id === d.id)!.parent).toBeNull()
})

test('나무: 폴더(이름순) 안에 하위 폴더와 노트, 없는 폴더를 가리키는 노트는 맨 위', async () => {
  const db = mk()
  const a = await addFolder(db, '학급')
  const b = await addFolder(db, '행사', a.id)
  const n1 = await createNote(db, '맨 위 노트')
  const n2 = await createNote(db, '계획')
  const n3 = await createNote(db, '길 잃은 노트')
  await moveNote(db, n2.id, b.id)
  await moveNote(db, n3.id, 'nope')
  const tree = folderTree(await listFolders(db), (await db.notes.toArray()))
  expect(tree.notes.map((n) => n.title).sort()).toEqual(['길 잃은 노트', '맨 위 노트'].sort())
  expect(tree.folders.map((f) => f.folder.name)).toEqual(['학급'])
  expect(tree.folders[0].folders[0].folder.name).toBe('행사')
  expect(tree.folders[0].folders[0].notes.map((n) => n.id)).toEqual([n2.id])
  expect(tree.folders[0].count).toBe(1)
  void n1
})

test('노트 순서: 끌어 바꾼 순서대로(그 폴더로 옮기며), 고정이 먼저, 순서 없는 새 노트는 맨 위', async () => {
  const { reorderNotes } = await import('./noteFolders')
  const { listNotes, setPinned } = await import('./notes')
  const db = mk()
  const f = await addFolder(db, '학급')
  const a = await createNote(db, 'A')
  const b = await createNote(db, 'B')
  const c = await createNote(db, 'C')
  await reorderNotes(db, f.id, [c.id, a.id, b.id])
  const inF = (await listNotes(db)).filter((n) => n.folder_id === f.id).map((n) => n.title)
  expect(inF).toEqual(['C', 'A', 'B'])
  await setPinned(db, b.id, true)
  expect((await listNotes(db)).map((n) => n.title).slice(0, 1)).toEqual(['B'])
  const d = await createNote(db, 'D', undefined, f.id)
  expect((await listNotes(db)).filter((n) => n.folder_id === f.id && !n.pinned).map((n) => n.title)).toEqual(['D', 'C', 'A'])
  void d
})
