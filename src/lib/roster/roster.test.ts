// @vitest-environment node
import { createDb } from '../db/schema'
import { currentSchoolYear } from './schoolYear'
import {
  createClass, listClasses, classLabel, listStudents, saveStudent, deleteStudent, upsertRosterRows,
  emptyStudent, getCurrentClassId, setCurrentClassId,
} from './roster'

const testDb = () => createDb('test-' + crypto.randomUUID())

test('학년도: 2026-03-02 → 2026, 2027-02-10 → 2026, 2026-12-31 → 2026', () => {
  expect(currentSchoolYear(new Date(2026, 2, 2))).toBe(2026)
  expect(currentSchoolYear(new Date(2027, 1, 10))).toBe(2026)
  expect(currentSchoolYear(new Date(2026, 11, 31))).toBe(2026)
})

test('같은 학급을 두 번 만들면 오류', async () => {
  const db = testDb()
  await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await expect(createClass(db, { school_year: 2026, grade: 1, class_no: 5 })).rejects.toThrow('이미 있는 학급입니다.')
})

test('listClasses 정렬: 학년도 내림차순, 학년·반 오름차순', async () => {
  const db = testDb()
  await createClass(db, { school_year: 2025, grade: 1, class_no: 1 })
  await createClass(db, { school_year: 2026, grade: 2, class_no: 1 })
  await createClass(db, { school_year: 2026, grade: 1, class_no: 3 })
  await createClass(db, { school_year: 2026, grade: 1, class_no: 2 })
  const list = (await listClasses(db)).map((c) => `${c.school_year}-${c.grade}-${c.class_no}`)
  expect(list).toEqual(['2026-1-2', '2026-1-3', '2026-2-1', '2025-1-1'])
})

test('classLabel은 "1학년 5반"', async () => {
  const c = await createClass(testDb(), { school_year: 2026, grade: 1, class_no: 5 })
  expect(classLabel(c)).toBe('1학년 5반')
})

test('listStudents는 번호순이고 삭제된 학생을 뺀다; includeInactive:false면 전출 학생도 뺀다', async () => {
  const db = testDb()
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(3, '다'))
  const b = await saveStudent(db, c.id, emptyStudent(2, '나'))
  await saveStudent(db, c.id, { ...emptyStudent(1, '가'), active: false })
  const gone = await saveStudent(db, c.id, emptyStudent(4, '라'))
  await deleteStudent(db, gone.id)
  expect((await listStudents(db, c.id)).map((s) => s.name)).toEqual(['가', '나', '다'])
  expect((await listStudents(db, c.id, { includeInactive: false })).map((s) => s.name)).toEqual(['나', '다'])
  expect(b.class_id).toBe(c.id)
})

test('saveStudent는 같은 학급 같은 번호를 거부한다(수정 중인 자기 자신은 허용)', async () => {
  const db = testDb()
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(1, '가'))
  await expect(saveStudent(db, c.id, emptyStudent(1, '나'))).rejects.toThrow('같은 번호의 학생이 이미 있습니다.')
  const { id: _id, class_id: _c, created_at: _ca, updated_at: _u, deleted: _d, ...fields } = a
  const edited = await saveStudent(db, c.id, { ...fields, name: '가가' }, a.id)
  expect(edited.name).toBe('가가')
  expect(edited.created_at).toBe(a.created_at)
})

const row = (number: number, fields: Record<string, string>) => ({ number, fields })

test('upsertRosterRows 두 번 실행해도 학생 수가 같고 채운 칸만 갱신된다', async () => {
  const db = testDb()
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const r1 = await upsertRosterRows(db, c.id, [row(1, { name: '가' }), row(2, { name: '나' })])
  expect(r1).toEqual({ added: 2, updated: 0, skipped: [] })
  const r2 = await upsertRosterRows(db, c.id, [row(1, { name: '가가', guardian_name: '보호자', guardian_phone: '010-1', gender: '여' }), row(2, { name: '' })])
  expect(r2).toEqual({ added: 0, updated: 1, skipped: [] })
  const list = await listStudents(db, c.id)
  expect(list).toHaveLength(2)
  expect(list[0]).toMatchObject({ name: '가가', guardian_name: '보호자', guardian_phone: '010-1', gender: '여' })
  expect(list[1].name).toBe('나')
})

test('upsertRosterRows는 빈 칸으로 기존 값을 지우지 않고, 이름 없는 새 번호는 건너뛴다', async () => {
  const db = testDb()
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await upsertRosterRows(db, c.id, [row(1, { name: '가', guardian_name: '보호자', guardian_phone: '010-1' })])
  const r = await upsertRosterRows(db, c.id, [row(1, { name: '', guardian_name: '', guardian_phone: '', guardian_relation: '어머니' }), row(9, { phone: '010-9' })])
  expect(r).toEqual({ added: 0, updated: 1, skipped: [9] })
  expect((await listStudents(db, c.id))[0]).toMatchObject({ name: '가', guardian_name: '보호자', guardian_phone: '010-1', guardian_relation: '어머니' })
})

test('현재 학급 id를 저장하고 읽는다', async () => {
  const db = testDb()
  expect(await getCurrentClassId(db)).toBeUndefined()
  await setCurrentClassId(db, 'c-1')
  expect(await getCurrentClassId(db)).toBe('c-1')
})

test('엑셀 올리기: 추가 칸 값(extra)은 합쳐 저장, 빈 칸은 있던 값 유지', async () => {
  const db = testDb()
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 1 })
  await saveStudent(db, c.id, { ...emptyStudent(1, '가나'), extra: { x_aaaaaaaa: '땅콩', x_bbbbbbbb: '로봇반' } })
  await upsertRosterRows(db, c.id, [{ number: 1, fields: { extra: { x_aaaaaaaa: '우유', x_bbbbbbbb: '' } } }])
  const [s] = await listStudents(db, c.id)
  expect(s.extra).toEqual({ x_aaaaaaaa: '우유', x_bbbbbbbb: '로봇반' })
  await upsertRosterRows(db, c.id, [{ number: 2, fields: { name: '다라', extra: { x_aaaaaaaa: '달걀' } } }])
  expect((await listStudents(db, c.id))[1].extra).toEqual({ x_aaaaaaaa: '달걀' })
})

test('가릴 이름(allStudentNames): 지운 학생 이름과 보호자 이름도 넣는다', async () => {
  const { createDb } = await import('../db/schema')
  const { createClass, emptyStudent, saveStudent, deleteStudent, allStudentNames } = await import('./roster')
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, { ...emptyStudent(1, '김민수'), guardian_name: '이영희' })
  const b = await saveStudent(db, c.id, emptyStudent(2, '박지훈'))
  await deleteStudent(db, b.id)
  void a
  expect((await allStudentNames(db)).sort()).toEqual(['김민수', '박지훈', '보호자:이영희'])
})
