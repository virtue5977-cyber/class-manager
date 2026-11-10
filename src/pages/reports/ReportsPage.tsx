import MonthPicker, { shiftMonth } from '../../components/MonthPicker'
import PageHead from '../../components/PageHead'
import { useShortcut } from '../../lib/ui/shortcuts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import { listReportsForMonth, setSubmittedMany, type ReportRow } from '../../lib/absenceReports/list'
import { updateReport } from '../../lib/absenceReports/reconcile'
import { buildAbsenceHwpx } from '../../lib/hwpx/absence/build'
import ExportMenu from '../../components/ExportMenu'
import { exportPdf } from '../../lib/export/pdf'
import { reportsXlsx } from '../../lib/export/sheets'
import { isHideNames } from '../../components/HideNames'
import { toYmd } from '../../lib/schoolDays'
import { periodText } from '../attendance/AttendanceForm'
import { ClassSelect, NoClass, useClasses } from '../common/useClasses'

const kindText = (r: ReportRow['report']) => `${r.kind}${r.period ? ` ${r.period}교시` : ''}(${r.category})`

export default function ReportsPage({ month: initialMonth = toYmd(new Date()).slice(0, 7) }: { month?: string }) {
  const db = useDb()
  const fs = useFs()
  const { classes, classId, choose } = useClasses()
  const [month, setMonth] = useState(initialMonth)
  useShortcut('step', (a) => a.kind === 'step' && month && setMonth(shiftMonth(month, a.dir)))
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

  const exportRows = (list: ReportRow[], mode: 'one' | 'zip') =>
    act(async () => {
      if (!list.length) throw new Error('내보낼 신고서를 고르세요.')
      const out = await buildAbsenceHwpx(db, list.map((r) => r.report), { stuName, mode })
      fs.downloadFile(out.fileName, out.bytes)
      setMessages(out.warnings.length ? out.warnings : [`${out.fileName} 파일을 만들었습니다.`])
    })
  const exportPicked = (mode: 'one' | 'zip') => exportRows(pickedRows, mode)
  const openRows = rows.filter((r) => !r.report.submitted)

  return (
    <section className="stack">
      <PageHead title="결석신고서" summary={`전체 ${rows.length}건 · 미제출 ${open}건 · 진단서 미수령 ${missingDiag}건`}>
          {classes && <ClassSelect classes={classes} classId={classId} onChange={choose} />}
          <MonthPicker value={month} onChange={setMonth} />
          <label className="inline">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            미제출만
          </label>
          {openRows.length > 0 && (
            <button type="button" className="primary" onClick={() => exportRows(openRows, 'one')}>
              {`미제출 ${openRows.length}건 한글로 받기`}
            </button>
          )}
          {shown.length > 0 && (
            <ExportMenu
              items={[
                { format: 'hwpx', run: () => exportRows(shown, 'one') },
                { format: 'xlsx', run: () => act(async () => { const name = `결석신고서_${month}.xlsx`; fs.downloadFile(name, await reportsXlsx(shown, (st) => (isHideNames() ? '' : st.name)) ); setMessages([`${name} 파일을 만들었습니다.`]) }) },
                { format: 'pdf', run: () => exportPdf(`결석신고서_${month}.pdf`) },
              ]}
            />
          )}
      </PageHead>
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
                    <td className="pii">
                      <a href={`#/attendance?date=${r.start_date}`} title="그날 출결 화면으로">
                        {who}
                      </a>
                    </td>
                    <td>
                      {periodText(r)}
                      {r.stale && <span className="tag warn"> 다시 확인</span>}
                    </td>
                    <td>{kindText(r)}</td>
                    <td>{r.kind === '결석' ? `${r.school_days}일` : ''}</td>
                    <td>{r.evidence_type}</td>
                    <td>
                      {r.diagnosis_required ? (
                        <button
                          type="button"
                          role="switch"
                          aria-label={`${label} 진단서 수령`}
                          aria-checked={r.diagnosis_received}
                          className={`pill ${r.diagnosis_received ? 'status-나이스' : 'warn-pill'}`}
                          onClick={() => act(async () => void (await updateReport(db, r.id, { diagnosis_received: !r.diagnosis_received })))}
                        >
                          {r.diagnosis_received ? '수령' : '필요'}
                        </button>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-label={`${label} 제출`}
                        aria-checked={r.submitted}
                        title="눌러서 바꾸기"
                        className={`pill ${r.submitted ? 'status-나이스' : 'status-미정리'}`}
                        onClick={() => act(() => setSubmittedMany(db, [r.id], !r.submitted))}
                      >
                        {r.submitted ? '제출' : '미제출'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {pickedRows.length > 0 && (
      <div className="row select-bar">
        <span className="muted">{`${pickedRows.length}건 선택`}</span>
        <button type="button" onClick={() => act(() => setSubmittedMany(db, pickedRows.map((r) => r.report.id), true))}>
          선택 제출로 표시
        </button>
        <button type="button" onClick={() => act(() => setSubmittedMany(db, pickedRows.map((r) => r.report.id), false))}>
          선택 미제출로 표시
        </button>
        <label className="inline">
          <input type="checkbox" checked={stuName} onChange={(e) => setStuName(e.target.checked)} />
          학생 성명 칸에 이름 인쇄
        </label>
        <button type="button" onClick={() => exportPicked('one')}>
          선택 hwpx 한 파일
        </button>
        <button type="button" onClick={() => exportPicked('zip')}>
          학생별 zip
        </button>
      </div>
      )}
    </section>
  )
}
