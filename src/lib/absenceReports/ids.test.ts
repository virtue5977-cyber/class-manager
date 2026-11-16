// @vitest-environment node
import { reportId, linkId, remapReportIds } from './ids'
import type { AbsenceReportRec } from '../db/types'

const uuid = '3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab'
const rep = (o: Partial<AbsenceReportRec> & { id: string }): AbsenceReportRec =>
  ({ student_id: uuid, start_date: '2026-11-06', kind: '결석', category: '질병', created_at: '2026-11-06T00:00:00.000Z', updated_at: '2026-11-06T00:00:00.000Z', deleted: false, ...o }) as AbsenceReportRec
const lk = (id: string, report_id: string, attendance_id: string) => ({ id, report_id, attendance_id, created_at: 'x', updated_at: 'x', deleted: false })

test('id 형식', () => {
  const r = reportId({ student_id: uuid, start_date: '2026-11-06', kind: '결석', category: '질병' })
  expect(r).toBe(`report:${uuid}:2026-11-06:결석:질병`)
  expect(linkId(r, 'att1')).toBe(`ra:${r}:att1`)
})

test('remapReportIds가 연결도 함께 바꿈', () => {
  const r1 = rep({ id: 'old1' })
  const { reports, links, map } = remapReportIds([r1], [lk('l1', 'old1', 'a1'), lk('l2', 'old1', 'a2')])
  const nid = reportId(r1)
  expect(map.get('old1')).toBe(nid)
  expect(reports.map((r) => r.id)).toEqual([nid])
  expect(links.map((l) => [l.id, l.report_id]).sort()).toEqual([[`ra:${nid}:a1`, nid], [`ra:${nid}:a2`, nid]])
})

test('remapReportIds 중복: 최신 updated_at(지우지 않은 쪽 우선) 생존, 연결 합침', () => {
  const a = rep({ id: 'a', updated_at: '2026-11-07T00:00:00.000Z' })
  const b = rep({ id: 'b', updated_at: '2026-11-09T00:00:00.000Z', deleted: true })
  const c = rep({ id: 'c', updated_at: '2026-11-08T00:00:00.000Z' })
  const { reports, links, map } = remapReportIds([a, b, c], [lk('1', 'a', 'x'), lk('2', 'b', 'x'), lk('3', 'c', 'x'), lk('4', 'c', 'y'), lk('5', 'b', 'z')])
  expect(reports).toHaveLength(1)
  expect(reports[0].updated_at).toBe(c.updated_at)
  expect(map.get('a')).toBe(map.get('c'))
  expect(map.get('b')).toBe(map.get('c'))
  expect(links.map((l) => l.attendance_id).sort()).toEqual(['x', 'y', 'z'])
  expect(new Set(links.map((l) => l.id)).size).toBe(3)
  expect(links.every((l) => l.report_id === reports[0].id)).toBe(true)
})
