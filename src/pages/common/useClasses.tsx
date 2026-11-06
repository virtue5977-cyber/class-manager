import { useEffect, useState } from 'react'
import { useDb } from '../../app/context'
import type { ClassRec } from '../../lib/db/types'
import { classLabel, getCurrentClassId, listClasses, setCurrentClassId } from '../../lib/roster/roster'

/** 화면마다 쓰는 학급 고르기(마지막으로 고른 학급을 기억). classes가 null이면 아직 불러오는 중. */
export function useClasses() {
  const db = useDb()
  const [classes, setClasses] = useState<ClassRec[] | null>(null)
  const [classId, setClassId] = useState<string>()
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
  }, [db])
  const choose = async (id: string) => {
    setClassId(id)
    await setCurrentClassId(db, id)
  }
  const current = classes?.find((c) => c.id === classId)
  return { classes, classId, current, choose }
}

export function ClassSelect({ classes, classId, onChange }: { classes: ClassRec[]; classId?: string; onChange: (id: string) => void }) {
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
