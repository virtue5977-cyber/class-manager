import type { AppDB } from '../db/schema'
import { newRecord, save } from '../db/records'
import type { AbsenceReportRec, AttendanceRec } from '../db/types'
import { listAttendanceByStudent, type AttendanceInput } from '../attendance/attendance'
import { listCalendar } from '../neis/schedule'
import { SchoolDays } from '../schoolDays'
import { getSettings } from '../settings'
import { listStudents } from '../roster/roster'
import { computeDrafts, type ReportDraft, type ReportRules } from './compute'

export const OVERRIDABLE = ['detail', 'evidence_type', 'confirm_methods', 'written_date', 'confirmed_date'] as const
export type OverridableField = (typeof OVERRIDABLE)[number]

export async function loadReportContext(db: AppDB): Promise<{ days: SchoolDays; rules: ReportRules }> {
  const [calendar, s] = await Promise.all([listCalendar(db, '0000-01-01', '9999-12-31'), getSettings(db)])
  return { days: new SchoolDays(calendar), rules: { rules: s.report_rules, diagnosisDays: s.diagnosis_days } }
}

export async function listReportsByStudent(db: AppDB, studentId: string): Promise<AbsenceReportRec[]> {
  return (await db.absence_reports.where('student_id').equals(studentId).toArray())
    .filter((r) => !r.deleted)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.kind < b.kind ? -1 : 1))
}

/** 여러 학생의 신고서를 한 번에 읽어 학생별로 묶는다(학생 수만큼 따로 묻지 않게). */
export async function listReportsByStudents(db: AppDB, ids: string[]): Promise<Record<string, AbsenceReportRec[]>> {
  const out: Record<string, AbsenceReportRec[]> = Object.fromEntries(ids.map((id) => [id, []]))
  for (const r of await db.absence_reports.where('student_id').anyOf(ids).toArray()) if (!r.deleted) out[r.student_id]?.push(r)
  for (const list of Object.values(out)) list.sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.kind < b.kind ? -1 : 1))
  return out
}

export async function getReportAttendanceIds(db: AppDB, reportId: string): Promise<string[]> {
  return (await db.report_attendance.where('report_id').equals(reportId).toArray()).filter((l) => !l.deleted).map((l) => l.attendance_id)
}

interface Plan {
  matches: { draft: ReportDraft; report: AbsenceReportRec; changed: boolean }[]
  creates: ReportDraft[]
  orphans: AbsenceReportRec[]
}

/** 출결 id가 가장 많이 겹치는 기존 신고서를 같은 신고서로 본다(순수). */
function planReconcile(reports: AbsenceReportRec[], links: Map<string, string[]>, drafts: ReportDraft[]): Plan {
  const pairs: { d: number; r: number; overlap: number }[] = []
  drafts.forEach((draft, d) =>
    reports.forEach((rep, r) => {
      const ids = new Set(links.get(rep.id) ?? [])
      const overlap = draft.attendance_ids.filter((id) => ids.has(id)).length
      if (overlap > 0) pairs.push({ d, r, overlap })
    }),
  )
  // 겹침이 같으면 제출된 것 → 직접 고친 것 → 먼저 만든 것을 남긴다(제출본이 고아가 되지 않게).
  const rank = (r: AbsenceReportRec) => [r.submitted ? 0 : 1, -r.overrides.length, r.created_at] as const
  pairs.sort((x, y) => {
    if (y.overlap !== x.overlap) return y.overlap - x.overlap
    const [a1, a2, a3] = rank(reports[x.r])
    const [b1, b2, b3] = rank(reports[y.r])
    return a1 - b1 || a2 - b2 || (a3 < b3 ? -1 : a3 > b3 ? 1 : 0)
  })
  const usedD = new Set<number>()
  const usedR = new Set<number>()
  const matches: Plan['matches'] = []
  for (const p of pairs) {
    if (usedD.has(p.d) || usedR.has(p.r)) continue
    usedD.add(p.d)
    usedR.add(p.r)
    const draft = drafts[p.d]
    const rep = reports[p.r]
    const before = [...(links.get(rep.id) ?? [])].sort().join(',')
    const after = [...draft.attendance_ids].sort().join(',')
    // 구성(출결 id)뿐 아니라 직접 고치지 않은 자동 칸이 하나라도 바뀌면 '바뀜'으로 본다.
    const cur = rep as unknown as Record<string, unknown>
    const fieldChanged = Object.entries(computedFields(draft)).some(([k, v]) => !rep.overrides.includes(k) && JSON.stringify(cur[k]) !== JSON.stringify(v))
    const changed = before !== after || fieldChanged
    matches.push({ draft, report: rep, changed })
  }
  return {
    matches,
    creates: drafts.filter((_, i) => !usedD.has(i)),
    orphans: reports.filter((_, i) => !usedR.has(i)),
  }
}

