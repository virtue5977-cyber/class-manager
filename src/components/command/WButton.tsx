import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useShortcut } from '../../lib/ui/shortcuts'
import type { Executed } from '../../lib/command/run'
import { toYmd } from '../../lib/schoolDays'
import CommandBar from './CommandBar'
import ResultCard from './ResultCard'

/** 홈이 아닌 화면 오른쪽 아래 W: 누르면 왼쪽으로 늘어나 입력 막대가 된다. 결과는 막대 위에. */
export default function WButton() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState<Executed>()
  const box = useRef<HTMLDivElement>(null)
  const today = toYmd(new Date())
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
          {last && <ResultCard key={last.chat.id} chat={last.chat} today={today} />}
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
