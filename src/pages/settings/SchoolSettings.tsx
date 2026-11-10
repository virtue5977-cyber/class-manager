import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useDb, useNeisEvents, useNetFetch } from '../../app/context'
import type { SchoolCalendarRec, SchoolKind } from '../../lib/db/types'
import { getNeisKey, getSettings, setNeisKey, updateSettings } from '../../lib/settings'
import { searchSchools, type SchoolHit } from '../../lib/neis/school'
import { importSchoolSchedule, listCalendar } from '../../lib/neis/schedule'
import { fetchMeals } from '../../lib/neis/meal'
import { fetchWeekTimetable } from '../../lib/neis/timetable'
import { currentSchoolYear } from '../../lib/roster/schoolYear'
import { addDays, toYmd } from '../../lib/schoolDays'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

/** today는 테스트용(기본: 오늘) */
export default function SchoolSettings({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const fetch = useNetFetch()
  const { notifyChanged: notifyNeis } = useNeisEvents()
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SchoolHit[] | null>(null)
  const [upcoming, setUpcoming] = useState<SchoolCalendarRec[]>([])
  const [notice, setNotice] = useState<string>()
  const [busy, setBusy] = useState(false)
  const schoolYear = currentSchoolYear(new Date(today + 'T12:00:00'))

  const refresh = useCallback(async () => {
    setHasKey(!!(await getNeisKey(db)))
    setSchoolName((await getSettings(db)).school_name)
    setUpcoming((await listCalendar(db, today, addDays(today, 60))).slice(0, 5))
  }, [db, today])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function run(task: () => Promise<string | void>) {
    setBusy(true)
    setNotice(undefined)
    try {
      const m = await task()
      await refresh() // 미리보기를 먼저 갱신한 뒤 안내 문구를 띄운다
      if (m) setNotice(m)
    } catch (e) {
      setNotice(msg(e))
    } finally {
      setBusy(false)
    }
  }

  function saveKey(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await setNeisKey(db, keyInput)
      setKeyInput('')
      return keyInput.trim() ? '인증키를 저장했습니다.' : '인증키를 지웠습니다.'
    })
  }

  function search(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      const found = await searchSchools(query, { key: await getNeisKey(db), fetch })
      setHits(found)
      if (!found.length) return '검색 결과가 없습니다.'
    })
  }

  const choose = (h: SchoolHit) =>
    run(async () => {
      await updateSettings(db, { school_name: h.name, neis_office_code: h.officeCode, neis_school_code: h.schoolCode, school_kind: (['초등학교', '중학교', '고등학교'].includes(h.kind) ? h.kind : '') as SchoolKind })
      setHits(null)
    })

  const importSchedule = () =>
    run(async () => {
      const { count, kept } = await importSchoolSchedule(db, schoolYear, { fetch })
      notifyNeis()
      return kept ? 'NEIS에 학사일정이 없어 기존 일정을 그대로 두었습니다.' : `학사일정 ${count}건을 가져왔습니다.`
    })

  const importWeek = () =>
    run(async () => {
      const meals = await fetchMeals(db, today, { fetch })
      const periods = await fetchWeekTimetable(db, today, { fetch })
      notifyNeis()
      return `급식 ${meals.length}끼, 시간표 ${periods.length}칸을 가져왔습니다.`
    })

  return (
    <div className="card stack">
      <h3>학교·NEIS</h3>
      <form className="stack" onSubmit={saveKey}>
        <label>
          NEIS 인증키
          <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} autoComplete="off" />
        </label>
        {hasKey ? (
          <p>인증키가 저장되어 있습니다.</p>
        ) : (
          <p className="muted">
            인증키 받는 법: <a href="https://open.neis.go.kr/" target="_blank" rel="noreferrer">나이스 교육정보 개방 포털</a>에 회원가입 → 마이페이지 '인증키 신청'(무료, 활용 용도는 '교육') → 발급된 키를 여기에 붙여넣기.
          </p>
        )}
        <p className="muted">인증키는 이 노트북에만 저장되고 백업에 들어가지 않습니다.</p>
        <button type="submit" disabled={busy}>
          인증키 저장
        </button>
      </form>

      <form className="stack" onSubmit={search}>
        <h4>학교</h4>
        {schoolName && <p>선택한 학교: {schoolName}</p>}
        <div className="row">
          <label className="inline">
            학교 이름
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !query.trim()}>
            검색
          </button>
        </div>
        {hits && hits.length > 0 && (
          <table className="grid">
            <tbody>
              {hits.map((h) => (
                <tr key={h.officeCode + h.schoolCode}>
                  <td>{h.name}</td>
                  <td>{h.officeName}</td>
                  <td>{h.kind}</td>
                  <td>{h.address}</td>
                  <td>
                    <button type="button" aria-label={`${h.name} 선택`} onClick={() => choose(h)}>
                      선택
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>

      <div className="stack">
        <h4>가져오기</h4>
        <div className="row">
          <button type="button" onClick={importSchedule} disabled={busy}>
            {`학사일정 가져오기(${schoolYear}학년도)`}
          </button>
          <button type="button" onClick={importWeek} disabled={busy}>
            이번 주 급식·시간표 가져오기
          </button>
        </div>
        {upcoming.length > 0 && (
          <ul className="plain" aria-label="다가오는 학사일정">
            {upcoming.map((c) => (
              <li key={c.id}>{`${md(c.date)} ${c.title}${c.is_class_day ? '' : ' (휴업)'}`}</li>
            ))}
          </ul>
        )}
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}
