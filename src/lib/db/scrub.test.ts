import { createDb } from './schema'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { saveAttendance, deleteAttendance } from '../attendance/attendance'
import { saveLog, deleteLog } from '../counseling/counseling'
import { createNote, deleteNote } from '../notes/notes'
import { addTodo, deleteTodo } from '../todos/todos'
import { addNotice, deleteNotice, noticesOn } from '../notices/notices'
import { saveReflection, deleteReflection, DEFAULT_LINES } from '../reflection/store'

test('지운 기록에는 내용 글이 남지 않는다(백업에도)', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '가'))
  const a = await saveAttendance(db, { student_id: s.id, date: '2026-11-10', kind: '결석', category: '질병', period: null, reason: '장염', evidence_type: null, memo: '병원' })
  await deleteAttendance(db, a.id)
  expect(await db.attendance.get(a.id)).toMatchObject({ deleted: true, reason: '', memo: '' })
  const l = await saveLog(db, { student_id: s.id, date: '2026-11-10', place: '상담실', content: '가정 문제' })
  await deleteLog(db, l.id)
  expect(await db.counseling_logs.get(l.id)).toMatchObject({ deleted: true, content: '', nuga_text: '', place: '' })
  const n = await createNote(db, '비밀', [{ id: 'b', type: 'p', text: '내용' }])
  await deleteNote(db, n.id)
  expect(await db.notes.get(n.id)).toMatchObject({ deleted: true, title: '', blocks: [] })
  const t = await addTodo(db, ['민수 상담'])
  await deleteTodo(db, t.id)
  expect(await db.todos.get(t.id)).toMatchObject({ deleted: true, parts: [] })
  const r = await saveReflection(db, { student_id: s.id, date: '2026-11-10', reason: '흡연', lines: DEFAULT_LINES, t1: '', t2: '', mode: 'B4' })
  await deleteReflection(db, r.id)
  expect(await db.reflections.get(r.id)).toMatchObject({ deleted: true, reason: '', lines: [] })
  const x = await addNotice(db, { text: '동의서', start_date: '2026-11-10' })
  const undo = await deleteNotice(db, x.id)
  expect(await db.notice_items.get(x.id)).toMatchObject({ deleted: true, text: '' })
  await undo()
  expect((await noticesOn(db, '2026-11-10')).map((v) => v.text)).toEqual(['동의서'])
})
