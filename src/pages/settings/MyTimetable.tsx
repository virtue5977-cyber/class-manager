import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useDb, useNeisEvents } from '../../app/context'
import type { TeacherTimetableRec } from '../../lib/db/types'
import { getSettings, updateSettings } from '../../lib/settings'
import { getCachedTimetable, type ClassPeriod } from '../../lib/neis/timetable'
import { applyEstimate, coveredWeekdays, classLabelOf, estimateSlots, listMyTimetable, saveManualSlot, subjectsForClasses } from '../../lib/timetable/estimate'
import { toYmd } from '../../lib/schoolDays'

const DAYS = ['월', '화', '수', '목', '금']

const labelSort = (a: string, b: string) => {
  const [ag, ac] = a.split('-').map(Number)
  const [bg, bc] = b.split('-').map(Number)
  return ag - bg || ac - bc
}

export default function MyTimetable({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const { version: neisVersion } = useNeisEvents()
  const [missingDays, setMissingDays] = useState<number[]>([])
  const [periods, setPeriods] = useState<ClassPeriod[] | null | undefined>(undefined)
  const [classes, setClasses] = useState<string[]>([])
  const [subjects, setSubjects] = useState<string[]>([])
  const [mine, setMine] = useState<TeacherTimetableRec[]>([])
  const [conflicts, setConflicts] = useState<{ weekday: number; period: number; labels: string[] }[]>([])
  const [editing, setEditing] = useState<{ weekday: number; period: number; class_label: string; subject: string } | null>(null)

  const reloadMine = useCallback(async () => setMine(await listMyTimetable(db)), [db])
  useEffect(() => {
    let alive = true
    ;(async () => {
      // 모두 불러온 뒤 한 번에 반영: 캐시가 먼저 보이고 선택값이 늦게 덮어쓰는 경쟁을 막는다.
      const [cached, s, list] = await Promise.all([getCachedTimetable(db, today), getSettings(db), listMyTimetable(db)])
      if (!alive) return
      setClasses(s.my_class_labels)
      setSubjects(s.my_subjects)
      setMine(list)
      setPeriods(cached)
    })()
    return () => {
      alive = false
    }
  }, [db, today, neisVersion])

  const allLabels = useMemo(() => [...new Set((periods ?? []).map((p) => classLabelOf(p.grade, p.classNo)))].sort(labelSort), [periods])
  const subjectOptions = useMemo(() => subjectsForClasses(periods ?? [], classes), [periods, classes])

  async function toggle(kind: 'class' | 'subject', value: string, on: boolean) {
    if (kind === 'class') {
      const next = on ? [...classes, value] : classes.filter((c) => c !== value)
      setClasses(next)
      await updateSettings(db, { my_class_labels: next })
    } else {
      const next = on ? [...subjects, value] : subjects.filter((c) => c !== value)
      setSubjects(next)
      await updateSettings(db, { my_subjects: next })
    }
  }

  async function estimate() {
    const r = estimateSlots(periods ?? [], subjects, classes)
    const days = coveredWeekdays(periods ?? [])
    setConflicts(r.conflicts)
    setMissingDays([1, 2, 3, 4, 5].filter((d) => !days.includes(d)))
    await applyEstimate(db, r.slots, days)
    await reloadMine()
  }

  async function saveCell(e: FormEvent, noClass = false) {
    e.preventDefault()
    if (!editing) return
    await saveManualSlot(db, noClass ? { ...editing, subject: '', class_label: '' } : editing)
    setEditing(null)
    await reloadMine()
  }

  if (periods === undefined) return null
  const maxPeriod = Math.max(7, ...mine.map((m) => m.period), ...(periods ?? []).map((p) => p.period))

  return (
    <div className="card stack">
      <h3>내 시간표</h3>
      {!periods && mine.length > 0 ? (
        <p className="muted">{`저장된 내 시간표 ${mine.length}시간이 홈에 보입니다. 시간표를 다시 맞추려면 '학교·나이스' 탭에서 이번 주 급식·시간표를 가져오세요.`}</p>
      ) : !periods ? (
        <p className="muted">먼저 '이번 주 급식·시간표 가져오기'를 하세요.</p>
      ) : (
        <>
          <fieldset className="checks" role="group" aria-label="수업 학급">
            <legend>수업 학급</legend>
            {allLabels.map((l) => (
              <label key={l} className="check">
                <input type="checkbox" aria-label={l} checked={classes.includes(l)} onChange={(e) => toggle('class', l, e.target.checked)} />
                {l}
              </label>
            ))}
          </fieldset>
          <fieldset className="checks" role="group" aria-label="담당 과목">
            <legend>담당 과목</legend>
            {subjectOptions.length === 0 && <span className="muted">수업 학급을 먼저 고르세요.</span>}
            {subjectOptions.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" aria-label={s} checked={subjects.includes(s)} onChange={(e) => toggle('subject', s, e.target.checked)} />
                {s}
              </label>
            ))}
          </fieldset>
          <button type="button" className="primary" onClick={estimate} disabled={!classes.length || !subjects.length}>
            시간표 추정
          </button>
          {conflicts.length > 0 && (
            <ul className="warn">
              {conflicts.map((c) => (
                <li key={`${c.weekday}-${c.period}`}>{`같은 시간에 여러 학급: ${DAYS[c.weekday - 1]} ${c.period}교시 (${c.labels.join(', ')})`}</li>
              ))}
            </ul>
          )}
          {missingDays.length > 0 && (
            <p className="warn">{`이번 주 ${missingDays.map((d) => DAYS[d - 1]).join('·')}요일 시간표가 없어(휴업일 등) 그 요일의 기존 칸은 그대로 두었습니다.`}</p>
          )}
          <p className="muted">시간표에 교사 이름이 없어 과목명으로 추정합니다. 칸을 눌러 고치면 다시 추정해도 유지됩니다.</p>
        </>
      )}

      <table className="grid timetable" aria-label="내 시간표">
        <thead>
          <tr>
            <th>교시</th>
            {DAYS.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxPeriod }, (_, i) => i + 1).map((period) => (
            <tr key={period}>
              <th>{period}</th>
              {DAYS.map((d, di) => {
                const here = mine.filter((m) => m.weekday === di + 1 && m.period === period)
                const manual = here.some((m) => m.source === 'manual')
                const text = here.map((m) => (m.subject ? `${m.class_label} ${m.subject}`.trim() : '수업 없음')).join(' / ')
                return (
                  <td key={d}>
                    <button
                      type="button"
                      className={`cell${manual ? ' manual' : ''}`}
                      aria-label={`${d} ${period}교시`}
                      onClick={() => setEditing({ weekday: di + 1, period, class_label: here[0]?.class_label ?? '', subject: here[0]?.subject ?? '' })}
                    >
                      {text}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <form className="card row" onSubmit={(e) => saveCell(e)} aria-label="칸 편집">
          <strong>{`${DAYS[editing.weekday - 1]} ${editing.period}교시`}</strong>
          <label>
            학급
            <input value={editing.class_label} onChange={(e) => setEditing({ ...editing, class_label: e.target.value })} />
          </label>
          <label>
            과목
            <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
          </label>
          <button type="submit">칸 저장</button>
          <button type="button" onClick={(e) => saveCell(e as unknown as FormEvent, true)}>
            수업 없음
          </button>
          <button type="button" onClick={() => setEditing(null)}>
            취소
          </button>
        </form>
      )}
    </div>
  )
}
