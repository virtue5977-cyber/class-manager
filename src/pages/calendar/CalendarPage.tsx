import MonthPicker, { shiftMonth } from '../../components/MonthPicker'
import PageHead from '../../components/PageHead'
import { useShortcut } from '../../lib/ui/shortcuts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb, useFs } from '../../app/context'
import ExportMenu from '../../components/ExportMenu'
import { isHideNames } from '../../components/HideNames'
import { exportPdf } from '../../lib/export/pdf'
import { calendarXlsx } from '../../lib/export/sheets'
import { buildTableHwpx } from '../../lib/docs/table-doc'
import type { AttendanceRec, CounselingLogRec, GoogleEventRec, LocalEventRec, SchoolCalendarRec, StudentRec } from '../../lib/db/types'
import { addLocalEvent, listLocalEvents } from '../../lib/events/localEvents'
import { softDelete } from '../../lib/db/records'
import { listGoogleEvents } from '../../lib/google/google'
import { listStudents } from '../../lib/roster/roster'
import { listCalendar } from '../../lib/neis/schedule'
import { listAttendanceInRange } from '../../lib/attendance/attendance'
import { listLogsByStudents, logTags } from '../../lib/counseling/counseling'
import { addDays, toYmd, weekday } from '../../lib/schoolDays'
import { ClassSelect, NoClass, useClasses } from '../common/useClasses'

const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const shortKind = (a: AttendanceRec) => `${a.kind}${a.period ? `(${a.period}교시)` : ''}·${a.category === '출석인정' ? '인정' : a.category}`

interface DayData {
  events: SchoolCalendarRec[]
  google: GoogleEventRec[]
  local: LocalEventRec[]
  atts: { a: AttendanceRec; s: StudentRec }[]
  logs: { l: CounselingLogRec; s: StudentRec }[]
}

