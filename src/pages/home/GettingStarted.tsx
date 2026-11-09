import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../../app/context'
import { listClasses } from '../../lib/roster/roster'
import { getAiKey, getNeisKey, getSettings } from '../../lib/settings'
import { getClaudeCode } from '../../lib/ai/client'

const HIDE_KEY = 'cm.gettingStartedHidden'

interface Step {
  label: string
  hint: string
  to: string
  done: boolean
  optional?: boolean
}

/** 처음 쓸 때 할 일(위로그의 시작 단계 안내를 담임용으로). 다 하면 저절로 사라진다. */
export default function GettingStarted() {
  const db = useDb()
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    ;(async () => {
      const classes = await listClasses(db)
      const students = classes.length ? await db.students.where('class_id').anyOf(classes.map((c) => c.id)).count() : 0
      const s = await getSettings(db)
      setSteps([
        { label: '백업 켜기', hint: '암호구와 백업 폴더 정하기(노트북 고장 대비)', to: '/settings?tab=backup', done: !!(await db.device_local.get('backupKey')) },
        { label: '학급 만들기', hint: '학년도·학년·반', to: '/class', done: classes.length > 0 },
        { label: '명렬표 올리기', hint: '나이스 명렬표 엑셀을 그대로 올리고, 양식으로 보호자 정보 덧붙이기', to: '/class', done: students > 0 },
        { label: '나이스 연결', hint: '학사일정·급식·시간표를 불러오기', to: '/settings?tab=school', done: !!(await getNeisKey(db)) && !!s.neis_school_code },
        { label: 'AI 켜기', hint: '누가기록·조례 정리(선택, exe는 Claude Code로 키 없이, Pro 한도 안에서)', to: '/settings?tab=ai', done: s.ai_enabled && (!!(await getAiKey(db)) || !!getClaudeCode()), optional: true },
      ])
    })()
  }, [db])
  if (!steps || hidden || steps.filter((x) => !x.optional).every((x) => x.done)) return null
  const left = steps.filter((x) => !x.done).length
  return (
    <div className="card wide stack" aria-label="시작하기" style={{ gap: 8, padding: 12 }}>
      <div className="row between wide">
        <h3 style={{ margin: 0 }}>{`시작하기 · 남은 단계 ${left}개`}</h3>
        <button
          type="button"
          className="link"
          onClick={() => {
            setHidden(true)
            try {
              localStorage.setItem(HIDE_KEY, '1')
            } catch {
              /* 무시 */
            }
          }}
        >
          숨기기
        </button>
      </div>
      <div className="steps-compact">
        {steps.map((s, i) => (
          <Link key={s.label} to={s.to} title={s.hint} className={s.done ? 'done' : undefined}>
            {`${s.done ? '✓' : `${i + 1}`}. ${s.label}${s.optional ? '(선택)' : ''}`}
          </Link>
        ))}
      </div>
    </div>
  )
}
