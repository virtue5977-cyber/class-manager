import MonthPicker from '../../components/MonthPicker'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../../app/context'
import type { AttendanceRec, CounselingLogRec, GoogleEventRec, SchoolCalendarRec, StudentRec } from '../../lib/db/types'
import { listGoogleEvents } from '../../lib/google/google'
import { listStudents } from '../../lib/roster/roster'
import { listCalendar } from '../../lib/neis/schedule'
import { listAttendanceByStudent } from '../../lib/attendance/attendance'
import { listLogsByStudent, logTags } from '../../lib/counseling/counseling'
import { addDays, toYmd, weekday } from '../../lib/schoolDays'
import { ClassSelect, NoClass, useClasses } from '../common/useClasses'

const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const shortKind = (a: AttendanceRec) => `${a.kind}${a.period ? `(${a.period}교시)` : ''}·${a.category === '출석인정' ? '인정' : a.category}`

interface DayData {
  events: SchoolCalendarRec[]
  google: GoogleEventRec[]
  atts: { a: AttendanceRec; s: StudentRec }[]
  logs: { l: CounselingLogRec; s: StudentRec }[]
}

/** 한 달 달력: 학사일정 + 출결 + 상담 기록(위로그 캘린더를 담임용으로). */
export default function CalendarPage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const { classes, classId, choose } = useClasses()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [picked, setPicked] = useState(today)
  const [weekends, setWeekends] = useState(false)
  const [data, setData] = useState<Record<string, DayData>>({})
  const seq = useRef(0)

  const first = `${month}-01`
  const gridStart = addDays(first, -(weekday(first) - 1)) // 월요일부터
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  let lastRow = 0
  cells.forEach((d, i) => d.startsWith(month) && (lastRow = i))
  const shownCells = cells.slice(0, Math.ceil((lastRow + 1) / 7) * 7).filter((d) => weekends || weekday(d) <= 5)

  const load = useCallback(async () => {
    const n = ++seq.current
    const from = cells[0]
    const to = cells[41]
    const map: Record<string, DayData> = {}
    const day = (d: string) => (map[d] ??= { events: [], google: [], atts: [], logs: [] })
    for (const e of await listCalendar(db, from, to)) if (e.title && e.title !== '토요휴업일') day(e.date).events.push(e)
    for (const ge of await listGoogleEvents(db, from, to)) for (let d = ge.date; d <= ge.end_date && d <= to; d = addDays(d, 1)) day(d).google.push(ge)
    if (classId) {
      for (const s of await listStudents(db, classId, { includeInactive: true })) {
        for (const a of await listAttendanceByStudent(db, s.id)) if (a.date >= from && a.date <= to) day(a.date).atts.push({ a, s })
        for (const l of await listLogsByStudent(db, s.id)) if (l.date >= from && l.date <= to) day(l.date).logs.push({ l, s })
      }
    }
    if (n === seq.current) setData(map)
  }, [db, classId, month])
  useEffect(() => {
    load()
  }, [load])

  if (classes && classes.length === 0) return <NoClass title="달력" />

  const sel = data[picked] ?? { events: [], google: [], atts: [], logs: [] }

  return (
    <section className="stack">
      <div className="page-head">
        <h2>달력</h2>
        <div className="tools">
          {classes && <ClassSelect classes={classes} classId={classId} onChange={choose} />}
          <button type="button" onClick={() => { setMonth(today.slice(0, 7)); setPicked(today) }}>
            오늘
          </button>
          <MonthPicker value={month} onChange={setMonth} label="달" />
          <label className="inline">
            <input type="checkbox" checked={weekends} onChange={(e) => setWeekends(e.target.checked)} />
            주말 보기
          </label>
          <button type="button" className="link" onClick={() => window.print()}>
            인쇄
          </button>
        </div>
      </div>
      <div className="cal-layout">
        <div className="cal print-area" style={{ gridTemplateColumns: `repeat(${weekends ? 7 : 5}, minmax(0, 1fr))` }} role="grid" aria-label={`${month} 달력`}>
          {DAYS.slice(0, weekends ? 7 : 5).map((d) => (
            <div key={d} className="cal-head" role="columnheader">
              {d}
            </div>
          ))}
          {shownCells.map((d) => {
            const dd = data[d]
            const out = !d.startsWith(month)
            const absent = dd?.atts.length ?? 0
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-label={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`}
                aria-selected={picked === d}
                className={`cal-day${out ? ' out' : ''}${d === today ? ' today' : ''}${picked === d ? ' picked' : ''}`}
                onClick={() => setPicked(d)}
              >
                <span className="cal-date">{Number(d.slice(8))}</span>
                {dd?.events.map((e) => (
                  <span key={e.id} className={`cal-ev${e.is_class_day ? '' : ' off'}`}>
                    {e.title}
                  </span>
                ))}
                {dd?.google.map((e) => (
                  <span key={e.id} className="cal-g">
                    {`${e.time ? e.time + ' ' : ''}${e.title}`}
                  </span>
                ))}
                {absent > 0 && <span className="cal-att">{`출결 ${absent}`}</span>}
                {dd && dd.logs.length > 0 && <span className="cal-log">{`상담 ${dd.logs.length}`}</span>}
              </button>
            )
          })}
        </div>
        <aside className="card stack cal-side" aria-label="고른 날">
          <h3>{`${Number(picked.slice(5, 7))}월 ${Number(picked.slice(8))}일(${DAYS[weekday(picked) - 1]})`}</h3>
          {sel.events.length + sel.google.length + sel.atts.length + sel.logs.length === 0 && <p className="muted">기록이 없습니다.</p>}
          {sel.events.length > 0 && (
            <ul className="plain">
              {sel.events.map((e) => (
                <li key={e.id}><span className="dot dot-school" aria-hidden="true" />{e.title}</li>
              ))}
            </ul>
          )}
          {sel.google.length > 0 && (
            <ul className="plain">
              {sel.google.map((e) => (
                <li key={e.id}><span className="dot dot-google" aria-hidden="true" />{`${e.time ? e.time + ' ' : ''}${e.title}`}<span className="muted"> · 구글</span></li>
              ))}
            </ul>
          )}
          {sel.atts.length > 0 && (
            <>
              <strong>출결</strong>
              <ul className="plain">
                {sel.atts.map(({ a, s }) => (
                  <li key={a.id}>
                    <span className="pii">{`${s.number}번 ${s.name}`}</span>
                    {` ${shortKind(a)}${a.reason ? ` - ${a.reason}` : ''}`}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sel.logs.length > 0 && (
            <>
              <strong>상담</strong>
              <ul className="plain">
                {sel.logs.map(({ l, s }) => (
                  <li key={l.id}>
                    <span className="pii">{`${s.number}번 ${s.name}`}</span>
                    {` ${[logTags(l), l.place].filter(Boolean).join(' · ')}`}
                    <div className="muted pii">{(l.nuga_text || l.content).slice(0, 60)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row">
            <Link to="/attendance">출결 입력</Link>
            <Link to="/counseling">상담 기록</Link>
          </div>
        </aside>
      </div>
      <p className="muted">학사일정(설정에서 나이스 연결), 출결, 상담 기록이 함께 보입니다. 날짜를 누르면 오른쪽에 자세히 나옵니다.</p>
    </section>
  )
}
