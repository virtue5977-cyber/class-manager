import type { AbsenceReportRec, ReportAttendanceRec } from '../db/types'
import { newerWins } from '../vault/merge'

/** 결석신고서 결정적 id(spec §7.3). 칸은 uuid·날짜·열거값이라 ':'를 담지 않는다. */
export const reportId = (d: { student_id: string; start_date: string; kind: string; category: string }): string =>
  `report:${d.student_id}:${d.start_date}:${d.kind}:${d.category}`

export const linkId = (rid: string, attendanceId: string): string => `ra:${rid}:${attendanceId}`

/** 옮기기용: 옛(무작위 id) 신고서·연결을 결정적 id로 바꾼다. 같은 id로 겹치면 지우지 않은·최신 것 하나만 남긴다. */
export function remapReportIds(
  reports: AbsenceReportRec[],
  links: ReportAttendanceRec[],
): { reports: AbsenceReportRec[]; links: ReportAttendanceRec[]; map: Map<string, string> } {
  const map = new Map<string, string>()
  const best = new Map<string, AbsenceReportRec>()
  for (const r of reports) {
    const nid = reportId(r)
    map.set(r.id, nid)
    const cur = best.get(nid)
    if (!cur) { best.set(nid, r); continue }
    if (cur.deleted !== r.deleted) best.set(nid, r.deleted ? cur : r)
    else best.set(nid, newerWins(cur, r))
  }
  const outReports = [...best].map(([nid, r]) => ({ ...r, id: nid }))
  const outLinks = new Map<string, ReportAttendanceRec>()
  for (const l of links) {
    const nr = map.get(l.report_id)
    if (!nr) continue
    const nl = { ...l, report_id: nr, id: linkId(nr, l.attendance_id) }
    const cur = outLinks.get(nl.id)
    if (!cur) outLinks.set(nl.id, nl)
    else if (cur.deleted !== nl.deleted) { if (cur.deleted) outLinks.set(nl.id, nl) }
    else outLinks.set(nl.id, newerWins(cur, nl))
  }
  return { reports: outReports, links: [...outLinks.values()], map }
}
