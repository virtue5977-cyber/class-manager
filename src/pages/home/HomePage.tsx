import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAi, useDb, useNeisEvents, useNetFetch } from '../../app/context'
import type { BriefingItem, SchoolCalendarRec, TeacherTimetableRec } from '../../lib/db/types'
import { listGoogleEvents } from '../../lib/google/google'
import { listCalendar } from '../../lib/neis/schedule'
import { fetchMeals, getCachedMeals, type Meal } from '../../lib/neis/meal'
import { listMyTimetable } from '../../lib/timetable/estimate'
import { loadReportContext } from '../../lib/absenceReports/reconcile'
import { listReportsForMonth } from '../../lib/absenceReports/list'
import { getBriefing, runBriefing, saveBriefingItems, SLOTS, type Slot } from '../../lib/briefing/briefing'
import { getCurrentClassId, listStudents } from '../../lib/roster/roster'
import { getNeisKey, getSettings } from '../../lib/settings'
import { addDays, toYmd, weekday } from '../../lib/schoolDays'
import GettingStarted from './GettingStarted'

interface HomeEvent {
  id: string
  date: string
  title: string
  time?: string
  google?: boolean
}

const DAY = ['', '월', '화', '수', '목', '금', '토', '일']
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일(${DAY[weekday(d)]})`
const dday = (from: string, to: string) => {
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
  return n === 0 ? '오늘' : `D-${n}`
}

export default function HomePage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const { version } = useNeisEvents()
  const [classDay, setClassDay] = useState<boolean>()
  const [todayEvents, setTodayEvents] = useState<HomeEvent[]>([])
  const [upcoming, setUpcoming] = useState<HomeEvent[]>([])
  const [timetable, setTimetable] = useState<TeacherTimetableRec[]>([])
  const [openReports, setOpenReports] = useState(0)

  useEffect(() => {
    ;(async () => {
      const { days } = await loadReportContext(db)
      setClassDay(days.isClassDay(today))
      const school: HomeEvent[] = (await listCalendar(db, today, addDays(today, 14))).filter((r: SchoolCalendarRec) => r.title && r.title !== '토요휴업일').map((r) => ({ id: r.id, date: r.date, title: r.title }))
      const google: HomeEvent[] = (await listGoogleEvents(db, today, addDays(today, 14))).map((e) => ({ id: e.id, date: e.date, title: e.title, time: e.time, google: true }))
      const cal = [...school, ...google].sort((a, b) => (a.date + (a.time ?? '') < b.date + (b.time ?? '') ? -1 : 1))
      setTodayEvents(cal.filter((r) => r.date === today))
      setUpcoming(cal.filter((r) => r.date > today))
      setTimetable((await listMyTimetable(db)).filter((t) => t.weekday === weekday(today)).sort((a, b) => a.period - b.period))
      const cid = await getCurrentClassId(db)
      if (cid) setOpenReports((await listReportsForMonth(db, cid, today.slice(0, 7))).filter((r) => !r.report.submitted).length)
    })()
  }, [db, today, version])

  return (
    <section className="stack home">
      <h2>{`${md(today)} ${classDay === undefined ? '' : classDay ? '· 수업일' : '· 수업 없는 날'}`}</h2>
      <div className="card today-card" aria-label="오늘 요약">
        <div>
          <span className="k">오늘 일정</span>
          <span className="v">{todayEvents.length ? todayEvents.map((e) => `${e.time ? e.time + ' ' : ''}${e.title}`).join(' · ') : '없음'}</span>
        </div>
        <div>
          <span className="k">내 수업</span>
          <span className="v">{timetable.length ? `${timetable.length}시간 · ${timetable.map((t) => t.period).join(',')}교시` : '없음'}</span>
        </div>
        <div>
          <span className="k">다음 일정</span>
          <span className="v">{upcoming[0] ? `${dday(today, upcoming[0].date)} ${upcoming[0].title}` : '없음'}</span>
        </div>
        <div>
          <span className="k">미제출 결석신고서</span>
          {openReports > 0 ? <Link className="v" to="/attendance/reports">{`${openReports}건`}</Link> : <span className="v">없음</span>}
        </div>
      </div>
      <GettingStarted />
      <div className="home-grid">
        <Briefing today={today} />
        <div className="stack">
          <TodayMeal today={today} />
          <div className="card wide" aria-label="오늘 내 시간표">
            <h3>오늘 내 시간표</h3>
            {timetable.length === 0 ? (
              <p className="muted">
                없음 · <Link to="/settings?tab=timetable">설정에서 내 시간표 만들기</Link>
              </p>
            ) : (
              <ul className="plain">
                {timetable.map((t) => (
                  <li key={t.id}>{`${t.period}교시 ${t.subject}${t.class_label ? ` (${t.class_label})` : ''}`}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="card wide" aria-label="다가오는 일정">
            <h3>다가오는 일정(2주)</h3>
            {upcoming.length === 0 ? (
              <p className="muted">등록된 일정이 없습니다.</p>
            ) : (
              <ul className="plain">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <span className="tag">{dday(today, e.date)}</span> {`${md(e.date)} ${e.time ? e.time + ' ' : ''}${e.title}`}
                    {e.google && <span className="muted"> · 구글</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function TodayMeal({ today }: { today: string }) {
  const db = useDb()
  const fetch = useNetFetch()
  const [meals, setMeals] = useState<Meal[] | null>(null)
  const [error, setError] = useState<string>()
  const load = useCallback(
    async (force = false) => {
      setError(undefined)
      let m = force ? null : await getCachedMeals(db, today)
      if (!m && (await getNeisKey(db)) && (await getSettings(db)).neis_school_code) {
        try {
          m = await fetchMeals(db, today, { fetch })
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
      setMeals(m ?? [])
    },
    [db, today, fetch],
  )
  useEffect(() => {
    load()
  }, [load])
  const todays = (meals ?? []).filter((m) => m.date === today)
  return (
    <div className="card wide" aria-label="오늘 급식">
      <div className="row between">
        <h3>오늘 급식</h3>
        <button type="button" className="link" onClick={() => load(true)}>
          새로고침
        </button>
      </div>
      {error && <p className="warn">{error}</p>}
      {meals && todays.length === 0 && <p className="muted">급식 정보가 없습니다.</p>}
      {todays.map((m) => (
        <div key={m.kind}>
          {todays.length > 1 && <strong>{m.kind}</strong>}
          <ul className="plain">
            {m.dishes.map((d) => (
              <li key={d.name}>
                {d.name}
                {d.allergies.length > 0 && <small className="muted">{` (${d.allergies.join('.')})`}</small>}
              </li>
            ))}
          </ul>
          {m.calories && <small className="muted">{m.calories}</small>}
        </div>
      ))}
    </div>
  )
}

function Briefing({ today }: { today: string }) {
  const db = useDb()
  const ai = useAi()
  const [date, setDate] = useState(today)
  const [slot, setSlot] = useState<Slot>('조례')
  const [items, setItems] = useState<Record<Slot, BriefingItem[]>>({ 조례: [], 종례: [] })
  const [raw, setRaw] = useState('')
  const [newItem, setNewItem] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  const seq = useRef(0)
  const load = useCallback(async () => {
    const n = ++seq.current
    const [a, b] = await Promise.all(SLOTS.map((s) => getBriefing(db, date, s)))
    if (n === seq.current) setItems({ 조례: a?.items ?? [], 종례: b?.items ?? [] })
  }, [db, date])
  useEffect(() => {
    load()
  }, [load])

  const list = [...items[slot]].sort((a, b) => a.order - b.order)
  async function commit(next: BriefingItem[]) {
    setItems((cur) => ({ ...cur, [slot]: next }))
    await saveBriefingItems(db, date, slot, next)
  }
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  async function organize() {
    setMessage(undefined)
    const s = await getSettings(db)
    if (!s.ai_enabled) return setMessage('AI가 꺼져 있습니다. 설정 > AI에서 연결 방식을 고르고 켜세요. 위 칸에 직접 적어도 됩니다.')
    setBusy(true)
    try {
      const cid = await getCurrentClassId(db)
      const names = cid ? (await listStudents(db, cid)).map((x) => x.name) : []
      const n = await runBriefing(db, ai, raw, date, names)
      setRaw('')
      await load()
      setMessage(`조례 ${n.조례}개, 종례 ${n.종례}개를 정리했습니다. 확인하고 고치세요.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <div className="card wide stack" aria-label="전달사항">
      <div className="row between wide">
        <h3>전달사항</h3>
        <label className="inline">
          날짜
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>
      <div className="tabs" role="tablist">
        {SLOTS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={slot === s} className={slot === s ? 'active' : undefined} onClick={() => setSlot(s)}>
            {`${s} ${items[s].filter((x) => !x.done).length}/${items[s].length}`}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="muted">{`${slot}에 말할 내용이 없습니다.`}</p>}
      <ol className="briefing-list wide">
        {list.map((it, i) => (
          <li key={i} className={it.done ? 'done' : undefined}>
            <input type="checkbox" aria-label={`${i + 1}번 전달 완료`} checked={it.done} onChange={(e) => commit(list.map((x, k) => (k === i ? { ...x, done: e.target.checked } : x)))} />
            <input
              aria-label={`${i + 1}번 내용`}
              value={it.text}
              onChange={(e) => setItems((cur) => ({ ...cur, [slot]: list.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) }))}
              onBlur={() => commit(list)}
            />
            <span className="row-tools">
            <button type="button" aria-label={`${i + 1}번 위로`} onClick={() => move(i, -1)}>
              ▲
            </button>
            <button type="button" aria-label={`${i + 1}번 아래로`} onClick={() => move(i, 1)}>
              ▼
            </button>
            <button type="button" aria-label={`${i + 1}번 ${slot === '조례' ? '종례로' : '조례로'} 옮기기`} onClick={async () => {
              const other: Slot = slot === '조례' ? '종례' : '조례'
              const rest = list.filter((_, k) => k !== i)
              await saveBriefingItems(db, date, other, [...items[other], it])
              await commit(rest)
              await load()
            }}>
              ⇄
            </button>
            <button type="button" aria-label={`${i + 1}번 지우기`} onClick={() => commit(list.filter((_, k) => k !== i))}>
              ✕
            </button>
            </span>
          </li>
        ))}
      </ol>
      <form
        className="row wide"
        onSubmit={(e) => {
          e.preventDefault()
          if (!newItem.trim()) return
          commit([...list, { text: newItem.trim(), order: list.length, done: false }])
          setNewItem('')
        }}
      >
        <input aria-label="직접 추가" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={`${slot}에 직접 추가`} />
        <button type="submit">추가</button>
      </form>
      <label className="wide">
        학교 메신저·공문 글 붙여넣기
        <textarea rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="받은 메시지를 그대로 붙여넣고 'AI로 정리'를 누르면 조례·종례로 나눠 줍니다." />
      </label>
      <button type="button" className="primary" disabled={busy || !raw.trim()} onClick={organize}>
        {busy ? '정리 중…' : 'AI로 정리'}
      </button>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
