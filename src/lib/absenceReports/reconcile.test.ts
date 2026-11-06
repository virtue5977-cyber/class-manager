// @vitest-environment node
import { createDb } from '../db/schema'
import { saveAttendance, deleteAttendance, type AttendanceInput } from '../attendance/attendance'
import { createClass, saveStudent, emptyStudent } from '../roster/roster'
import { updateSettings } from '../settings'
import { reconcileStudent, reconcileAll, impactOfChange, updateReport, resetOverride, listReportsByStudent, getReportAttendanceIds, toggleConfirmMethod } from './reconcile'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(3, '홍길동'))
  return { db, c, s }
}
const a = (student_id: string, date: string, over: Partial<AttendanceInput> = {}): AttendanceInput => ({
  student_id, date, kind: '결석', category: '질병', period: null, reason: '감기', evidence_type: null, memo: '', ...over,
})
async function add(db: Awaited<ReturnType<typeof setup>>['db'], sid: string, date: string, over: Partial<AttendanceInput> = {}) {
  const r = await saveAttendance(db, a(sid, date, over))
  await reconcileStudent(db, sid)
  return r
}

test('질병 결석 2일 → 1장, 출결 2건 연결', async () => {
  const { db, s } = await setup()
  const x = await add(db, s.id, '2026-11-06')
  const y = await add(db, s.id, '2026-11-09')
  const reports = await listReportsByStudent(db, s.id)
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({ start_date: '2026-11-06', end_date: '2026-11-09', school_days: 2, evidence_type: '2일 이내 질병', submitted: false, stale: false })
  expect((await getReportAttendanceIds(db, reports[0].id)).sort()).toEqual([x.id, y.id].sort())
})

test('하루 추가 → 같은 id가 3일·3일 이상 질병, 제출 유지, 제출됐으면 stale', async () => {
  const { db, s } = await setup()
  await add(db, s.id, '2026-11-09')
  await add(db, s.id, '2026-11-10')
  const [r] = await listReportsByStudent(db, s.id)
  await updateReport(db, r.id, { submitted: true })
  await add(db, s.id, '2026-11-11')
  const [after] = await listReportsByStudent(db, s.id)
  expect(after.id).toBe(r.id)
  expect(after).toMatchObject({ school_days: 3, evidence_type: '3일 이상 질병', diagnosis_required: true, confirm_methods: [2], submitted: true, stale: true })
})

test('고친 사유는 재계산해도 유지, overrides에 detail', async () => {
  const { db, s } = await setup()
  await add(db, s.id, '2026-11-09')
  const [r] = await listReportsByStudent(db, s.id)
  await updateReport(db, r.id, { detail: '독감으로 병원 치료' })
  await add(db, s.id, '2026-11-10')
  const [after] = await listReportsByStudent(db, s.id)
  expect(after.detail).toBe('독감으로 병원 치료')
  expect(after.overrides).toContain('detail')
  expect(after.stale).toBe(true)
})

test('출결 모두 삭제 → 미제출은 삭제, 제출은 남고 stale', async () => {
  const { db, s } = await setup()
  const x = await add(db, s.id, '2026-11-09')
  const y = await add(db, s.id, '2026-11-12', { kind: '조퇴', category: '출석인정', period: '5' })
  const reports = await listReportsByStudent(db, s.id)
  const sub = reports.find((r) => r.kind === '조퇴')!
  await updateReport(db, sub.id, { submitted: true })
  await deleteAttendance(db, x.id)
  await deleteAttendance(db, y.id)
  await reconcileStudent(db, s.id)
  const left = await listReportsByStudent(db, s.id)
  expect(left.map((r) => [r.kind, r.stale])).toEqual([['조퇴', true]])
})

test('가운데 날 삭제 → 두 장, 원래 id는 겹침 큰 쪽', async () => {
  const { db, s } = await setup()
  await add(db, s.id, '2026-11-09')
  const mid = await add(db, s.id, '2026-11-10')
  await add(db, s.id, '2026-11-11')
  await add(db, s.id, '2026-11-12')
  const [orig] = await listReportsByStudent(db, s.id)
  await deleteAttendance(db, mid.id)
  await reconcileStudent(db, s.id)
  const after = await listReportsByStudent(db, s.id)
  expect(after.map((r) => `${r.start_date}~${r.end_date}`)).toEqual(['2026-11-09~2026-11-09', '2026-11-11~2026-11-12'])
  expect(after.find((r) => r.start_date === '2026-11-11')!.id).toBe(orig.id)
})

test('impactOfChange는 제출된 신고서만 돌려주고 DB를 바꾸지 않는다', async () => {
  const { db, s } = await setup()
  const x = await add(db, s.id, '2026-11-09')
  await add(db, s.id, '2026-11-20', { kind: '지각', category: '출석인정', period: '1' })
  const reports = await listReportsByStudent(db, s.id)
  const absence = reports.find((r) => r.kind === '결석')!
  await updateReport(db, absence.id, { submitted: true })
  const hit = await impactOfChange(db, s.id, { removeId: x.id })
  expect(hit.map((r) => r.id)).toEqual([absence.id])
  expect(await impactOfChange(db, s.id, { upsert: a(s.id, '2026-11-25') })).toEqual([])
  expect(await listReportsByStudent(db, s.id)).toHaveLength(2)
})

