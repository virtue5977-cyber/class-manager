import { useDb } from '../../app/context'
import type { CounselingLogRec } from '../../lib/db/types'
import { kindOf, listLogsByStudent, nugaHeader } from '../../lib/counseling/counseling'
import { useLive } from '../../lib/ui/useLive'

/** 명단 상세 아래: 그 학생 누가기록 최근 10개 · 모두 보기 · + 기록 */
export default function StudentLogs({ studentId }: { studentId: string }) {
  const db = useDb()
  const logs = useLive<CounselingLogRec[]>(() => listLogsByStudent(db, studentId), [db, studentId], [])
  const recent = [...logs].reverse().slice(0, 10)
  return (
    <section className="card stack student-logs" aria-label="이 학생 누가기록">
      <div className="row between">
        <h3>{`누가기록 ${logs.length}건`}</h3>
        <div className="row">
          {logs.length > 10 && <a href={`#/counseling?sid=${studentId}`}>모두 보기</a>}
          <a href={`#/counseling?sid=${studentId}`} className="link">+ 기록</a>
        </div>
      </div>
      {recent.length === 0 ? (
        <p className="muted">아직 기록이 없습니다.</p>
      ) : (
        <ul className="plain student-log-list">
          {recent.map((l) => (
            <li key={l.id}>
              <a href={`#/counseling?sid=${studentId}`} className="note-link row">
                <span className="muted nowrap">{nugaHeader(l.date, '')}</span>
                <span className={`tag kind-${kindOf(l)}`}>{kindOf(l)}</span>
                <span className="pii ellipsis">{(l.nuga_text || l.content).split('\n')[0].slice(0, 50)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
