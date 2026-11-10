import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useDb } from '../../app/context'
import type { NoticeItemRec } from '../../lib/db/types'
import { loadReportContext } from '../../lib/absenceReports/reconcile'
import { noticesOn } from '../../lib/notices/notices'
import { toYmd, weekday } from '../../lib/schoolDays'
import { useLive } from '../../lib/ui/useLive'
import { useShortcut } from '../../lib/ui/shortcuts'
import CommandBar from '../../components/command/CommandBar'
import ChatLog from '../../components/command/ChatLog'
import { useCommandCtx } from '../../components/command/useCommandCtx'
import { executeInput } from '../../lib/command/run'
import { aiFallback } from '../../lib/command/ai'
import { remember } from '../../components/command/session'
import GettingStarted from './GettingStarted'
import TodaySummary from './TodaySummary'
import TodoList from './TodoList'
import Upcoming from './Upcoming'
import NoteBox from './NoteBox'
import NoticeTab from './NoticeTab'

const DAY = ['', '월', '화', '수', '목', '금', '토', '일']
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일(${DAY[weekday(d)]})`
const LAYOUT_KEY = 'watson.home.layout'

function readLayout(): { chatH: number; sideW: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}')
    return { chatH: Number(v.chatH) || 460, sideW: Number(v.sideW) || 320 }
  } catch {
    return { chatH: 460, sideW: 320 }
  }
}

/** 새 홈: 대화 기록 + 입력 막대(가운데), 할 일·다가오는 일정·노트함(오른쪽). 그날 전달사항이 있으면 '전달사항 n' 탭. */
export default function HomePage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const [classDay, setClassDay] = useState<boolean>()
  const [tab, setTab] = useState<'chat' | 'notice'>('chat')
  const [layout, setLayout] = useState(readLayout)
  const input = useRef<HTMLInputElement>(null)
  const { ctx, env } = useCommandCtx(today)
  const notices = useLive<NoticeItemRec[]>(() => noticesOn(db, today), [db, today], [])
  useShortcut('command', () => input.current?.focus())
  useEffect(() => {
    loadReportContext(db).then(({ days }) => setClassDay(days.isClassDay(today)))
  }, [db, today])
  useEffect(() => {
    if (!notices.length && tab === 'notice') setTab('chat')
  }, [notices.length, tab])
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
    } catch {
      /* 저장 못 해도 화면은 그대로 */
    }
  }, [layout])

  /** 끌어서 크기 바꾸기 */
  const drag = (axis: 'chatH' | 'sideW') => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = axis === 'chatH' ? e.clientY : e.clientX
    const from = layout[axis]
    const move = (ev: PointerEvent) => {
      const d = (axis === 'chatH' ? ev.clientY : ev.clientX) - start
      const v = axis === 'chatH' ? Math.min(900, Math.max(220, from + d)) : Math.min(520, Math.max(240, from - d))
      setLayout((l) => ({ ...l, [axis]: v }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  async function rerun(text: string) {
    if (!env) return
    const r = await executeInput(text, ctx, env, aiFallback)
    remember(r.chat.id, r.result)
    setTab('chat')
  }

  return (
    <section className="home2">
      <div className="home-head">
        <h2>{`${md(today)} ${classDay === undefined ? '' : classDay ? '· 수업일' : '· 수업 없는 날'}`}</h2>
        <TodaySummary today={today} />
      </div>
      <GettingStarted />
      <div className="home-body" style={{ gridTemplateColumns: `minmax(0, 1fr) 6px ${layout.sideW}px` }}>
        <div className="home-main">
          {notices.length > 0 && (
            <div className="home-tabs" role="tablist" aria-label="홈 보기">
              <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
                대화
              </button>
              <button type="button" role="tab" aria-selected={tab === 'notice'} onClick={() => setTab('notice')}>
                {`전달사항 ${notices.length}`}
              </button>
            </div>
          )}
          <div className="home-chat" style={{ height: layout.chatH }}>
            {tab === 'notice' && notices.length ? <NoticeTab date={today} /> : <ChatLog today={today} onRun={rerun} />}
          </div>
          <div className="resize-h" role="separator" aria-orientation="horizontal" aria-label="대화 높이 조절" onPointerDown={drag('chatH')} />
          <CommandBar inputRef={input} today={today} onRan={() => setTab('chat')} />
        </div>
        <div className="resize-v" role="separator" aria-orientation="vertical" aria-label="오른쪽 폭 조절" onPointerDown={drag('sideW')} />
        <aside className="home-side">
          <TodoList ctx={ctx} />
          <Upcoming today={today} />
          <NoteBox notes={ctx.notes} />
        </aside>
      </div>
    </section>
  )
}
