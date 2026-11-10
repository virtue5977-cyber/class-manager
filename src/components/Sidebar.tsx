import { useEffect, useState } from 'react'
import { useDb } from '../app/context'
import { getSettings } from '../lib/settings'
import { classLabel } from '../lib/roster/roster'
import { useClasses } from '../pages/common/useClasses'
import Nav, { SettingsNav } from './Nav'

/** 사이드바 머리: Watson / 학교명 / 학년도·반(학급이 여럿이면 고르기). */
function Brand() {
  const db = useDb()
  const { classes, classId, choose } = useClasses()
  const [school, setSchool] = useState('')
  useEffect(() => {
    getSettings(db).then((s) => setSchool(s.school_name ?? ''))
  }, [db])
  const label = (c: NonNullable<typeof classes>[number]) => `${c.school_year}학년도 ${classLabel(c)}`
  return (
    <div className="brand">
      <div className="brand-name">Watson</div>
      {school && <div className="brand-sub">{school}</div>}
      {classes && classes.length === 1 && <div className="brand-sub">{label(classes[0])}</div>}
      {classes && classes.length > 1 && (
        <select className="brand-class" aria-label="학급 전환" value={classId} onChange={(e) => choose(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {label(c)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function Sidebar({ badges }: { badges?: Record<string, number> }) {
  return (
    <aside className="sidebar">
      <Brand />
      <Nav badges={badges} />
      <div className="side-bottom">
        <SettingsNav />
        <div className="version">{`v${__APP_VERSION__}`}</div>
      </div>
    </aside>
  )
}
