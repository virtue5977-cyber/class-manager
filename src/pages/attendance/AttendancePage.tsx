import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDb } from '../../app/context'
import type { AbsenceReportRec, AttendanceRec, ClassRec, StudentRec } from '../../lib/db/types'
import { classLabel, getCurrentClassId, listClasses, listStudents, setCurrentClassId } from '../../lib/roster/roster'
import { listAttendanceByDate } from '../../lib/attendance/attendance'
import { listReportsByStudent, loadReportContext } from '../../lib/absenceReports/reconcile'
import { addDays, toYmd, type SchoolDays } from '../../lib/schoolDays'
import AttendanceForm from './AttendanceForm'
import ReportPanel from './ReportPanel'

const label = (r: AttendanceRec) => `${r.kind}${r.period ? ` ${r.period}교시` : ''}(${r.category})`

export default function AttendancePage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const [classes, setClasses] = useState<ClassRec[] | null>(null)
  const [classId, setClassId] = useState<string>()
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

  useEffect(() => {
    ;(async () => {
      const list = await listClasses(db)
      const saved = await getCurrentClassId(db)
      setClasses(list)
      setClassId(list.some((c) => c.id === saved) ? saved : list[0]?.id)
    })()
  }, [db])

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

  async function chooseClass(id: string) {
    setClassId(id)
    setSelected(null)
    await setCurrentClassId(db, id)
  }

  function moveFocus(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = [...(listRef.current?.querySelectorAll('button') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    next?.focus()
    e.preventDefault()
  }

  const reportsOn = (sid: string) => (reports[sid] ?? []).filter((r) => r.start_date <= date && date <= r.end_date)
  const student = students.find((s) => s.id === selected)
  // 지금 보이는 날짜의 조회가 끝나기 전에는 입력 칸을 열지 않는다(이전 날짜 기록을 고치는 일을 막음).
  const ready = loadedFor === `${classId}|${date}`
  const dayRecords = records.filter((r) => r.date === date)

  if (classes && classes.length === 0) return <section><h2>출결</h2><p className="muted">먼저 학급 메뉴에서 학급과 학생을 추가하세요.</p></section>

  return (
    <section className="stack">
      <h2>출결</h2>
      <div className="row">
        {classes && (
          <label className="inline">
            학급
            <select value={classId} onChange={(e) => chooseClass(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{`${c.school_year}학년도 ${classLabel(c)}`}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => setDate(addDays(date, -1))}>
          ◀ 전날
        </button>
        <label className="inline">
          날짜
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button type="button" onClick={() => setDate(addDays(date, 1))}>
          다음날 ▶
        </button>
      </div>
      {days && !days.isClassDay(date) && <p className="warn">수업일이 아닙니다(휴업일·주말).</p>}
      {days && !days.hasCalendarFor(date) && <p className="muted">학사일정을 가져오지 않아 공휴일 일부를 모를 수 있습니다.</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="attendance-layout">
        <ul className="plain student-list" ref={listRef} onKeyDown={moveFocus} aria-label="학생 목록">
          {students.map((s) => {
            const mine = dayRecords.filter((r) => r.student_id === s.id)
            const reps = reportsOn(s.id)
            return (
              <li key={s.id}>
                <button type="button" className={`student-row${selected === s.id ? ' active' : ''}`} onClick={() => { setSelected(s.id); setNotice(undefined) }}>
                  <span className="num pii">{`${s.number}번 ${s.name}`}</span>
                  <span className="att">{mine.map(label).join(' · ')}</span>
                  {reps.length > 0 && <span className="tag badge">{reps.every((r) => r.submitted) ? '제출' : '신고서'}</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="stack">
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
