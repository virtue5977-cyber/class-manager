import { PANEL_LABEL, panelPlace, placePanel, savePrefs, setPlace, useLayoutPrefs, type PanelKey } from '../../lib/ui/layoutPrefs'
import { startPointerDrag } from '../../lib/ui/pointerDrag'
import { newThread } from '../../lib/command/chatThreads'
import { TodayMeal } from './TodaySummary'
import { useLayoutEffect, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
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
/** chatH 0 = 화면에 맞춤(입력 막대가 늘 보이게). 끌어서 줄이면 그 높이가 최대. 예전 키의 높이(460 고정)는 버린다. */
const LAYOUT_KEY2 = 'watson.home.layout2'

function readLayout(): { chatH: number; sideW: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY2) ?? localStorage.getItem(LAYOUT_KEY) ?? '{}')
    return { chatH: localStorage.getItem(LAYOUT_KEY2) ? Number(v.chatH) || 0 : 0, sideW: Number(v.sideW) || 320 }
  } catch {
    return { chatH: 0, sideW: 320 }
  }
}

/** 대화 칸이 쓸 수 있는 높이: 창 아래까지에서 입력 막대 자리를 뺀 값(최소 220). */
function useFitHeight(chat: React.RefObject<HTMLDivElement | null>, bar: React.RefObject<HTMLDivElement | null>) {
  const [h, setH] = useState(0)
  useLayoutEffect(() => {
    const calc = () => {
      const top = chat.current?.getBoundingClientRect().top ?? 0
      const barH = bar.current?.getBoundingClientRect().height ?? 90
      setH(Math.max(220, Math.floor(window.innerHeight - top - barH - 40)))
    }
    calc()
    window.addEventListener('resize', calc)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(calc)
    const head = chat.current?.closest('.home2')
    if (ro && head) for (const el of Array.from(head.children)) ro.observe(el)
    if (ro && bar.current) ro.observe(bar.current)
    return () => {
      window.removeEventListener('resize', calc)
      ro?.disconnect()
    }
  }, [chat, bar])
  return h
}

