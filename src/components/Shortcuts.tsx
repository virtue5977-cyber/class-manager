import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { closeAllMenus, installMenuAutoClose } from '../lib/ui/autoCloseMenus'
import { dispatchShortcut, matchShortcut } from '../lib/ui/shortcuts'
import { useLayoutPrefs } from '../lib/ui/layoutPrefs'

const isField = (t: EventTarget | null) => !!t && t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)

/** 앱 전체 단축키. 메뉴 이동은 여기서, 나머지(앞뒤·내보내기·이름 가림·명령·닫기)는 화면에 알린다. */
export default function Shortcuts() {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  // Ctrl+숫자: 보이는 메뉴 순서(설정 > 화면에서 바꾸면 따라 바뀐다)
  const prefs = useLayoutPrefs()
  const navOrder = useRef<string[]>([])
  navOrder.current = prefs.menu.filter((m) => !m.hidden).map((m) => m.key)
  // 펼침 메뉴: 바깥 누르기·Esc·항목 고르기·화면 이동에 닫힌다
  useEffect(() => installMenuAutoClose(document), [])
  useEffect(() => closeAllMenus(document), [pathname, search])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // 노트 글 안 Ctrl+숫자처럼 화면이 먼저 받아 처리한 키는 건너뛴다
      if (e.defaultPrevented) return
      const a = matchShortcut(e, isField(e.target), navOrder.current)
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
