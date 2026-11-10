import { createContext, useContext, useEffect, useState } from 'react'
import { useDb } from '../../app/context'
import type { ClassRec } from '../../lib/db/types'
import { classLabel, getCurrentClassId, listClasses, setCurrentClassId } from '../../lib/roster/roster'

/** 학급 목록·현재 학급이 바뀌면 화면들이 다시 읽도록 알리는 이벤트. */
export const CLASS_EVENT = 'cm:class'
export const notifyClassChange = () => window.dispatchEvent(new Event(CLASS_EVENT))
/** 사이드바에 학급 고르기가 있으면 화면 안의 학급 고르기는 숨긴다. */
export const GlobalClassContext = createContext(false)

/** 화면마다 쓰는 학급 고르기(마지막으로 고른 학급을 기억). classes가 null이면 아직 불러오는 중. */
export function useClasses() {
  const db = useDb()
  const [classes, setClasses] = useState<ClassRec[] | null>(null)
  const [classId, setClassId] = useState<string>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    window.addEventListener(CLASS_EVENT, on)
    return () => window.removeEventListener(CLASS_EVENT, on)
  }, [])
  useEffect(() => {
    let live = true
    ;(async () => {
      const list = await listClasses(db)
      const saved = await getCurrentClassId(db)
      if (!live) return
      setClasses(list)
      setClassId(list.some((c) => c.id === saved) ? saved : list[0]?.id)
    })()
    return () => {
      live = false
    }
  }, [db, tick])
  const choose = async (id: string) => {
    setClassId(id)
    await setCurrentClassId(db, id)
    window.dispatchEvent(new Event(CLASS_EVENT))
  }
  const current = classes?.find((c) => c.id === classId)
  return { classes, classId, current, choose }
}

export function ClassSelect({ classes, classId, onChange }: { classes: ClassRec[]; classId?: string; onChange: (id: string) => void }) {
  if (useContext(GlobalClassContext)) return null
  return (
    <label className="inline">
      학급
      <select value={classId} onChange={(e) => onChange(e.target.value)}>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>{`${c.school_year}학년도 ${classLabel(c)}`}</option>
        ))}
      </select>
    </label>
  )
}

export function NoClass({ title }: { title: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <p className="muted">먼저 학급 메뉴에서 학급과 학생을 추가하세요.</p>
    </section>
  )
}
