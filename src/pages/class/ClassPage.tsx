import { useCallback, useContext, useEffect, useState, type FormEvent } from 'react'
import { useDb } from '../../app/context'
import type { ClassRec } from '../../lib/db/types'
import { CLASS_EVENT, GlobalClassContext, notifyClassChange } from '../common/useClasses'
import { classLabel, createClass, getCurrentClassId, listClasses, setCurrentClassId } from '../../lib/roster/roster'
import { currentSchoolYear } from '../../lib/roster/schoolYear'
import RosterTab from './RosterTab'
import RosterDocTab from './RosterDocTab'
import SeatingTab from './SeatingTab'
import CleaningTab from './CleaningTab'

type Tab = 'roster' | 'doc' | 'seating' | 'cleaning'
const TABS: [Tab, string][] = [
  ['roster', '명단'],
  ['doc', '명렬표'],
  ['seating', '자리배치'],
  ['cleaning', '청소배치'],
]

export default function ClassPage() {
  const db = useDb()
  const [classes, setClasses] = useState<ClassRec[] | null>(null)
  const [currentId, setCurrentId] = useState<string>()
  const [tab, setTab] = useState<Tab>('roster')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ school_year: String(currentSchoolYear()), grade: '1', class_no: '1' })
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const list = await listClasses(db)
    const saved = await getCurrentClassId(db)
    setClasses(list)
    setCurrentId(list.some((c) => c.id === saved) ? saved : list[0]?.id)
  }, [db])
  useEffect(() => {
    load()
    window.addEventListener(CLASS_EVENT, load)
    return () => window.removeEventListener(CLASS_EVENT, load)
  }, [load])
  const globalClass = useContext(GlobalClassContext)

  async function choose(id: string) {
    setCurrentId(id)
    await setCurrentClassId(db, id)
    notifyClassChange()
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    const nums = [form.school_year, form.grade, form.class_no].map((v) => Number(v))
    if (nums.some((n) => !Number.isInteger(n) || n < 1)) return setError('학년도·학년·반은 1 이상의 정수여야 합니다.')
    try {
      const c = await createClass(db, { school_year: nums[0], grade: nums[1], class_no: nums[2] })
      await setCurrentClassId(db, c.id)
      notifyClassChange()
      setAdding(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const current = classes?.find((c) => c.id === currentId)

  return (
    <section className="stack">
      <div className="page-head">
      <h2>학급</h2>
      <div className="tools">
        {classes && classes.length > 0 && !globalClass && (
          <label className="inline">
            학급 선택
            <select value={currentId} onChange={(e) => choose(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{`${c.school_year}학년도 ${classLabel(c)}`}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="link" onClick={() => setAdding((v) => !v)}>
          학급 추가
        </button>
      </div>
      </div>

      {adding && (
        <form className="card row" onSubmit={add} aria-label="학급 추가">
          <label>
            학년도
            <input inputMode="numeric" value={form.school_year} onChange={(e) => setForm({ ...form, school_year: e.target.value })} />
          </label>
          <label>
            학년
            <input inputMode="numeric" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
          </label>
          <label>
            반
            <input inputMode="numeric" value={form.class_no} onChange={(e) => setForm({ ...form, class_no: e.target.value })} />
          </label>
          <button type="submit">추가</button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}

      {classes && classes.length === 0 && !adding && <p className="muted">먼저 학급을 추가하세요.</p>}

      {current && (
        <>
          <div className="tabs" role="tablist">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : undefined} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          {tab === "roster" && <RosterTab classId={current.id} classLabel={classLabel(current)} />}
          {tab === 'doc' && <RosterDocTab classRec={current} />}
          {tab === 'seating' && <SeatingTab key={current.id} classRec={current} />}
          {tab === 'cleaning' && <CleaningTab key={current.id} classRec={current} />}
        </>
      )}
    </section>
  )
}