/** 한 달 달력: 학사일정 + 출결 + 상담 기록(위로그 캘린더를 담임용으로). */
export default function CalendarPage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const fs = useFs()
  const { classes, classId, choose } = useClasses()
  const [month, setMonth] = useState(today.slice(0, 7))
  useShortcut('step', (a) => a.kind === 'step' && month && setMonth(shiftMonth(month, a.dir)))
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
    const day = (d: string) => (map[d] ??= { events: [], google: [], local: [], atts: [], logs: [] })
    for (const e of await listCalendar(db, from, to)) if (e.title && e.title !== '토요휴업일') day(e.date).events.push(e)
    for (const ge of await listGoogleEvents(db, from, to)) for (let d = ge.date; d <= ge.end_date && d <= to; d = addDays(d, 1)) day(d).google.push(ge)
    for (const le of await listLocalEvents(db, from, to)) for (let d = le.date < from ? from : le.date; d <= (le.end_date ?? le.date) && d <= to; d = addDays(d, 1)) day(d).local.push(le)
    if (classId) {
      const studs = await listStudents(db, classId, { includeInactive: true })
      const byId = new Map(studs.map((s) => [s.id, s]))
      const ids = studs.map((s) => s.id)
      for (const a of await listAttendanceInRange(db, ids, from, to)) day(a.date).atts.push({ a, s: byId.get(a.student_id)! })
      const logs = await listLogsByStudents(db, ids)
      for (const list of Object.values(logs)) for (const l of list) if (l.date >= from && l.date <= to) day(l.date).logs.push({ l, s: byId.get(l.student_id)! })
    }
    if (n === seq.current) setData(map)
  }, [db, classId, month])
  useEffect(() => {
    load()
  }, [load])

  if (classes && classes.length === 0) return <NoClass title="달력" />

  const sel = data[picked] ?? { events: [], google: [], local: [], atts: [], logs: [] }

  /** 이 달의 일정·출결·상담을 날짜순 한 줄씩(이름 가림 중이면 번호만). */
  const monthItems = () => {
    const who = (st: StudentRec) => (isHideNames() ? `${st.number}번` : `${st.number}번 ${st.name}`)
    const items: { date: string; kind: string; text: string }[] = []
    for (const [d, dd] of Object.entries(data)) {
      if (!d.startsWith(month)) continue
      for (const e of dd.events) items.push({ date: d, kind: '학사', text: e.title })
      for (const e of dd.google) items.push({ date: d, kind: '구글', text: `${e.time ? e.time + ' ' : ''}${e.title}` })
      for (const { a, s: st } of dd.atts) items.push({ date: d, kind: '출결', text: `${who(st)} ${shortKind(a)}` })
      for (const { s: st } of dd.logs) items.push({ date: d, kind: '상담', text: who(st) })
    }
    return items.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
  }
  const exportCal = async (kind: 'hwpx' | 'xlsx') => {
    const items = monthItems()
    const name = `달력_${month}.${kind}`
    const bytes = kind === 'xlsx' ? await calendarXlsx(items) : await buildTableHwpx({ title: `${Number(month.slice(5))}월 달력`, subtitle: month, header: ['날짜', '구분', '내용'], rows: items.map((i) => [i.date, i.kind, i.text]), colRatios: [2, 1, 6] })
    fs.downloadFile(name, bytes)
  }

  return (
    <section className="stack">
      <PageHead title="달력">
          {classes && <ClassSelect classes={classes} classId={classId} onChange={choose} />}
          <MonthPicker value={month} onChange={setMonth} label="달" current={today.slice(0, 7)} onToday={() => { setMonth(today.slice(0, 7)); setPicked(today) }} />
          <label className="inline">
            <input type="checkbox" checked={weekends} onChange={(e) => setWeekends(e.target.checked)} />
            주말 보기
          </label>
          <ExportMenu items={[{ format: 'hwpx', run: () => exportCal('hwpx') }, { format: 'xlsx', run: () => exportCal('xlsx') }, { format: 'pdf', run: () => exportPdf(`달력_${month}.pdf`) }]} />
      </PageHead>
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
                {dd?.local.map((e) => (
                  <span key={e.id} className={`cal-ev cal-tag-${e.tag}`}>
                    {`${e.time ? e.time + ' ' : ''}${e.title}`}
                  </span>
                ))}
                {dd?.google.map((e) => (
                  <span key={e.id} className="cal-g">
                    {`${e.time ? e.time + ' ' : ''}${e.title}`}
                  </span>
                ))}
                {absent > 0 && <span className="cal-att" title={dd!.atts.map(({ a, s }) => `${s.number}번 ${s.name} ${a.kind}`).join(', ')}>{`출결 ${absent}`}</span>}
                {dd && dd.logs.length > 0 && <span className="cal-log" title={dd.logs.map(({ s }) => `${s.number}번 ${s.name}`).join(', ')}>{`상담 ${dd.logs.length}`}</span>}
              </button>
            )
          })}
        </div>
        <aside className="card stack cal-side" aria-label="고른 날">
          <h3>{`${Number(picked.slice(5, 7))}월 ${Number(picked.slice(8))}일(${DAYS[weekday(picked) - 1]})`}</h3>
          {sel.events.length + sel.google.length + sel.local.length + sel.atts.length + sel.logs.length === 0 && <p className="muted">기록이 없습니다.</p>}
          {sel.local.length > 0 && (
            <ul className="plain">
              {sel.local.map((e) => (
                <li key={e.id} className="row">
                  <span className={`up-tag tag-${e.tag === '개인' ? 'personal' : 'work'}`}>{e.tag}</span>
                  <span>{`${e.time ? e.time + ' ' : ''}${e.title}`}</span>
                  <button type="button" className="icon-btn" aria-label={`${e.title} 지우기`} onClick={async () => { await softDelete(db.local_events, e.id); load() }}>×</button>
                </li>
              ))}
            </ul>
          )}
          <AddEvent date={picked} onAdded={load} />
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
            <Link to={`/attendance?date=${picked}`}>출결 입력</Link>
            <Link to={`/counseling?date=${picked}`}>상담 기록</Link>
          </div>
        </aside>
      </div>
      <p className="muted">학사일정(설정에서 나이스 연결), 출결, 상담 기록이 함께 보입니다. 날짜를 누르면 오른쪽에 자세히 나옵니다.</p>
    </section>
  )
}

function AddEvent({ date, onAdded }: { date: string; onAdded: () => void }) {
  const db = useDb()
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [tag, setTag] = useState<'개인' | '업무'>('업무')
  const [err, setErr] = useState<string>()
  return (
    <form
      className="stack cal-add"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await addLocalEvent(db, { date, time: time || null, title, tag })
          setTitle('')
          setTime('')
          setErr(undefined)
          onAdded()
        } catch (x) {
          setErr(x instanceof Error ? x.message : String(x))
        }
      }}
    >
      <strong>일정 추가</strong>
      <input aria-label="일정 제목" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
      <div className="row">
        <input type="time" aria-label="시각" value={time} onChange={(e) => setTime(e.target.value)} />
        <select aria-label="태그" value={tag} onChange={(e) => setTag(e.target.value as '개인' | '업무')}>
          <option value="업무">업무</option>
          <option value="개인">개인</option>
        </select>
        <button type="submit">일정 추가</button>
      </div>
      {err && <p className="error">{err}</p>}
    </form>
  )
}
