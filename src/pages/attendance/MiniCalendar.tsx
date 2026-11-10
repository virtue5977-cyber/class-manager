import { useEffect, useState } from 'react'
import { useDb } from '../../app/context'
import MonthPicker from '../../components/MonthPicker'
import { emptyDay, loadMonthData, monthCells, type DayData } from '../../lib/calendar/monthData'
import { useLive } from '../../lib/ui/useLive'

const WD = ['월', '화', '수', '목', '금']

/** 출결 화면 오른쪽(학생을 고르지 않았을 때): 이달 달력. 날짜를 누르면 출결 날짜가 그날로. */
export default function MiniCalendar({ date, today, classId, onPick }: { date: string; today: string; classId?: string; onPick: (d: string) => void }) {
  const db = useDb()
  const [month, setMonth] = useState(date.slice(0, 7))
  useEffect(() => setMonth(date.slice(0, 7)), [date])
  const cells = monthCells(month, false)
  const all = monthCells(month, true)
  const data = useLive<Record<string, DayData>>(() => loadMonthData(db, classId, all[0], all[all.length - 1]), [db, classId, month], {})
  // 아래 목록은 보는 달과 상관없이 고른 날(date)
  const day = useLive<Record<string, DayData>>(() => loadMonthData(db, classId, date, date), [db, classId, date], {})
  const sel = day[date] ?? emptyDay()
  const items = [
    ...sel.events.map((e) => ({ k: 's' + e.id, time: '', title: e.title, cls: 'tag-school' })),
    ...sel.google.map((e) => ({ k: 'g' + e.id, time: e.time, title: e.title, cls: 'tag-google' })),
    ...sel.local.map((e) => ({ k: 'l' + e.id, time: e.time ?? '', title: e.title, cls: e.tag === '개인' ? 'tag-personal' : 'tag-work' })),
  ].sort((a, b) => a.time.localeCompare(b.time))
  return (
    <section className="card mini-cal stack" aria-label="이달 달력">
      <MonthPicker value={month} onChange={setMonth} current={today.slice(0, 7)} onToday={() => onPick(today)} />
      <div className="mini-grid" role="grid">
        {WD.map((w) => <span key={w} className="mini-wd" aria-hidden="true">{w}</span>)}
        {cells.map((d) => {
          const dd = data[d] ?? emptyDay()
          const marks = [...dd.events.map(() => 'tag-school'), ...dd.google.map(() => 'tag-google'), ...dd.local.map((e) => (e.tag === '개인' ? 'tag-personal' : 'tag-work'))].slice(0, 3)
          const att = new Set(dd.atts.filter((x) => !x.a.deleted).map((x) => x.a.student_id)).size
          const label = `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일${att ? ` 출결 ${att}명` : ''}${marks.length ? ` 일정 ${dd.events.length + dd.google.length + dd.local.length}개` : ''}`
          return (
            <button
              key={d}
              type="button"
              aria-label={label}
              aria-current={d === date ? 'date' : undefined}
              className={`mini-day${d.startsWith(month) ? '' : ' out'}${d === today ? ' today' : ''}${d === date ? ' on' : ''}`}
              onClick={() => onPick(d)}
            >
              <span className="mini-num">{Number(d.slice(8, 10))}</span>
              <span className="mini-dots" aria-hidden="true">{marks.map((m, i) => <i key={i} className={`dot ${m}`} />)}</span>
              {att > 0 && <span className="mini-att" aria-hidden="true">{`출결 ${att}`}</span>}
            </button>
          )
        })}
      </div>
      <div className="stack">
        <h4>{`${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 일정`}</h4>
        {items.length === 0 ? (
          <p className="muted">일정이 없습니다.</p>
        ) : (
          <ul className="plain mini-events">
            {items.map((x) => (
              <li key={x.k}>
                <i className={`dot ${x.cls}`} aria-hidden="true" />
                {x.time && <span className="muted">{x.time}</span>}
                <span>{x.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
