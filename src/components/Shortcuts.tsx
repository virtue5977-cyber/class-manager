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
      else if (a.kind === 'command') {
        // 명령 입력(설계서 2) 전까지는 홈으로 간다.
        navigate('/')
        dispatchShortcut(a)
      } else dispatchShortcut(a)
      if (a.kind !== 'close') e.preventDefault()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [navigate])
  return null
}
