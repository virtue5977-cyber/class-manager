import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../lib/ui/useLive'
import { Link } from 'react-router-dom'
import { useDb, useNeisEvents, useNetFetch } from '../../app/context'
import type { TeacherTimetableRec } from '../../lib/db/types'
import { fetchMeals, getCachedMeals, type Meal } from '../../lib/neis/meal'
import { listMyTimetable } from '../../lib/timetable/estimate'
import { listReportsForMonth } from '../../lib/absenceReports/list'
import { listAttendanceByDate } from '../../lib/attendance/attendance'
import { getCurrentClassId, listStudents } from '../../lib/roster/roster'
import { getNeisKey, getSettings } from '../../lib/settings'
import { weekday } from '../../lib/schoolDays'

/** 제목 아래 한 줄 요약(오늘 출결 · 내 수업 · 미제출 신고서 · 급식). 누르면 급식·시간표가 펼쳐진다. */
export default function TodaySummary({ today }: { today: string }) {
  const db = useDb()
  const { version } = useNeisEvents()
  const [open, setOpen] = useState(false)
  // 자료가 바뀌면(명령·다른 화면) 바로 다시 센다(liveQuery). 읽기만 한다.
  const timetable = useLive<TeacherTimetableRec[]>(async () => (await listMyTimetable(db)).filter((t) => t.weekday === weekday(today)).sort((a, b) => a.period - b.period), [db, today, version], [])
  const { att, reports } = useLive(
    async () => {
      const cid = await getCurrentClassId(db)
      if (!cid) return { att: 0, reports: 0 }
      const studs = await listStudents(db, cid, { includeInactive: false })
      return {
        att: new Set((await listAttendanceByDate(db, studs.map((s) => s.id), today)).filter((a) => !a.deleted).map((a) => a.student_id)).size,
        reports: (await listReportsForMonth(db, cid, today.slice(0, 7))).filter((r) => !r.report.submitted).length,
      }
    },
    [db, today, version],
    { att: 0, reports: 0 },
  )
  return (
    <div className="today-line">
      <button type="button" className="today-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{`출결 ${att}명`}</span>
        <span>{timetable.length ? `내 수업 ${timetable.map((t) => t.period).join('·')}교시` : '내 수업 없음'}</span>
        <span>{`미제출 신고서 ${reports}건`}</span>
        <span className="muted">{open ? '접기 ▴' : '급식·시간표 ▾'}</span>
      </button>
      {open && (
        <div className="today-more">
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
        </div>
      )}
    </div>
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

