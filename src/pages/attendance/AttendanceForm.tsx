import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDb } from '../../app/context'
import type { AbsenceReportRec, AttendanceCategory, AttendanceKind, AttendanceRec, RecognizedEvidence, StudentRec } from '../../lib/db/types'
import { deleteAttendance, saveAttendance, type AttendanceInput } from '../../lib/attendance/attendance'
import { impactOfChange, reconcileStudent } from '../../lib/absenceReports/reconcile'

const KINDS: AttendanceKind[] = ['결석', '지각', '조퇴', '결과']
const CATS: AttendanceCategory[] = ['미인정', '질병', '출석인정']
const EVIDENCE: RecognizedEvidence[] = ['법정전염병', '경조사 참석', '기타']
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
export const periodText = (r: { start_date: string; end_date: string }) => (r.start_date === r.end_date ? md(r.start_date) : `${md(r.start_date)}~${md(r.end_date)}`)

function resultText(r: { created: number; updated: number; removed: number }): string {
  if (r.created) return '신고서를 만들었습니다.'
  if (r.updated) return '신고서를 고쳤습니다.'
  if (r.removed) return '신고서를 지웠습니다.'
  return '저장했습니다.'
}

type Pending = { kind: 'save' | 'delete'; reports: AbsenceReportRec[] }

export default function AttendanceForm({
  student,
  date,
  records,
  onDone,
  onClose,
}: {
  student: StudentRec
  date: string
  records: AttendanceRec[]
  onDone: (message: string) => void
  onClose: () => void
}) {
  const db = useDb()
  const [editingId, setEditingId] = useState<string | undefined>(records[0]?.id)
  const current = records.find((r) => r.id === editingId)
  const [kind, setKind] = useState<AttendanceKind>(current?.kind ?? '결석')
  const [category, setCategory] = useState<AttendanceCategory>(current?.category ?? '질병')
  const [period, setPeriod] = useState(current?.period ?? '')
  const [reason, setReason] = useState(current?.reason ?? '')
  const [evidence, setEvidence] = useState<RecognizedEvidence>(current?.evidence_type ?? '기타')
  const [memo, setMemo] = useState(current?.memo ?? '')
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<Pending | null>(null)

  function pick(r?: AttendanceRec) {
    setEditingId(r?.id)
    setKind(r?.kind ?? '결석')
    setCategory(r?.category ?? '질병')
    setPeriod(r?.period ?? '')
    setReason(r?.reason ?? '')
    setEvidence(r?.evidence_type ?? '기타')
    setMemo(r?.memo ?? '')
    setError(undefined)
    setPending(null)
  }

  // 글자 칸 밖에서 숫자키 1~4로 구분을 고른다(학생 칸에 커서가 있어도 된다).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.ctrlKey || e.altKey || e.metaKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const k = KINDS[Number(e.key) - 1]
      if (k) setKind(k)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const enterSaves = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      run('save')
    }
  }

  const busy = useRef(false)
  const input = (): AttendanceInput => ({
    student_id: student.id,
    date,
    kind,
    category,
    period: kind === '결석' ? null : period.trim() || null,
    reason: reason.trim(),
    evidence_type: category === '출석인정' ? evidence : null,
    memo: memo.trim(),
  })

  async function run(action: 'save' | 'delete', confirmed = false) {
    if (busy.current) return // 두 번 눌러도 한 번만 저장
    busy.current = true
    setError(undefined)
    try {
      if (!confirmed) {
        const reports = await impactOfChange(db, student.id, action === 'save' ? { upsert: { ...input(), id: editingId } } : { removeId: editingId })
        if (reports.length) return setPending({ kind: action, reports })
      }
      if (action === 'save') await saveAttendance(db, input(), editingId)
      else if (editingId) await deleteAttendance(db, editingId)
      const r = await reconcileStudent(db, student.id)
      setPending(null)
      onDone(action === 'delete' && !r.removed && !r.updated ? '지웠습니다.' : resultText(r))
    } catch (e) {
      setPending(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      busy.current = false
    }
  }

  return (
    <div className="card stack" aria-label={`${student.number}번 ${student.name} 출결 입력`}>
      <h3>{`${student.number}번 ${student.name} · ${md(date)}`}</h3>
      {records.length > 0 && (
        <div className="row">
          {records.map((r) => (
            <button key={r.id} type="button" aria-pressed={r.id === editingId} className={r.id === editingId ? 'active' : undefined} onClick={() => pick(r)}>
              {`${r.kind}${r.period ? ` ${r.period}교시` : ''}(${r.category})`}
            </button>
          ))}
          <button type="button" aria-pressed={!editingId} onClick={() => pick(undefined)}>
            + 새 출결
          </button>
        </div>
      )}
      <div className="row seg" role="group" aria-label="구분">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? 'active' : undefined} title={`숫자키 ${KINDS.indexOf(k) + 1}`} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="row seg" role="group" aria-label="종류">
        {CATS.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} className={category === c ? 'active' : undefined} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="row">
        {kind !== '결석' && (
          <label>
            교시
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="3 또는 3~4" />
          </label>
        )}
        {category === '출석인정' && (
          <label>
            증빙 구분
            <select value={evidence} onChange={(e) => setEvidence(e.target.value as RecognizedEvidence)}>
              {EVIDENCE.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="wide">
        사유
        <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={enterSaves} />
      </label>
      <label className="wide">
        메모
        <input value={memo} onChange={(e) => setMemo(e.target.value)} onKeyDown={enterSaves} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pending ? (
        <div className="row confirm">
          <span>{`제출했거나 직접 고친 신고서(${pending.reports.map(periodText).join(', ')})에 영향을 줍니다. 계속할까요?`}</span>
          <button type="button" className="danger" onClick={() => run(pending.kind, true)}>
            계속
          </button>
          <button type="button" onClick={() => setPending(null)}>
            취소
          </button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="primary" title="사유·메모 칸에서 Enter" onClick={() => run('save')}>
            저장
          </button>
          {editingId && (
            <button type="button" onClick={() => run('delete')}>
              삭제
            </button>
          )}
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      )}
    </div>
  )
}
