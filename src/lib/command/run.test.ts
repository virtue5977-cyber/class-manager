import { createDb } from '../db/schema'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { listAttendanceByStudent } from '../attendance/attendance'
import { listReportsByStudent } from '../absenceReports/reconcile'
import { createNote } from '../notes/notes'
import { listTodos } from '../todos/todos'
import { listLocalEvents } from '../events/localEvents'
import { noticesOn } from '../notices/notices'
import { executeInput, makeUndo, type RunEnv } from './run'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s3 = await saveStudent(db, c.id, emptyStudent(3, '박도윤'))
  await saveStudent(db, c.id, emptyStudent(5, '김민준'))
  await saveStudent(db, c.id, emptyStudent(6, '김민지'))
  const note = await createNote(db, '2026 공문서')
  const students = await db.students.toArray()
  const env: RunEnv = { db, today: '2026-11-10', classId: c.id, navigate: () => {}, download: () => {} }
  const ctx = { students, notes: [note], today: '2026-11-10' }
  return { db, s3, note, env, ctx }
}

test('/출결 저장 → 신고서 생김 · 대화 기록 · 링크 · 되돌리기', async () => {
  const { db, s3, env, ctx } = await setup()
  const r = await executeInput('/출결 @3 결석 질병 감기', ctx, env)
  expect(r.chat.status).toBe('성공')
  expect(r.chat.links).toContainEqual({ label: '출결 보기', to: '/attendance?date=2026-11-10' })
  expect((await listAttendanceByStudent(db, s3.id)).filter((a) => !a.deleted)).toHaveLength(1)
  expect((await listReportsByStudent(db, s3.id)).length).toBe(1)
  await r.result!.undo!()
  expect((await listAttendanceByStudent(db, s3.id)).filter((a) => !a.deleted)).toHaveLength(0)
  expect((await listReportsByStudent(db, s3.id)).length).toBe(0)
  expect((await db.chat_log.toArray()).length).toBe(1)
})

test('여러 학생이 맞으면 저장하지 않고 확인 필요', async () => {
  const { db, env, ctx } = await setup()
  const r = await executeInput('/출결 @김민 지각 1교시 미인정', ctx, env)
  expect(r.chat.status).toBe('확인 필요')
  expect(r.chat.summary).toContain("'김민'")
  expect(await db.attendance.count()).toBe(0)
})

test('종류가 빠지면 입력 창을 띄운다', async () => {
  const { s3, env, ctx } = await setup()
  const r = await executeInput('/출결 @3 감기', ctx, env)
  expect(r.result?.form).toEqual({ kind: 'attendance', studentId: s3.id, date: '2026-11-10' })
  expect(r.chat.status).toBe('확인 필요')
})

test('/할일·/일정·/전달·/노트', async () => {
  const { db, note, env, ctx } = await setup()
  await executeInput('/할일 회신 @2026 공문서 내일', ctx, env)
  const [t] = await listTodos(db)
  expect(t.parts).toEqual(['회신 ', { note: note.id }])
  expect(t.due).toBe('2026-11-11')
  await executeInput('/일정 달력 모레 15:30 #개인 치과', ctx, env)
  expect((await listLocalEvents(db, '2026-11-12', '2026-11-12')).map((e) => [e.title, e.tag, e.time])).toEqual([['치과', '개인', '15:30']])
  await executeInput('/전달 학생 체육복 지참', ctx, env)
  expect((await noticesOn(db, '2026-11-10')).map((n) => n.text)).toEqual(['체육복 지참'])
  const n = await executeInput('/노트 회의록', ctx, env)
  expect(n.chat.links[0].to).toMatch(/^\/notes\?id=/)
})

test('/찾기는 출결 사유·노트에서 찾는다', async () => {
  const { env, ctx } = await setup()
  await executeInput('/출결 @3 결석 질병 감기', ctx, env)
  const r = await executeInput('/찾기 감기', ctx, env)
  expect(r.result?.card?.kind).toBe('search')
  expect((r.result!.card!.data as { label: string }[]).length).toBe(1)
})

test('모르는 명령·/ 없는 문장(AI 없음)은 실행하지 않고 기록', async () => {
  const { db, env, ctx } = await setup()
  expect((await executeInput('/없는 a', ctx, env)).chat.status).toBe('확인 필요')
  expect((await db.chat_log.count())).toBe(1)
})

test('되돌리기는 10초 안에 한 번만', async () => {
  let n = 0
  let now = 1000
  const u = makeUndo(async () => void n++, 10000, () => now)
  now = 11001
  expect(await u.undo()).toBe(false)
  const v = makeUndo(async () => void n++, 10000, () => now)
  expect(await v.undo()).toBe(true)
  expect(await v.undo()).toBe(false)
  expect(n).toBe(1)
})