/** 새 홈: 대화 기록 + 입력 막대(가운데), 할 일·다가오는 일정·노트함(오른쪽). 그날 전달사항이 있으면 '전달사항 n' 탭. */
export default function HomePage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const [classDay, setClassDay] = useState<boolean>()
  const prefs = useLayoutPrefs()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'chat' | PanelKey>(params.get('tab') === 'notice' ? 'notice' : 'chat')
  // 결과 카드의 '전달사항 보기'(/?tab=notice)
  useEffect(() => {
    if (params.get('tab') === 'notice') {
      setTab('notice')
      setParams({}, { replace: true })
    }
  }, [params, setParams])
  const [layout, setLayout] = useState(readLayout)
  const input = useRef<HTMLInputElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const fit = useFitHeight(chatRef, barRef)
  const chatHeight = layout.chatH ? Math.min(layout.chatH, fit || layout.chatH) : fit || 460
  const { ctx, env } = useCommandCtx(today)
  const notices = useLive<NoticeItemRec[]>(() => noticesOn(db, today), [db, today], [])
  useShortcut('command', () => input.current?.focus())
  useEffect(() => {
    loadReportContext(db).then(({ days }) => setClassDay(days.isClassDay(today)))
  }, [db, today])
  const tabPanels = prefs.panels.filter((x) => panelPlace(x) === 'tab').map((x) => x.key)
  const sidePanels = prefs.panels.filter((x) => panelPlace(x) === 'side').map((x) => x.key)
  // 탭에 있던 칸을 오른쪽으로 보내면 대화로
  useEffect(() => {
    if (tab !== 'chat' && !tabPanels.includes(tab)) setTab('chat')
  }, [tab, tabPanels])
  /** 전달사항을 넣었을 때: 전달사항이 왼쪽 탭이면 그 탭으로 */
  const showNotice = () => setTab(tabPanels.includes('notice') ? 'notice' : 'chat')
  const bodyRef = useRef<HTMLDivElement>(null)
  /** 칸 자리 바꾸기(머리 단추) */
  const movePanel = (key: PanelKey, place: 'side' | 'tab') => savePrefs({ ...prefs, panels: setPlace(prefs.panels, key, place) })
  /** 오른쪽 칸 높이 끌기(0 = 내용에 맞춤) */
  const setPanelH = (key: PanelKey, h: number) => {
    const panelH = { ...prefs.panelH }
    if (h) panelH[key] = h
    else delete panelH[key]
    savePrefs({ ...prefs, panelH })
  }
  /** 탭·칸 끌기: 왼쪽 탭 줄이나 오른쪽 열의 원하는 자리에 놓는다(반대쪽으로도) */
  const [dragKey, setDragKey] = useState<PanelKey>()
  const [dropAt, setDropAt] = useState<string>()
  function beginPanelDrag(e: React.PointerEvent, key: PanelKey) {
    let target: string | undefined
    startPointerDrag(e, {
      onStart: () => setDragKey(key),
      onMove: (x, y) => {
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')
        target = el?.dataset.drop
        setDropAt(target)
      },
      onCancel: () => (setDragKey(undefined), setDropAt(undefined)),
      onDrop: () => {
        setDragKey(undefined)
        setDropAt(undefined)
        if (!target) return
        const [place, before] = target.split(':') as ['tab' | 'side', string]
        if (before === key) return
        savePrefs({ ...prefs, panels: placePanel(prefs.panels, key, place, (before || null) as PanelKey | null) })
        if (place === 'tab') setTab(key)
      },
    })
  }
  const dropCls = (id: string) => (dragKey && dropAt === id ? ' drop-here' : '')
  const renderPanel = (key: PanelKey) =>
    key === 'notice' ? <NoticeTab date={today} /> : key === 'todo' ? <TodoList ctx={ctx} /> : key === 'upcoming' ? <Upcoming today={today} /> : key === 'notes' ? <NoteBox notes={ctx.notes} /> : <TodayMeal today={today} panel />
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY2, JSON.stringify(layout))
    } catch {
      /* 저장 못 해도 화면은 그대로 */
    }
  }, [layout])

  /** 끌어서 크기 바꾸기 */
  const drag = (axis: 'chatH' | 'sideW') => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = axis === 'chatH' ? e.clientY : e.clientX
    // 오른쪽 폭은 화면에 보이는 실제 폭에서 시작(60% 한도에 걸려 있으면 저장값과 다르다)
    const from = axis === 'chatH' ? chatHeight : bodyRef.current?.querySelector('.home-side')?.getBoundingClientRect().width || layout[axis]
    const move = (ev: PointerEvent) => {
      const d = (axis === 'chatH' ? ev.clientY : ev.clientX) - start
      // 오른쪽 칸: 240px ~ 홈 본문의 60%(대화 칸은 320px 아래로 줄지 않게)
      const bodyW = bodyRef.current?.getBoundingClientRect().width || 1200
      const v = axis === 'chatH' ? Math.min(900, Math.max(220, from + d)) : Math.min(Math.max(240, Math.min(bodyW * 0.6, bodyW - 330)), Math.max(240, from - d))
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
      <div className="home-body" ref={bodyRef} style={{ gridTemplateColumns: sidePanels.length ? `minmax(min(320px, 38%), 1fr) 6px min(${layout.sideW}px, 60%)` : 'minmax(0, 1fr)' }}>
        <div className="home-main">
          {/* 날짜·요약·시작하기는 왼쪽 열에만(오른쪽 칸은 맨 위 날짜 줄부터) */}
          <div className="home-head">
            <h2>{`${md(today)} ${classDay === undefined ? '' : classDay ? '· 수업일' : '· 수업 없는 날'}`}</h2>
            <TodaySummary today={today} />
          </div>
          <GettingStarted />
          <div className={`home-tabs${dropCls('tab:')}`} role="tablist" aria-label="홈 보기" data-drop="tab:">
            <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
              대화
            </button>
            {tab === 'chat' && (
              <button type="button" className="link new-chat" title="새 채팅(지금 대화는 왼쪽 '최근 대화'로)" onClick={() => newThread()}>
                ＋ 새 채팅
              </button>
            )}
            {tabPanels.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} data-drop={`tab:${k}`} className={`${dragKey === k ? 'dragging' : ''}${dropCls(`tab:${k}`)}`} title="끌어서 순서를 바꾸거나 오른쪽으로 옮길 수 있습니다" onPointerDown={(e) => beginPanelDrag(e, k)} onClick={() => setTab(k)}>
                {k === 'notice' && notices.length ? `전달사항 ${notices.length}` : PANEL_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="home-chat" ref={chatRef} style={{ height: chatHeight }}>
            {tab === 'chat' ? (
              <ChatLog today={today} onRun={rerun} />
            ) : (
              <div className="home-tabpanel" role="tabpanel" aria-label={PANEL_LABEL[tab]}>
                <button type="button" className="link panel-move" aria-label={`${PANEL_LABEL[tab]} 오른쪽으로`} title="오른쪽 칸으로 보내기" onClick={() => movePanel(tab, 'side')}>
                  오른쪽으로 ⇥
                </button>
                {renderPanel(tab)}
              </div>
            )}
          </div>
          <div className="resize-h" role="separator" aria-orientation="horizontal" aria-label="대화 높이 조절" title="끌어서 높이 조절 · 두 번 누르면 화면에 맞춤" onPointerDown={drag('chatH')} onDoubleClick={() => setLayout((l) => ({ ...l, chatH: 0 }))} />
          <div ref={barRef}>
            <CommandBar inputRef={input} autoFocus today={today} onRan={(r) => (r.result?.links?.some((l) => l.to === '/?tab=notice') ? showNotice() : setTab('chat'))} />
          </div>
        </div>
        {sidePanels.length > 0 && <div className="resize-v" role="separator" aria-orientation="vertical" aria-label="오른쪽 폭 조절" title="끌어서 오른쪽 칸 폭 조절" onPointerDown={drag('sideW')} />}
        {sidePanels.length > 0 && (
          <aside className={`home-side${dropCls('side:')}`} aria-label="홈 오른쪽 칸" data-drop="side:">
            {sidePanels.map((k) => (
              <div key={k} data-drop={`side:${k}`} className={`panel-slot${dragKey === k ? ' dragging' : ''}${dropCls(`side:${k}`)}`}>
                <PanelFrame label={PANEL_LABEL[k]} height={prefs.panelH[k]} onHeight={(h) => setPanelH(k, h)} onMove={() => movePanel(k, 'tab')} onGrip={(e) => beginPanelDrag(e, k)}>
                  {renderPanel(k)}
                </PanelFrame>
              </div>
            ))}
          </aside>
        )}
      </div>
    </section>
  )
}

