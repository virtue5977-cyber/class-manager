import { useCallback, useEffect, useRef, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import { listReportsForMonth, setSubmittedMany, type ReportRow } from '../../lib/absenceReports/list'
import { updateReport } from '../../lib/absenceReports/reconcile'
import { buildAbsenceHwpx } from '../../lib/hwpx/absence/build'
import { toYmd } from '../../lib/schoolDays'
import { periodText } from '../attendance/AttendanceForm'
import { ClassSelect, NoClass, useClasses } from '../common/useClasses'

const kindText = (r: ReportRow['report']) => `${r.kind}${r.period ? ` ${r.period}교시` : ''}(${r.category})`

export default function ReportsPage({ month: initialMonth = toYmd(new Date()).slice(0, 7) }: { month?: string }) {
  const db = useDb()
  const fs = useFs()
  const { classes, classId, choose } = useClasses()
  const [month, setMonth] = useState(initialMonth)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [stuName, setStuName] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const seq = useRef(0)

  const reload = useCallback(async () => {
    if (!classId) return
    const n = ++seq.current
    const list = await listReportsForMonth(db, classId, month)
    if (n === seq.current) setRows(list)
  }, [db, classId, month])
  useEffect(() => {
    setPicked(new Set())
    reload()
  }, [reload])

  if (classes && classes.length === 0) return <NoClass title="결석신고서" />

  const shown = onlyOpen ? rows.filter((r) => !r.report.submitted) : rows
  const open = rows.filter((r) => !r.report.submitted).length
  const missingDiag = rows.filter((r) => r.report.diagnosis_required && !r.report.diagnosis_received).length
  const pickedRows = shown.filter((r) => picked.has(r.report.id))
  const allPicked = shown.length > 0 && pickedRows.length === shown.length

  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  async function act(fn: () => Promise<void>) {
    try {
      setMessages([])
      await fn()
    } catch (e) {
      setMessages([e instanceof Error ? e.message : String(e)])
    }
    await reload()
  }

  const exportPicked = (mode: 'one' | 'zip') =>
    act(async () => {
      if (!pickedRows.length) throw new Error('내보낼 신고서를 고르세요.')
      const out = await buildAbsenceHwpx(db, pickedRows.map((r) => r.report), { stuName, mode })
      fs.downloadFile(out.fileName, out.bytes)
      setMessages(out.warnings.length ? out.warnings : [`${out.fileName} 파일을 만들었습니다.`])
    })

  return (
    <section className="stack">
      <h2>결석신고서</h2>
      <div className="row">
        {classes && <ClassSelect classes={classes} classId={classId} onChange={choose} />}
        <label className="inline">
          월
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          미제출만
        </label>
      </div>
      <p className="summary">{`전체 ${rows.length}건 · 미제출 ${open}건 · 진단서 미수령 ${missingDiag}건`}</p>
      {messages.length > 0 && (
        <div className="notice" role="status">
          {messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="muted">{rows.length ? '미제출 신고서가 없습니다.' : '이 달의 신고서가 없습니다.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="모두 선택"
                    checked={allPicked}
                    onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.report.id)) : new Set())}
                  />
                </th>
                <th>학생</th>
                <th>기간</th>
                <th>출결</th>
                <th>수업일</th>
                <th>증빙</th>
                <th>진단서</th>
                <th>제출</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ report: r, student: s }) => {
                const who = `${s.number}번 ${s.name}`
                const label = `${who} ${periodText(r)}`
                return (
                  <tr key={r.id} className={r.submitted ? 'done' : undefined}>
                    <td>
                      <input type="checkbox" aria-label={`${label} 선택`} checked={picked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
                    </td>
                    <td className="pii">{who}</td>
                    <td>
                      {periodText(r)}
                      {r.stale && <span className="tag warn"> 다시 확인</span>}
                    </td>
                    <td>{kindText(r)}</td>
                    <td>{r.kind === '결석' ? `${r.school_days}일` : ''}</td>
                    <td>{r.evidence_type}</td>
                    <td>
                      {r.diagnosis_required ? (
                        <label className="inline">
                          <input
                            type="checkbox"
                            aria-label={`${label} 진단서 수령`}
                            checked={r.diagnosis_received}
                            onChange={(e) => act(async () => void (await updateReport(db, r.id, { diagnosis_received: e.target.checked })))}
                          />
                          {r.diagnosis_received ? '수령' : '필요'}
                        </label>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${label} 제출`}
                        checked={r.submitted}
                        onChange={(e) => act(() => setSubmittedMany(db, [r.id], e.target.checked))}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <span className="muted">{`${pickedRows.length}건 선택`}</span>
        <button type="button" disabled={!pickedRows.length} onClick={() => act(() => setSubmittedMany(db, pickedRows.map((r) => r.report.id), true))}>
          선택 제출로 표시
        </button>
        <button type="button" disabled={!pickedRows.length} onClick={() => act(() => setSubmittedMany(db, pickedRows.map((r) => r.report.id), false))}>
          선택 미제출로 표시
        </button>
        <label className="inline">
          <input type="checkbox" checked={stuName} onChange={(e) => setStuName(e.target.checked)} />
          학생 성명 칸에 이름 인쇄
        </label>
        <button type="button" className="primary" disabled={!pickedRows.length} onClick={() => exportPicked('one')}>
          선택 hwpx 한 파일
        </button>
        <button type="button" disabled={!pickedRows.length} onClick={() => exportPicked('zip')}>
          학생별 zip
        </button>
      </div>
    </section>
  )
}
