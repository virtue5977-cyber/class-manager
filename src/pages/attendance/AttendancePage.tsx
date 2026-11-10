import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import PageHead from '../../components/PageHead'
import { useDb } from '../../app/context'
import type { AbsenceReportRec, AttendanceRec, StudentRec } from '../../lib/db/types'
import { listStudents } from '../../lib/roster/roster'
import { ClassSelect, useClasses } from '../common/useClasses'
import { listAttendanceByDate } from '../../lib/attendance/attendance'
import { listReportsByStudents, loadReportContext } from '../../lib/absenceReports/reconcile'
import { addDays, toYmd, type SchoolDays } from '../../lib/schoolDays'
import { gridNext } from '../../lib/ui/gridNav'
import { hashParam, ymdParam } from '../../lib/ui/hashParam'
import { useShortcut } from '../../lib/ui/shortcuts'
import AttendanceForm from './AttendanceForm'
import MiniCalendar from './MiniCalendar'
import ReportPanel from './ReportPanel'

const label = (r: AttendanceRec) => `${r.kind}${r.period ? ` ${r.period}교시` : ''}(${r.category})`

export default function AttendancePage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const { classes, classId, choose } = useClasses()
  const [date, setDate] = useState(() => ymdParam() ?? today)
  const [students, setStudents] = useState<StudentRec[]>([])
  const [records, setRecords] = useState<AttendanceRec[]>([])
  const [reports, setReports] = useState<Record<string, AbsenceReportRec[]>>({})
  const [days, setDays] = useState<SchoolDays | null>(null)
  // 통계 숫자에서 넘어오면(?sid=) 그 학생을 고른 채로
  const [selected, setSelected] = useState<string | null>(() => hashParam('sid'))
  const [notice, setNotice] = useState<string>()
  const [loadedFor, setLoadedFor] = useState<string>()
  const listRef = useRef<HTMLUListElement>(null)
  const loadSeq = useRef(0)

  const reload = useCallback(async () => {
    if (!classId) return
    const seq = ++loadSeq.current
    const [studs, ctx] = await Promise.all([listStudents(db, classId, { includeInactive: false }), loadReportContext(db)])
    const recs = await listAttendanceByDate(db, studs.map((s) => s.id), date)
    const reps = await listReportsByStudents(db, studs.map((s) => s.id))
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

  const firstClass = useRef(true)
  useEffect(() => {
    if (firstClass.current) {
      if (classId) firstClass.current = false
      return
    }
    setSelected(null)
  }, [classId])

  function moveFocus(e: KeyboardEvent) {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button.student-cell') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const j = gridNext(buttons.map((b) => b.offsetTop), i, e.key)
    if (j === null) return
    buttons[j]?.focus()
    e.preventDefault()
  }

  /** 다음·전 수업일. 2주 안에 수업일이 없으면(방학) 하루만 옮긴다. */
  const stepDay = (dir: 1 | -1) => {
    for (let d = addDays(date, dir), i = 0; i < 14; i++, d = addDays(d, dir)) if (!days || days.isClassDay(d)) return d
    return addDays(date, dir)
  }
  useShortcut('step', (a) => a.kind === 'step' && setDate(stepDay(a.dir)))
  const reportsOn = (sid: string) => (reports[sid] ?? []).filter((r) => r.start_date <= date && date <= r.end_date)
  const student = students.find((s) => s.id === selected)
  // 지금 보이는 날짜의 조회가 끝나기 전에는 입력 칸을 열지 않는다(이전 날짜 기록을 고치는 일을 막음).
  const ready = loadedFor === `${classId}|${date}`
  const dayRecords = records.filter((r) => r.date === date)

  if (classes && classes.length === 0) return <section><h2>출결</h2><p className="muted">먼저 학급 메뉴에서 학급과 학생을 추가하세요.</p></section>

  const counts = (['결석', '지각', '조퇴', '결과'] as const).map((k) => [k, new Set(dayRecords.filter((r) => r.kind === k).map((r) => r.student_id)).size] as const)

  return (
    <section className="stack">
      <PageHead
        title="출결"
        summary={
          <div className="att-summary" aria-label="오늘 출결 요약">
            <span>{`재적 ${students.length}명`}</span>
            {counts.map(([k, n]) => (
              <span key={k} className={n ? `chip-${k}` : 'zero'}>{`${k} ${n}`}</span>
            ))}
          </div>
        }
      >
          {classes && <ClassSelect classes={classes} classId={classId} onChange={choose} />}
          <div className="stepper" role="group" aria-label="날짜 이동">
            <button type="button" className="step-btn" aria-label="전날" title="전 수업일(주말·휴업일 건너뜀)" onClick={() => setDate(stepDay(-1))}>
              ‹
            </button>
            <input type="date" aria-label="날짜" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" className="step-btn" aria-label="다음날" title="다음 수업일(주말·휴업일 건너뜀)" onClick={() => setDate(stepDay(1))}>
              ›
            </button>
            <button type="button" className="ghost" disabled={date === today} onClick={() => setDate(today)}>
              오늘
            </button>
          </div>
      </PageHead>
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
                <button type="button" data-sid={s.id} className={`student-cell${selected === s.id ? ' active' : ''}`} aria-pressed={selected === s.id} onClick={() => { setSelected(s.id); setNotice(undefined) }}>
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
          {!student && (
            <>
              <MiniCalendar date={date} today={today} classId={classId ?? undefined} onPick={setDate} />
              <p className="muted">학생을 누르면 여기에서 출결을 입력합니다. 방향키로 옮겨 다닐 수 있습니다.</p>
            </>
          )}
          {student && ready && (
            <AttendanceForm
              key={`${student.id}-${date}-${dayRecords.filter((r) => r.student_id === student.id).map((r) => r.id + r.updated_at).join()}`}
              student={student}
              date={date}
              records={dayRecords.filter((r) => r.student_id === student.id)}
              onDone={async (m) => {
                const sid = student.id
                setNotice(m)
                setSelected(null)
                await reloadRef.current()
                // 저장 뒤에는 그 학생 칸으로 돌아가 방향키로 바로 다음 학생을 고를 수 있게 한다.
                listRef.current?.querySelector<HTMLButtonElement>(`button[data-sid="${sid}"]`)?.focus()
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
