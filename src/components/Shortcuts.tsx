import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { dispatchShortcut, matchShortcut } from '../lib/ui/shortcuts'

const isField = (t: EventTarget | null) => !!t && t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)

/** 앱 전체 단축키. 메뉴 이동은 여기서, 나머지(앞뒤·내보내기·이름 가림·명령·닫기)는 화면에 알린다. */
export default function Shortcuts() {
  const navigate = useNavigate()
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const a = matchShortcut(e, isField(e.target))
      if (!a) return
      if (a.kind === 'nav') navigate(a.to)
      // 명령(Ctrl+K): 홈이면 입력 막대에, 다른 화면이면 W 막대를 연다(각 부품이 듣는다).
      else dispatchShortcut(a)
      if (a.kind !== 'close') e.preventDefault()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [navigate])
  return null
}