async function loadState(db: AppDB, studentId: string) {
  const reports = await listReportsByStudent(db, studentId)
  const links = new Map<string, string[]>()
  for (const r of reports) links.set(r.id, await getReportAttendanceIds(db, r.id))
  return { reports, links }
}

function computedFields(d: ReportDraft) {
  const { attendance_ids: _a, warnings: _w, ...rest } = d
  return rest
}

export async function reconcileStudent(db: AppDB, studentId: string): Promise<{ created: number; updated: number; removed: number; staled: number }> {
  const ctx = await loadReportContext(db)
  const drafts = computeDrafts(await listAttendanceByStudent(db, studentId), ctx.days, ctx.rules)
  const out = { created: 0, updated: 0, removed: 0, staled: 0 }
  await db.transaction('rw', db.absence_reports, db.report_attendance, async () => {
    const { reports, links } = await loadState(db, studentId)
    const plan = planReconcile(reports, links, drafts)
    const now = new Date()
    const setLinks = async (reportId: string, ids: string[]) => {
      const cur = (await db.report_attendance.where('report_id').equals(reportId).toArray()).filter((l) => !l.deleted)
      for (const l of cur) if (!ids.includes(l.attendance_id)) await db.report_attendance.put({ ...l, deleted: true, updated_at: now.toISOString() })
      const have = new Set(cur.map((l) => l.attendance_id))
      for (const id of ids) if (!have.has(id)) await db.report_attendance.add(newRecord({ report_id: reportId, attendance_id: id }, now))
    }
    for (const m of plan.matches) {
      const next: AbsenceReportRec = { ...m.report }
      const fields = computedFields(m.draft) as Record<string, unknown>
      for (const [k, v] of Object.entries(fields)) if (!m.report.overrides.includes(k)) (next as unknown as Record<string, unknown>)[k] = v
      const becameStale = m.changed && (m.report.submitted || m.report.overrides.length > 0)
      if (becameStale) {
        next.stale = true
        out.staled++
      }
      if (JSON.stringify(next) !== JSON.stringify(m.report)) {
        await save(db.absence_reports, next, now)
        out.updated++
      }
      await setLinks(m.report.id, m.draft.attendance_ids)
    }
    for (const d of plan.creates) {
      const rec = newRecord(
        { ...computedFields(d), diagnosis_received: false, submitted: false, submitted_at: null, overrides: [], stale: false },
        now,
      ) as AbsenceReportRec
      await db.absence_reports.add(rec)
      await setLinks(rec.id, d.attendance_ids)
      out.created++
    }
    for (const r of plan.orphans) {
      if (r.submitted) {
        if (!r.stale) {
          await save(db.absence_reports, { ...r, stale: true }, now)
          out.staled++
        }
      } else {
        await save(db.absence_reports, { ...r, deleted: true }, now)
        await setLinks(r.id, [])
        out.removed++
      }
    }
  })
  return out
}

export async function reconcileAll(db: AppDB, classId: string): Promise<void> {
  for (const s of await listStudents(db, classId)) await reconcileStudent(db, s.id)
}

