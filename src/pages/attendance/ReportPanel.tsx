import { useCallback, useEffect, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import type { AbsenceReportRec, EvidenceType, StudentRec } from '../../lib/db/types'
import { listReportsByStudent, resetOverride, toggleConfirmMethod, updateReport, type OverridableField } from '../../lib/absenceReports/reconcile'
import { buildAbsenceHwpx } from '../../lib/hwpx/absence/build'
import { periodText } from './AttendanceForm'

const EVIDENCE: EvidenceType[] = ['2일 이내 질병', '3일 이상 질병', '법정전염병', '경조사 참석', '기타']
const CONFIRM_LABELS = ['진료확인서·처방전', '약봉투·영수증', '소견서·진단서', '보호자 통화(문자)', '기타']
const FIELD_LABEL: Record<OverridableField, string> = {
  detail: '상세 사유',
  evidence_type: '증빙',
  confirm_methods: '확인 방법',
  written_date: '학생 작성일',
  confirmed_date: '담임 확인일',
}

function ReportCard({ report, onSaved, open }: { report: AbsenceReportRec; onSaved: () => Promise<void>; open: boolean }) {
  const db = useDb()
  const fs = useFs()
  const [detail, setDetail] = useState(report.detail)
  const [stuName, setStuName] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  useEffect(() => setDetail(report.detail), [report.detail])

  const patch = async (p: Parameters<typeof updateReport>[2]) => {
    await updateReport(db, report.id, p)
    await onSaved()
  }
  const reset = async (f: OverridableField) => {
    await resetOverride(db, report.id, f)
    await onSaved()
  }
  const Reset = ({ field }: { field: OverridableField }) =>
    report.overrides.includes(field) ? (
      <button type="button" className="link" aria-label={`${FIELD_LABEL[field]} 자동으로 되돌리기`} onClick={() => reset(field)}>
        자동으로 되돌리기
      </button>
    ) : null

  async function exportHwpx() {
    try {
      const out = await buildAbsenceHwpx(db, [report], { stuName, mode: 'one' })
      fs.downloadFile(out.fileName, out.bytes)
      setMessages(out.warnings.length ? out.warnings : ['hwpx 파일을 만들었습니다.'])
    } catch (e) {
      setMessages([e instanceof Error ? e.message : String(e)])
    }
  }

  return (
    <details className="report-card" open={open} aria-label={`신고서 ${periodText(report)}`}>
      <summary>
        <strong>{`${periodText(report)} ${report.kind}${report.period ? ` ${report.period}교시` : ''}(${report.category})`}</strong>
        {report.kind === '결석' && <span className="muted">{` 수업일 ${report.school_days}일`}</span>}
        <span className={`tag ${report.submitted ? 'status-나이스' : 'status-미정리'}`}>{report.submitted ? '제출' : '미제출'}</span>
        {report.diagnosis_required && !report.diagnosis_received && <span className="tag warn">진단서 필요</span>}
      </summary>
      <div className="stack report-body">
      {report.stale && <p className="warn">출결이 바뀌었습니다. 내용을 확인하세요.</p>}
      <div className="row">
        <label>
          증빙
          <select value={report.evidence_type} onChange={(e) => patch({ evidence_type: e.target.value as EvidenceType })}>
            {EVIDENCE.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <Reset field="evidence_type" />
      </div>
      <div className="row">
        <label className="wide">
          상세 사유
          <input value={detail} maxLength={60} onChange={(e) => setDetail(e.target.value)} onBlur={() => detail !== report.detail && patch({ detail: detail.trim() })} />
        </label>
        <span className={detail.length > 40 ? 'error' : 'muted'}>{`${detail.length}/40`}</span>
        <Reset field="detail" />
      </div>
      <fieldset className="checks">
        <legend>담임 확인 방법</legend>
        {CONFIRM_LABELS.map((l, i) => (
          <label key={l} className="check">
            <input
              type="checkbox"
              checked={report.confirm_methods.includes(i)}
              onChange={async (e) => {
                await toggleConfirmMethod(db, report.id, i, e.target.checked)
                await onSaved()
              }}
            />
            {l}
          </label>
        ))}
        <Reset field="confirm_methods" />
      </fieldset>
      <div className="row">
        <label>
          학생 작성일
          <input type="date" value={report.written_date} onChange={(e) => e.target.value && patch({ written_date: e.target.value })} />
        </label>
        <Reset field="written_date" />
        <label>
          담임 확인일
          <input type="date" value={report.confirmed_date} onChange={(e) => e.target.value && patch({ confirmed_date: e.target.value })} />
        </label>
        <Reset field="confirmed_date" />
      </div>
      <div className="row">
        {report.diagnosis_required && (
          <label className="check">
            <input type="checkbox" checked={report.diagnosis_received} onChange={(e) => patch({ diagnosis_received: e.target.checked })} />
            진단서 수령
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={report.submitted} onChange={(e) => patch({ submitted: e.target.checked })} />
          제출
        </label>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={stuName} onChange={(e) => setStuName(e.target.checked)} />
          학생 성명 칸에 이름 인쇄
        </label>
        <button type="button" className="primary" onClick={exportHwpx}>
          한글로 받기
        </button>
      </div>
      {messages.length > 0 && (
        <ul className="plain" role="status">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      </div>
    </details>
  )
}

export default function ReportPanel({ student, onChanged }: { student: StudentRec; onChanged: () => void }) {
  const db = useDb()
  const [reports, setReports] = useState<AbsenceReportRec[] | null>(null)
  const load = useCallback(async () => setReports(await listReportsByStudent(db, student.id)), [db, student.id])
  useEffect(() => {
    load()
  }, [load])
  if (!reports || reports.length === 0) return null
  return (
    <section className="card stack report-panel" aria-label="결석신고서">
      <h3>{`결석신고서 ${reports.length}건`}</h3>
      {reports.map((r) => (
        <ReportCard
          key={r.id}
          report={r}
          open={reports.length === 1 || !r.submitted}
          onSaved={async () => {
            await load()
            onChanged()
          }}
        />
      ))}
    </section>
  )
}