/** 오른쪽 칸 틀: 머리의 '왼쪽 탭으로' 단추(마우스를 올리면 보임), 아래 경계선 끌어 높이(두 번 누르면 내용에 맞춤). */
function PanelFrame({ label, height, onHeight, onMove, onGrip, children }: { label: string; height?: number; onHeight: (h: number) => void; onMove: () => void; onGrip: (e: React.PointerEvent) => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<number>()
  const h = live ?? height
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = e.clientY
    const from = box.current?.getBoundingClientRect().height ?? 200
    let last = from
    const move = (ev: PointerEvent) => {
      last = Math.min(900, Math.max(120, from + ev.clientY - start))
      setLive(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLive(undefined)
      onHeight(Math.round(last))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="panel-frame">
      <span className="panel-grip" role="button" tabIndex={-1} aria-label={`${label} 끌어서 옮기기`} title="끌어서 순서를 바꾸거나 왼쪽 탭 줄로 옮기기" onPointerDown={(e) => (e.preventDefault(), onGrip(e))}>
        ⠿ 옮기기
      </span>
      <button type="button" className="icon-btn panel-move" aria-label={`${label} 왼쪽 탭으로`} title="왼쪽 탭으로 옮기기" onClick={onMove}>
        ⇤ 탭으로
      </button>
      <div className={`panel-body${h ? ' sized' : ''}`} ref={box} style={h ? { height: h } : undefined}>
        {children}
      </div>
      <div className="resize-h panel-resize" role="separator" aria-orientation="horizontal" aria-label={`${label} 높이 조절`} title="끌어서 높이 조절 · 두 번 누르면 내용에 맞춤" onPointerDown={down} onDoubleClick={() => onHeight(0)} />
    </div>
  )
}
