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
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState<Executed>()
  const box = useRef<HTMLDivElement>(null)
  useShortcut('command', () => setOpen(true))
  useShortcut('close', () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  useEffect(() => setOpen(false), [pathname])
  if (pathname === '/') return null
  return (
    <div className={`w-float${open ? ' open' : ''}`} ref={box}>
      {open ? (
        <div className="w-panel">
          {last && <ResultCardRunner key={last.chat.id} chat={last.chat} onRan={setLast} />}
          <CommandBar autoFocus onRan={setLast} onEscape={() => setOpen(false)} />
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