/** 변경을 적용하면 바뀌거나 사라지는, 제출했거나 직접 고친 신고서(저장 전 경고용, DB 변경 없음). */
export async function impactOfChange(
  db: AppDB,
  studentId: string,
  change: { upsert?: AttendanceInput & { id?: string }; removeId?: string },
): Promise<AbsenceReportRec[]> {
  return impactOfChanges(db, studentId, { upserts: change.upsert ? [change.upsert] : [], removeIds: change.removeId ? [change.removeId] : [] })
}

/** 여러 출결을 한꺼번에 바꿀 때(결석 기간) 영향을 받는 제출·직접 고친 신고서 */
export async function impactOfChanges(
  db: AppDB,
  studentId: string,
  change: { upserts: (AttendanceInput & { id?: string })[]; removeIds: string[] },
): Promise<AbsenceReportRec[]> {
  const ctx = await loadReportContext(db)
  const current: AttendanceRec[] = await listAttendanceByStudent(db, studentId)
  let atts = current.filter((a) => !change.removeIds.includes(a.id))
  for (const [k, up] of change.upserts.entries()) {
    const { id, ...fields } = up
    const base = id ? atts.find((a) => a.id === id) : undefined
    const rec = (base ? { ...base, ...fields } : { ...newRecord(fields), id: `pending-${k}` }) as AttendanceRec
    atts = [...atts.filter((a) => a.id !== rec.id), rec]
  }
  const { reports, links } = await loadState(db, studentId)
  const touched = (p: Plan) => new Set([...p.matches.filter((m) => m.changed).map((m) => m.report.id), ...p.orphans.map((r) => r.id)])
  // 이미 고아·바뀜 상태인 신고서(예: 남겨 둔 제출본)는 이번 변경 탓이 아니므로 뺀다.
  const before = touched(planReconcile(reports, links, computeDrafts(current, ctx.days, ctx.rules)))
  const after = touched(planReconcile(reports, links, computeDrafts(atts, ctx.days, ctx.rules)))
  return reports.filter((r) => after.has(r.id) && !before.has(r.id) && (r.submitted || r.overrides.length > 0))
}

type ReportPatch = Partial<Pick<AbsenceReportRec, OverridableField | 'submitted' | 'diagnosis_received'>>

/** 사용자가 신고서를 고친다. 고친 자동 칸은 overrides에 기록하고, 저장하면 stale을 푼다. */
export async function updateReport(db: AppDB, id: string, patch: ReportPatch | ((cur: AbsenceReportRec) => ReportPatch)): Promise<AbsenceReportRec> {
  // 읽고 쓰기를 한 트랜잭션에서 해야 빠른 연속 클릭이 서로를 덮어쓰지 않는다.
  return db.transaction('rw', db.absence_reports, async () => {
    const cur = await db.absence_reports.get(id)
    if (!cur) throw new Error('신고서를 찾을 수 없습니다.')
    const p = typeof patch === 'function' ? patch(cur) : patch
    const overrides = new Set(cur.overrides)
    for (const k of OVERRIDABLE) if (k in p) overrides.add(k)
    const next: AbsenceReportRec = { ...cur, ...p, overrides: [...overrides], stale: false }
    if ('submitted' in p) next.submitted_at = p.submitted ? new Date().toISOString() : null
    return save(db.absence_reports, next)
  })
}

/** 확인 방법 하나를 켜고 끈다(저장된 최신 값 기준). */
export function toggleConfirmMethod(db: AppDB, id: string, method: number, on: boolean): Promise<AbsenceReportRec> {
  return updateReport(db, id, (cur) => ({
    confirm_methods: on ? [...new Set([...cur.confirm_methods, method])].sort((a, b) => a - b) : cur.confirm_methods.filter((x) => x !== method),
  }))
}

export async function resetOverride(db: AppDB, id: string, field: OverridableField): Promise<void> {
  const cur = await db.transaction('rw', db.absence_reports, async () => {
    const c = await db.absence_reports.get(id)
    if (c) await save(db.absence_reports, { ...c, overrides: c.overrides.filter((f) => f !== field) })
    return c
  })
  if (cur) await reconcileStudent(db, cur.student_id)
}

