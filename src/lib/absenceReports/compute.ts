import type { AttendanceCategory, AttendanceKind, AttendanceRec, EvidenceType } from '../db/types'
import type { SchoolDays } from '../schoolDays'

export interface ReportRules {
  /** '결석:질병' 형식 */
  rules: string[]
  /** 이 일수 이상 질병 결석이면 진단서 필요 */
  diagnosisDays: number
}

export interface ReportDraft {
  student_id: string
  kind: AttendanceKind
  category: AttendanceCategory
  start_date: string
  end_date: string
  period: string | null
  school_days: number
  evidence_type: EvidenceType
  confirm_methods: number[]
  diagnosis_required: boolean
  detail: string
  written_date: string
  confirmed_date: string
  attendance_ids: string[]
  warnings: string[]
}

const MAX_DETAIL = 40
/** 담임 확인 방법 번호 */
export const CONFIRM = { 진단서: 2, 보호자통화: 3 } as const

export function needsReport(a: { kind: AttendanceKind; category: AttendanceCategory }, rules: ReportRules): boolean {
  return rules.rules.includes(`${a.kind}:${a.category}`)
}

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
const byDate = (a: AttendanceRec, b: AttendanceRec) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

function evidence(kind: AttendanceKind, category: AttendanceCategory, schoolDays: number, first: AttendanceRec, rules: ReportRules) {
  if (category === '질병') {
    const long = kind === '결석' && schoolDays >= rules.diagnosisDays
    return long
      ? { evidence_type: '3일 이상 질병' as EvidenceType, confirm_methods: [CONFIRM.진단서], diagnosis_required: true }
      : { evidence_type: '2일 이내 질병' as EvidenceType, confirm_methods: [CONFIRM.보호자통화], diagnosis_required: false }
  }
  if (category === '출석인정') return { evidence_type: (first.evidence_type ?? '기타') as EvidenceType, confirm_methods: [], diagnosis_required: false }
  return { evidence_type: '' as EvidenceType, confirm_methods: [], diagnosis_required: false }
}

function draftFrom(group: AttendanceRec[], days: SchoolDays, rules: ReportRules): ReportDraft {
  const first = group[0]
  const last = group[group.length - 1]
  const warnings: string[] = []
  const schoolDays = first.kind === '결석' ? group.filter((a) => days.isClassDay(a.date)).length : 0
  for (const a of group) if (!days.isClassDay(a.date)) warnings.push(`${md(a.date)}은(는) 수업일이 아닙니다.`)
  let detail = (first.reason ?? '').trim()
  if (detail.length > MAX_DETAIL) {
    detail = detail.slice(0, MAX_DETAIL)
    warnings.push('상세 사유가 40자를 넘어 잘랐습니다.')
  }
  const next = days.nextClassDay(last.date)
  return {
    student_id: first.student_id,
    kind: first.kind,
    category: first.category,
    start_date: first.date,
    end_date: last.date,
    period: first.kind === '결석' ? null : first.period,
    school_days: schoolDays,
    ...evidence(first.kind, first.category, schoolDays, first, rules),
    detail,
    written_date: next,
    confirmed_date: next,
    attendance_ids: group.map((a) => a.id),
    warnings,
  }
}

/** 한 학생의 출결로 신고서 묶음을 계산한다. */
export function computeDrafts(attendances: AttendanceRec[], days: SchoolDays, rules: ReportRules): ReportDraft[] {
  const eligible = attendances.filter((a) => !a.deleted && needsReport(a, rules)).sort(byDate)
  const groups: AttendanceRec[][] = []
  const openAbsence = new Map<string, AttendanceRec[]>() // category별 진행 중인 결석 묶음
  for (const a of eligible) {
    if (a.kind !== '결석') {
      groups.push([a])
      continue
    }
    const cur = openAbsence.get(a.category)
    if (cur && days.nextClassDay(cur[cur.length - 1].date) === a.date) cur.push(a)
    else {
      const g = [a]
      groups.push(g)
      openAbsence.set(a.category, g)
    }
  }
  return groups.map((g) => draftFrom(g, days, rules)).sort((x, y) => (x.start_date < y.start_date ? -1 : x.start_date > y.start_date ? 1 : 0))
}

/** 토큰: {학년} {반} {반2} {번호} {번호2} */
export function studentCode(format: string, grade: number, classNo: number, number: number): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return format
    .replace(/\{학년\}/g, String(grade))
    .replace(/\{반2\}/g, p2(classNo))
    .replace(/\{반\}/g, String(classNo))
    .replace(/\{번호2\}/g, p2(number))
    .replace(/\{번호\}/g, String(number))
}
