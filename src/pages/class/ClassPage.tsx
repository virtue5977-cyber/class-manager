import { useCallback, useContext, useEffect, useState, type FormEvent } from 'react'
import PageHead from '../../components/PageHead'
import { useDb } from '../../app/context'
import type { ClassRec } from '../../lib/db/types'
import { CLASS_EVENT, GlobalClassContext, notifyClassChange } from '../common/useClasses'
import { classLabel, createClass, getCurrentClassId, listClasses, setCurrentClassId } from '../../lib/roster/roster'
import { currentSchoolYear } from '../../lib/roster/schoolYear'
import RosterTab from './RosterTab'
import ReflectionTab from './ReflectionTab'
import RosterDocTab from './RosterDocTab'
import SeatingTab from './SeatingTab'
import CleaningTab from './CleaningTab'

export type ClassSub = 'roster' | 'sheet' | 'seating' | 'cleaning' | 'reflection'
export const CLASS_SUBS: { sub: ClassSub; label: string }[] = [
  { sub: 'roster', label: '명단' },
  { sub: 'sheet', label: '명렬표' },
  { sub: 'seating', label: '자리배치' },
  { sub: 'cleaning', label: '청소배치' },
  { sub: 'reflection', label: '반성문' },
]

/** 학급 화면. 어떤 하위 화면을 보일지는 주소(/class/:sub)가 정한다. */
export default function ClassPage({ sub = 'roster' }: { sub?: ClassSub }) {
  const db = useDb()
  const [classes, setClasses] = useState<ClassRec[] | null>(null)
  const [currentId, setCurrentId] = useState<string>()
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
      <PageHead title={CLASS_SUBS.find((x) => x.sub === sub)?.label ?? '학급'}>
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
      </PageHead>

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
          {sub === 'roster' && <RosterTab classId={current.id} classLabel={classLabel(current)} />}
          {sub === 'sheet' && <RosterDocTab classRec={current} />}
          {sub === 'seating' && <SeatingTab key={current.id} classRec={current} />}
          {sub === 'cleaning' && <CleaningTab key={current.id} classRec={current} />}
          {sub === 'reflection' && <ReflectionTab key={current.id} classRec={current} />}
        </>
      )}
    </section>
  )
}
