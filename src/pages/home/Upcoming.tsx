import { useEffect, useState } from 'react'
import { useDb, useNeisEvents } from '../../app/context'
import { listCalendar } from '../../lib/neis/schedule'
import { listGoogleEvents } from '../../lib/google/google'
import { listLocalEvents } from '../../lib/events/localEvents'
import { addDays } from '../../lib/schoolDays'
import { shortDate } from '../../lib/command/dates'
import { useLive } from '../../lib/ui/useLive'

type Tag = '학사' | '구글' | '개인' | '업무'
interface Item {
  id: string
  date: string
  time?: string | null
  title: string
  tag: Tag
}
const TAG_CLASS: Record<Tag, string> = { 학사: 'tag-school', 구글: 'tag-google', 개인: 'tag-personal', 업무: 'tag-work' }

/** 다가오는 일정: 오늘부터 2주, 날짜별로 묶고 학사·구글·개인·업무 태그 색. */
export default function Upcoming({ today }: { today: string }) {
  const db = useDb()
  const { version } = useNeisEvents()
  const to = addDays(today, 14)
  const local = useLive(() => listLocalEvents(db, today, to), [db, today], [])
  const [other, setOther] = useState<Item[]>([])
  useEffect(() => {
    ;(async () => {
      const school = (await listCalendar(db, today, to)).filter((r) => r.title && r.title !== '토요휴업일').map((r) => ({ id: r.id, date: r.date, title: r.title, tag: '학사' as Tag }))
      const google = (await listGoogleEvents(db, today, to)).map((e) => ({ id: e.id, date: e.date, time: e.time, title: e.title, tag: '구글' as Tag }))
      setOther([...school, ...google])
    })()
  }, [db, today, to, version])
  const items = [...other, ...local.map((e) => ({ id: e.id, date: e.date < today ? today : e.date, time: e.time, title: e.title, tag: e.tag as Tag }))].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
  const days = [...new Set(items.map((i) => i.date))]
  return (
    <section className="panel-card" aria-label="다가오는 일정">
      <h3>다가오는 일정</h3>
      {items.length === 0 && <p className="muted">2주 안에 일정이 없습니다. /일정 달력 으로 넣어 보세요.</p>}
      {days.map((d) => (
        <div key={d} className="up-day">
          <div className="up-date">{d === today ? '오늘' : shortDate(d)}</div>
          <ul className="plain">
            {items.filter((i) => i.date === d).map((i) => (
              <li key={i.id}>
                <span className={`up-tag ${TAG_CLASS[i.tag]}`}>{i.tag}</span>
                {i.time && <span className="muted">{i.time} </span>}
                <span>{i.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
