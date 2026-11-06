// @vitest-environment node
import { computeDrafts, needsReport, studentCode, type ReportRules } from './compute'
import { SchoolDays } from '../schoolDays'
import { newRecord } from '../db/records'
import type { AttendanceRec, SchoolCalendarRec } from '../db/types'

const RULES: ReportRules = { rules: ['결석:질병', '결석:출석인정', '지각:출석인정', '조퇴:출석인정', '결과:출석인정'], diagnosisDays: 3 }
const days = (closed: string[] = []) =>
  new SchoolDays(closed.map((date) => newRecord({ date, title: '휴업', type: '휴업일' as const, is_class_day: false, source: 'neis' as const, grades: null }) as SchoolCalendarRec))
const att = (date: string, over: Partial<AttendanceRec> = {}): AttendanceRec =>
  newRecord({ student_id: 's1', date, kind: '결석' as const, category: '질병' as const, period: null, reason: '감기', evidence_type: null, memo: '', ...over }) as AttendanceRec

test('기본 규칙: 미인정·질병 지각은 없음, 질병 결석·출석인정 지각은 있음', () => {
  expect(needsReport({ kind: '결석', category: '미인정' }, RULES)).toBe(false)
  expect(needsReport({ kind: '지각', category: '질병' }, RULES)).toBe(false)
  expect(needsReport({ kind: '결석', category: '질병' }, RULES)).toBe(true)
  expect(needsReport({ kind: '지각', category: '출석인정' }, RULES)).toBe(true)
})

test('규칙에 "지각:질병"을 넣으면 질병 지각도 신고서, 증빙 2일 이내 질병', () => {
  const d = computeDrafts([att('2026-11-05', { kind: '지각', period: '1' })], days(), { ...RULES, rules: [...RULES.rules, '지각:질병'] })
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ kind: '지각', evidence_type: '2일 이내 질병', confirm_methods: [3], school_days: 0, period: '1' })
})

test('금·월 질병 결석은 한 장, 수업일 2 → 2일 이내 질병, 확인 [3]', () => {
  const a1 = att('2026-11-06')
  const a2 = att('2026-11-09')
  const d = computeDrafts([a2, a1], days(), RULES)
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ start_date: '2026-11-06', end_date: '2026-11-09', school_days: 2, evidence_type: '2일 이내 질병', confirm_methods: [3], diagnosis_required: false, detail: '감기' })
  expect(d[0].attendance_ids.sort()).toEqual([a1.id, a2.id].sort())
})

test('월·화·수 → 3일 이상 질병, 진단서 필요, 확인 [2]; diagnosisDays 4면 3일도 2일 이내', () => {
  const list = ['2026-11-09', '2026-11-10', '2026-11-11'].map((x) => att(x))
  expect(computeDrafts(list, days(), RULES)[0]).toMatchObject({ school_days: 3, evidence_type: '3일 이상 질병', diagnosis_required: true, confirm_methods: [2] })
  expect(computeDrafts(list, days(), { ...RULES, diagnosisDays: 4 })[0]).toMatchObject({ evidence_type: '2일 이내 질병', diagnosis_required: false })
})

test('사이 휴업일(11-10)이 있으면 11-09·11-11은 한 장, 수업일 2', () => {
  const d = computeDrafts([att('2026-11-09'), att('2026-11-11')], days(['2026-11-10']), RULES)
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ start_date: '2026-11-09', end_date: '2026-11-11', school_days: 2 })
})

test('질병 결석과 출석인정 결석은 이어져도 따로; 하루 빠지면 두 장', () => {
  expect(computeDrafts([att('2026-11-09'), att('2026-11-10', { category: '출석인정' })], days(), RULES)).toHaveLength(2)
  expect(computeDrafts([att('2026-11-09'), att('2026-11-11')], days(), RULES)).toHaveLength(2)
})

test('출석인정 지각: 교시 유지, 증빙은 evidence_type(없으면 기타), 확인 []', () => {
  const d = computeDrafts([
    att('2026-11-05', { kind: '지각', category: '출석인정', period: '2', evidence_type: '경조사 참석' }),
    att('2026-11-06', { kind: '조퇴', category: '출석인정', period: '3~4' }),
  ], days(), RULES)
  expect(d.map((x) => [x.kind, x.period, x.evidence_type, x.confirm_methods.length])).toEqual([['지각', '2', '경조사 참석', 0], ['조퇴', '3~4', '기타', 0]])
})

test('미인정 결석을 규칙에 넣으면 증빙 빈값', () => {
  const d = computeDrafts([att('2026-11-05', { category: '미인정' })], days(), { ...RULES, rules: ['결석:미인정'] })
  expect(d[0]).toMatchObject({ evidence_type: '', confirm_methods: [] })
})

test('작성일·확인일 = 종료일 다음 수업일', () => {
  const d = computeDrafts([att('2026-11-06')], days(), RULES)
  expect(d[0]).toMatchObject({ written_date: '2026-11-09', confirmed_date: '2026-11-09' })
})

test('사유 41자 → 40자, 경고', () => {
  const d = computeDrafts([att('2026-11-05', { reason: '가'.repeat(41) })], days(), RULES)
  expect(d[0].detail).toHaveLength(40)
  expect(d[0].warnings).toContain('상세 사유가 40자를 넘어 잘랐습니다.')
})

test('수업일이 아닌 날의 결석은 경고', () => {
  expect(computeDrafts([att('2026-11-07')], days(), RULES)[0].warnings).toContain('11/7은(는) 수업일이 아닙니다.')
})

test('studentCode 기본 1503, {학년}{반2}{번호2} → 10503, 12반 → 11203', () => {
  expect(studentCode('{학년}{반}{번호2}', 1, 5, 3)).toBe('1503')
  expect(studentCode('{학년}{반2}{번호2}', 1, 5, 3)).toBe('10503')
  expect(studentCode('{학년}{반}{번호2}', 1, 12, 3)).toBe('11203')
  expect(studentCode('{학년}-{반}-{번호}', 2, 3, 7)).toBe('2-3-7')
})
