import { createDb } from '../db/schema'
import { addNotice, deleteNotice, noticesOn, updateNotice, moveNotice } from './notices'
import { linkNoteToDate, noticeNoteOf, openNoticeNote, syncNoteToNotices, unlinkNoticeNote } from './noteSync'
import { createNote, deleteNote, listNotes, saveNoteContent } from '../notes/notes'

const D = '2026-11-13'
const texts = async (db: ReturnType<typeof createDb>, d = D) => (await noticesOn(db, d)).map((n) => n.text)
const lines = async (db: ReturnType<typeof createDb>, id: string) => (await db.notes.get(id))!.blocks.map((b) => [b.type, b.text, !!b.checked])

test('짝 노트 열기: 그날 하루짜리 전달사항이 체크 줄로, 여러 날 전달사항은 빼고, 제목은 [전달사항] 11/13(금)', async () => {
  const db = createDb('t-' + crypto.randomUUID())
  await addNotice(db, { text: '우유 신청서', start_date: D })
  const two = await addNotice(db, { text: '체육복', start_date: D })
  await updateNotice(db, two.id, { done: true })
  await addNotice(db, { text: '여러 날', start_date: '2026-11-12', end_date: '2026-11-14' })
  const n = await openNoticeNote(db, D)
  expect(n.title).toBe('[전달사항] 11/13(금)')
  expect(await lines(db, n.id)).toEqual([['check', '우유 신청서', false], ['check', '체육복', true]])
  expect((await openNoticeNote(db, D)).id).toBe(n.id)
})

test('노트에서 고치면 전달사항이, 전달사항에서 고치면 노트가 맞춰진다(더하기·고치기·지우기·순서·체크)', async () => {
  const db = createDb('t-' + crypto.randomUUID())
  await addNotice(db, { text: '하나', start_date: D })
  const n = await openNoticeNote(db, D)
  const cur = (await db.notes.get(n.id))!
  // 노트 쪽: 줄 고치기·더하기·제목 줄(전달사항 아님)
  await saveNoteContent(db, n.id, { title: cur.title, blocks: [{ id: 'h', type: 'h2', text: '머리' }, { ...cur.blocks[0], text: '하나!' }, { id: 'x', type: 'bullet', text: '둘' }, { id: 'e', type: 'p', text: '  ' }] })
  expect(await texts(db)).toEqual(['하나!', '둘'])
  // 전달사항 쪽: 더하기·체크·순서·지우기
  const added = await addNotice(db, { text: '셋', start_date: D })
  expect((await lines(db, n.id)).map((l) => l[1])).toEqual(['머리', '하나!', '둘', '  ', '셋'])
  await updateNotice(db, added.id, { done: true })
  expect((await lines(db, n.id))[4]).toEqual(['check', '셋', true])
  const list = await noticesOn(db, D)
  await moveNotice(db, D, list.find((x) => x.text === '둘')!.id, -1)
  expect((await lines(db, n.id)).map((l) => l[1])).toEqual(['머리', '둘', '하나!', '  ', '셋'])
  await deleteNotice(db, list.find((x) => x.text === '하나!')!.id)
  expect((await lines(db, n.id)).map((l) => l[1])).toEqual(['머리', '둘', '  ', '셋'])
  await updateNotice(db, list.find((x) => x.text === '둘')!.id, { text: '둘(고침)' })
  expect((await lines(db, n.id))[1][1]).toBe('둘(고침)')
  // 노트에서 줄 지우기
  const now = (await db.notes.get(n.id))!
  await saveNoteContent(db, n.id, { title: now.title, blocks: now.blocks.filter((b) => b.text !== '셋') })
  expect(await texts(db)).toEqual(['둘(고침)'])
})

test('노트를 지우면 전달사항은 남고 연결만 끊긴다, 짝 풀기도 같다', async () => {
  const db = createDb('t-' + crypto.randomUUID())
  await addNotice(db, { text: '하나', start_date: D })
  const n = await openNoticeNote(db, D)
  await deleteNote(db, n.id)
  expect(await texts(db)).toEqual(['하나'])
  expect((await noticesOn(db, D))[0].note_id).toBeUndefined()
  const m = await openNoticeNote(db, D)
  await unlinkNoticeNote(db, m.id)
  expect(await noticeNoteOf(db, D)).toBeUndefined()
  expect(await texts(db)).toEqual(['하나'])
})

test('노트 전체를 전달사항으로: 합치기는 그날 있던 것을 노트에 더하고, 바꾸기는 예전 짝 노트 것을 지운다', async () => {
  const db = createDb('t-' + crypto.randomUUID())
  await addNotice(db, { text: '원래', start_date: D })
  const old = await openNoticeNote(db, D)
  const a = await createNote(db, '내 노트', [{ id: 'a1', type: 'p', text: '새 공지' }, { id: 'a2', type: 'h1', text: '제목' }])
  await linkNoteToDate(db, a.id, D, 'merge')
  expect(await texts(db)).toEqual(['원래', '새 공지'])
  expect((await noticeNoteOf(db, D))!.id).toBe(a.id)
  expect((await db.notes.get(old.id))!.notice_date).toBeUndefined()
  expect((await lines(db, a.id)).map((l) => l[1])).toEqual(['새 공지', '제목', '원래'])
  const b = await createNote(db, '다른', [{ id: 'b1', type: 'p', text: '바꾼 것' }])
  await linkNoteToDate(db, b.id, D, 'replace')
  expect(await texts(db)).toEqual(['바꾼 것'])
  void syncNoteToNotices
})

test('노트함 정렬: 오늘·앞날짜 짝 노트가 고정보다 먼저, 지난 날짜는 보통', async () => {
  const db = createDb('t-' + crypto.randomUUID())
  const p = await createNote(db, '고정')
  await db.notes.update(p.id, { pinned: true })
  await openNoticeNote(db, '2026-11-01')
  const today = await openNoticeNote(db, D)
  const list = await listNotes(db, D)
  expect(list[0].id).toBe(today.id)
  expect(list[1].id).toBe(p.id)
})
