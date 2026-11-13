import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useShortcut } from '../../lib/ui/shortcuts'
import { executeInput, type Executed } from '../../lib/command/run'
import { aiFallback } from '../../lib/command/ai'
import type { ChatRec } from '../../lib/db/types'
import { useCommandCtx } from './useCommandCtx'
import { remember } from './session'
import { toYmd } from '../../lib/schoolDays'
import CommandBar from './CommandBar'
import ResultCard from './ResultCard'

/** 홈이 아닌 화면 오른쪽 아래 W: 누르면 왼쪽으로 늘어나 입력 막대가 된다. 결과는 막대 위에. */
export default function WButton() {
  const { pathname } = useLocation()
  const [open, setOpenRaw] = useState(false)
  /** 닫히는 중(두루마리처럼 말려 들어가는 움직임) */
  const [closing, setClosing] = useState(false)
  const [last, setLast] = useState<Executed>()
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const close = () => {
    if (!open || closing) return
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return setOpenRaw(false)
    setClosing(true)
    timer.current = setTimeout(() => {
      setClosing(false)
      setOpenRaw(false)
    }, 260)
  }
  const setOpen = (v: boolean) => (v ? (clearTimeout(timer.current), setClosing(false), setOpenRaw(true)) : close())
  // Ctrl+K: 열려 있으면 닫기
  useShortcut('command', () => setOpen(!open || closing))
  useShortcut('close', () => close())
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && close()
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  })
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    clearTimeout(timer.current)
    setClosing(false)
    setOpenRaw(false)
  }, [pathname])
  if (pathname === '/') return null
  return (
    <div className={`w-float${open ? ' open' : ''}`} ref={box}>
      {open ? (
        <div className={`w-panel${closing ? ' closing' : ''}`}>
          {last && <ResultCardRunner key={last.chat.id} chat={last.chat} onRan={setLast} />}
          <CommandBar autoFocus onRan={setLast} onEscape={close} />
        </div>
      ) : (
        <button type="button" className="w-button" aria-label="명령 입력 열기(Ctrl+K)" title="명령 입력(Ctrl+K)" onClick={() => setOpen(true)}>
          W
        </button>
      )}
    </div>
  )
}

/** 결과 카드 + '이렇게 실행'·'다시 실행'을 실제로 실행하는 연결(W 막대용). */
export function ResultCardRunner({ chat, onRan }: { chat: ChatRec; onRan?: (r: Executed) => void }) {
  const today = toYmd(new Date())
  const { ctx, env } = useCommandCtx(today)
  return (
    <ResultCard
      chat={chat}
      today={today}
      onRun={async (input) => {
        if (!env) return
        const r = await executeInput(input, ctx, env, aiFallback)
        remember(r.chat.id, r.result)
        onRan?.(r)
      }}
    />
  )
}
