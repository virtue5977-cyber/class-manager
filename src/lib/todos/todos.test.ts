import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import type { NoteRec, StudentRec } from '../db/types'
import { emptyStudent } from '../roster/roster'
import { addTodo, listTodos, renderParts, setTodoDone, todosLinkingNote } from './todos'

test('할 일: 미완료 마감일 순, 완료 아래; 노트를 가리키는 할 일 찾기', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const a = await addTodo(db, ['나중'], '2026-11-20')
  await addTodo(db, ['먼저'], '2026-11-11')
  await addTodo(db, ['회신 ', { note: 'n1' }])
  await setTodoDone(db, a.id, true)
  expect((await listTodos(db)).map((t) => t.parts[0])).toEqual(['먼저', '회신 ', '나중'])
  expect((await todosLinkingNote(db, 'n1')).length).toBe(1)
})

test('조각 표시: 노트는 지금 제목·링크, 지운 노트는 흐리게, 학생은 번호 이름', () => {
  const note = { ...newRecord({ title: '2026 공문서', blocks: [], pinned: false }) } as NoteRec
  const st = { ...newRecord({ ...emptyStudent(3, '박도윤'), class_id: 'c' }) } as StudentRec
  const out = renderParts(['회신 ', { note: note.id }, ' ', { note: 'gone' }, { student: st.id }], new Map([[note.id, note]]), new Map([[st.id, st]]))
  expect(out).toEqual([
    { text: '회신 ' },
    { text: '2026 공문서', to: `/notes?id=${note.id}` },
    { text: ' ' },
    { text: '지운 노트', dead: true },
    { text: '3번 박도윤', to: `/counseling?sid=${st.id}` },
  ])
})
