// @vitest-environment node
import { createDb } from '../db/schema'
import { getSettings } from '../settings'
import { saveAttendance, deleteAttendance, listAttendanceByDate, listAttendanceByStudent, validateAttendance, type AttendanceInput } from './attendance'

const testDb = () => createDb('test-' + crypto.randomUUID())
const a = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
  student_id: 's1', date: '2026-11-05', kind: '결석', category: '질병', period: null, reason: '', evidence_type: null, memo: '', ...over,
})

test('지각·조퇴·결과는 교시 필수, 형식 검사', () => {
  expect(validateAttendance(a({ kind: '지각', period: null }), [])).toBe('교시를 입력하세요.')
  expect(validateAttendance(a({ kind: '결과', period: '3-4' }), [])).toBe('교시는 3 또는 3~4처럼 입력하세요.')
  expect(validateAttendance(a({ kind: '결과', period: '3~4' }), [])).toBeNull()
  expect(validateAttendance(a({ kind: '조퇴', period: '5' }), [])).toBeNull()
})

test('같은 날 같은 구분 중복과 결석+지각 동시 입력을 막는다', async () => {
  const db = testDb()
  await saveAttendance(db, a())
  await expect(saveAttendance(db, a({ category: '미인정' }))).rejects.toThrow('이 날짜에 같은 구분의 출결이 이미 있습니다.')
  await expect(saveAttendance(db, a({ kind: '지각', period: '1' }))).rejects.toThrow('결석한 날에는 지각·조퇴·결과를 함께 입력할 수 없습니다.')
  const db2 = testDb()
  await saveAttendance(db2, a({ kind: '지각', period: '1' }))
  await expect(saveAttendance(db2, a())).rejects.toThrow('결석한 날에는 지각·조퇴·결과를 함께 입력할 수 없습니다.')
})

test('결석이면 교시를 비우고, 출석인정이 아니면 증빙 구분을 비운다', async () => {
  const db = testDb()
  const r = await saveAttendance(db, a({ period: '3', evidence_type: '경조사 참석' }))
  expect(r.period).toBeNull()
  expect(r.evidence_type).toBeNull()
  const r2 = await saveAttendance(db, a({ date: '2026-11-06', category: '출석인정', evidence_type: '경조사 참석' }))
  expect(r2.evidence_type).toBe('경조사 참석')
})

test('자기 자신을 고칠 때는 중복이 아니다', async () => {
  const db = testDb()
  const r = await saveAttendance(db, a())
  const { id, created_at: _c, updated_at: _u, deleted: _d, ...fields } = r
  const edited = await saveAttendance(db, { ...fields, category: '출석인정' }, id)
  expect(edited.category).toBe('출석인정')
  expect(edited.created_at).toBe(r.created_at)
})

test('날짜·학생별 조회와 삭제', async () => {
  const db = testDb()
  const x = await saveAttendance(db, a({ date: '2026-11-06' }))
  await saveAttendance(db, a({ date: '2026-11-05' }))
  await saveAttendance(db, a({ student_id: 's2', date: '2026-11-05', kind: '지각', period: '1', category: '미인정' }))
  expect((await listAttendanceByDate(db, ['s1', 's2'], '2026-11-05')).map((r) => r.student_id).sort()).toEqual(['s1', 's2'])
  expect((await listAttendanceByStudent(db, 's1')).map((r) => r.date)).toEqual(['2026-11-05', '2026-11-06'])
  await deleteAttendance(db, x.id)
  expect((await listAttendanceByStudent(db, 's1')).map((r) => r.date)).toEqual(['2026-11-05'])
  await saveAttendance(db, a({ date: '2026-11-06' })) // 삭제한 날에 다시 입력 가능
})

test('설정 기본값: 신고서 규칙·진단서 일수·학번 형식', async () => {
  const s = await getSettings(testDb())
  expect(s.report_rules).toEqual(['결석:질병', '결석:출석인정', '지각:출석인정', '조퇴:출석인정', '결과:출석인정'])
  expect(s.diagnosis_days).toBe(3)
  expect(s.student_code_format).toBe('{학년}{반}{번호2}')
})

test('고칠 출결과 학생·날짜가 다르면 덮어쓰지 않는다 (날짜를 빨리 바꿀 때 이전 기록 보호)', async () => {
  const db = testDb()
  const r = await saveAttendance(db, a({ date: '2026-11-06' }))
  await expect(saveAttendance(db, a({ date: '2026-11-09' }), r.id)).rejects.toThrow('다른 날짜의 출결은 고칠 수 없습니다. 다시 열어 주세요.')
  await expect(saveAttendance(db, a({ student_id: 's2', date: '2026-11-06' }), r.id)).rejects.toThrow('다른 날짜의 출결은 고칠 수 없습니다. 다시 열어 주세요.')
  expect((await listAttendanceByStudent(db, 's1')).map((x) => x.date)).toEqual(['2026-11-06'])
})

test('지운 구분으로 고쳐도 저장된다(삭제 표시 행과 충돌하지 않음)', async () => {
  const db = testDb()
  const t = await saveAttendance(db, a({ date: '2026-11-09', kind: '조퇴', period: '3' }))
  await deleteAttendance(db, t.id)
  const l = await saveAttendance(db, a({ date: '2026-11-09', kind: '지각', period: '1' }))
  const r = await saveAttendance(db, a({ date: '2026-11-09', kind: '조퇴', period: '3' }), l.id)
  expect(r).toMatchObject({ id: l.id, kind: '조퇴', period: '3' })
  expect((await listAttendanceByStudent(db, 's1')).map((x) => x.kind)).toEqual(['조퇴'])
})
