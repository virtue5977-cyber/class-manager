import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDb } from '../../app/context'
import type { AbsenceReportRec, AttendanceRec, StudentRec } from '../../lib/db/types'
import { listStudents } from '../../lib/roster/roster'
import { ClassSelect, useClasses } from '../common/useClasses'
import { listAttendanceByDate } from '../../lib/attendance/attendance'
import { listReportsByStudent, loadReportContext } from '../../lib/absenceReports/reconcile'
import { addDays, toYmd, type SchoolDays } from '../../lib/schoolDays'
import AttendanceForm from './AttendanceForm'
import ReportPanel from './ReportPanel'

const label = (r: AttendanceRec) => `${r.kind}${r.period ? ` ${r.period}교시` : ''}(${r.category})`

export default function AttendancePage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const { classes, classId, choose } = useClasses()
  const [date, setDate] = useState(today)
  const [students, setStudents] = useState<StudentRec[]>([])
  const [records, setRecords] = useState<AttendanceRec[]>([])
  const [reports, setReports] = useState<Record<string, AbsenceReportRec[]>>({})
  const [days, setDays] = useState<SchoolDays | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>()
  const [loadedFor, setLoadedFor] = useState<string>()
  const listRef = useRef<HTMLUListElement>(null)
  const loadSeq = useRef(0)

  const reload = useCallback(async () => {
    if (!classId) return
    const seq = ++loadSeq.current
    const [studs, ctx] = await Promise.all([listStudents(db, classId, { includeInactive: false }), loadReportContext(db)])
    const recs = await listAttendanceByDate(db, studs.map((s) => s.id), date)
    const reps: Record<string, AbsenceReportRec[]> = {}
    for (const s of studs) reps[s.id] = await listReportsByStudent(db, s.id)
    // 날짜·학급을 빨리 바꾸면 늦게 끝난 이전 조회가 새 화면을 덮어쓰지 않도록 버린다.
    if (seq !== loadSeq.current) return
    setStudents(studs)
    setRecords(recs)
    setReports(reps)
    setDays(ctx.days)
    setLoadedFor(`${classId}|${date}`)
  }, [db, classId, date])
  // 저장이 끝난 뒤에는 그사이 날짜가 바뀌었어도 지금 화면 기준으로 다시 읽는다.
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    reload().catch((e) => setNotice(`불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`))
  }, [reload])

  useEffect(() => setSelected(null), [classId])

  function moveFocus(e: KeyboardEvent) {
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (!step) return
    const buttons = [...(listRef.current?.querySelectorAll('button') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, i + step))]
    next?.focus()
    e.preventDefault()
  }

  const reportsOn = (sid: string) => (reports[sid] ?? []).filter((r) => r.start_date <= date && date <= r.end_date)
  const student = students.find((s) => s.id === selected)
  // 지금 보이는 날짜의 조회가 끝나기 전에는 입력 칸을 열지 않는다(이전 날짜 기록을 고치는 일을 막음).
  const ready = loadedFor === `${classId}|${date}`
  const dayRecords = records.filter((r) => r.date === date)

  if (classes && classes.length === 0) return <section><h2>출결</h2><p className="muted">먼저 학급 메뉴에서 학급과 학생을 추가하세요.</p></section>

  const counts = (['결석', '지각', '조퇴', '결과'] as const).map((k) => [k, new Set(dayRecords.filter((r) => r.kind === k).map((r) => r.student_id)).size] as const)

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <h2>출결</h2>
          <div className="att-summary" aria-label="오늘 출결 요약">
            <span>{`재적 ${students.length}명`}</span>
            {counts.map(([k, n]) => (
              <span key={k}>{`${k} ${n}`}</span>
            ))}
          </div>
        </div>
        <div className="tools">
          {classes && <ClassSelect classes={classes} classId={classId} onChange={choose} />}
          <div className="date-bar">
            <button type="button" aria-label="전날" title="전날" onClick={() => setDate(addDays(date, -1))}>
              ◀ 전날
            </button>
            <input type="date" aria-label="날짜" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" aria-label="다음날 ▶" title="다음날" onClick={() => setDate(addDays(date, 1))}>
              다음날 ▶
            </button>
            {date !== today && (
              <button type="button" className="link" onClick={() => setDate(today)}>
                오늘
              </button>
            )}
          </div>
        </div>
      </div>
      {days && !days.isClassDay(date) && <p className="banner">수업일이 아닙니다(휴업일·주말).</p>}
      {days && !days.hasCalendarFor(date) && <p className="muted">학사일정을 가져오지 않아 공휴일 일부를 모를 수 있습니다.</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="att-layout">
        <ul className="student-grid" ref={listRef} onKeyDown={moveFocus} aria-label="학생 목록">
          {students.map((s) => {
            const mine = dayRecords.filter((r) => r.student_id === s.id)
            const reps = reportsOn(s.id)
            return (
              <li key={s.id}>
                <button type="button" className={`student-cell${selected === s.id ? ' active' : ''}`} aria-pressed={selected === s.id} onClick={() => { setSelected(s.id); setNotice(undefined) }}>
                  <span className="num pii">{`${s.number}번 ${s.name}`}</span>
                  {(mine.length > 0 || reps.length > 0) && (
                    <span className="marks">
                      {mine.map((r) => (
                        <span key={r.id} className={`chip-${r.kind}`}>{label(r)}</span>
                      ))}
                      {reps.length > 0 && <span className="tag badge">{reps.every((r) => r.submitted) ? '제출' : '신고서'}</span>}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="att-side">
          {!student && <div className="card muted">학생을 누르면 여기에서 출결을 입력합니다. 방향키로 옮겨 다닐 수 있습니다.</div>}
          {student && ready && (
            <AttendanceForm
              key={`${student.id}-${date}-${dayRecords.filter((r) => r.student_id === student.id).map((r) => r.id + r.updated_at).join()}`}
              student={student}
              date={date}
              records={dayRecords.filter((r) => r.student_id === student.id)}
              onDone={async (m) => {
                setNotice(m)
                await reloadRef.current()
              }}
              onClose={() => setSelected(null)}
            />
          )}
          {student && (
            <ReportPanel
              key={`${student.id}-${(reports[student.id] ?? []).map((r) => r.id + r.updated_at).join()}`}
              student={student}
              onChanged={() => reloadRef.current()}
            />
          )}
        </div>
      </div>
    </section>
  )
}