test('미인정으로 바꾸면 미제출 신고서가 사라진다', async () => {
  const { db, s } = await setup()
  const x = await add(db, s.id, '2026-11-09')
  const { id, created_at: _c, updated_at: _u, deleted: _d, ...f } = x
  await saveAttendance(db, { ...f, category: '미인정' }, id)
  await reconcileStudent(db, s.id)
  expect(await listReportsByStudent(db, s.id)).toEqual([])
})

test('resetOverride는 자동 값으로 되돌린다', async () => {
  const { db, s } = await setup()
  await add(db, s.id, '2026-11-09')
  const [r] = await listReportsByStudent(db, s.id)
  await updateReport(db, r.id, { detail: '바꿈', written_date: '2026-11-30' })
  await resetOverride(db, r.id, 'detail')
  const [after] = await listReportsByStudent(db, s.id)
  expect(after.detail).toBe('감기')
  expect(after.overrides).toEqual(['written_date'])
  expect(after.written_date).toBe('2026-11-30')
})

test('규칙에서 출석인정 지각을 끄고 reconcileAll → 미제출 지각 신고서 삭제', async () => {
  const { db, c, s } = await setup()
  await add(db, s.id, '2026-11-09', { kind: '지각', category: '출석인정', period: '1' })
  expect(await listReportsByStudent(db, s.id)).toHaveLength(1)
  await updateSettings(db, { report_rules: ['결석:질병'] })
  await reconcileAll(db, c.id)
  expect(await listReportsByStudent(db, s.id)).toEqual([])
})

test('제출 체크는 submitted_at을 남기고 해제하면 지운다', async () => {
  const { db, s } = await setup()
  await add(db, s.id, '2026-11-09')
  const [r] = await listReportsByStudent(db, s.id)
  expect((await updateReport(db, r.id, { submitted: true })).submitted_at).toMatch(/^\d{4}-/)
  expect((await updateReport(db, r.id, { submitted: false })).submitted_at).toBeNull()
})

test('제출된 신고서의 교시·사유·증빙만 바뀌어도 경고하고 stale로 표시', async () => {
  const { db, s } = await setup()
  const tardy = { kind: '지각', category: '출석인정', period: '1', evidence_type: '기타', reason: 'A' } as const
  const x = await add(db, s.id, '2026-11-09', tardy)
  const [r] = await listReportsByStudent(db, s.id)
  await updateReport(db, r.id, { submitted: true })
  const next = a(s.id, '2026-11-09', { ...tardy, period: '2', evidence_type: '법정전염병', reason: 'B' })
  expect((await impactOfChange(db, s.id, { upsert: { ...next, id: x.id } })).map((y) => y.id)).toEqual([r.id])
  await saveAttendance(db, next, x.id)
  await reconcileStudent(db, s.id)
  const [after] = await listReportsByStudent(db, s.id)
  expect(after).toMatchObject({ id: r.id, submitted: true, stale: true, period: '2' })
})

test('두 신고서가 합쳐질 때 제출된 쪽을 남기고, 지나간 경고가 계속 뜨지 않는다', async () => {
  const { db, s } = await setup()
  await add(db, s.id, '2026-11-09')
  await add(db, s.id, '2026-11-11')
  const rs = await listReportsByStudent(db, s.id)
  const sub = rs.find((r) => r.start_date === '2026-11-11')!
  await updateReport(db, sub.id, { submitted: true, detail: '직접 쓴 사유' })
  const hit = await impactOfChange(db, s.id, { upsert: a(s.id, '2026-11-10') })
  expect(hit.map((r) => r.id)).toContain(sub.id)
  await add(db, s.id, '2026-11-10')
  const all = await listReportsByStudent(db, s.id)
  expect(all).toHaveLength(1)
  expect(all[0]).toMatchObject({ id: sub.id, start_date: '2026-11-09', end_date: '2026-11-11', submitted: true, stale: true, detail: '직접 쓴 사유' })
  expect(await impactOfChange(db, s.id, { upsert: a(s.id, '2026-11-20') })).toEqual([])
})

test('직접 고친 미제출 신고서가 사라질 변경도 경고한다', async () => {
  const { db, s } = await setup()
  const x = await add(db, s.id, '2026-11-09')
  const [r] = await listReportsByStudent(db, s.id)
  await updateReport(db, r.id, { detail: '고친 사유' })
  expect((await impactOfChange(db, s.id, { removeId: x.id })).map((y) => y.id)).toEqual([r.id])
})

test('updateReport는 동시에 불러도 서로 지우지 않고, toggleConfirmMethod는 최신 값 기준', async () => {
  const { db, s } = await setup()
  await add(db, s.id, '2026-11-09')
  const [r] = await listReportsByStudent(db, s.id)
  const want = [...new Set([...r.confirm_methods, 0, 2])].sort((x, y) => x - y)
  await Promise.all([toggleConfirmMethod(db, r.id, 0, true), toggleConfirmMethod(db, r.id, 2, true)])
  expect((await listReportsByStudent(db, s.id))[0].confirm_methods).toEqual(want)
})
