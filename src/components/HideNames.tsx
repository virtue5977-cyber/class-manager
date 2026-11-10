import { useEffect, useState } from 'react'
import { useShortcut } from '../lib/ui/shortcuts'

const KEY = 'cm.hideNames'
const EVENT = 'watson:hideNames'

export function isHideNames(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** 교실 TV·프로젝터에 띄울 때 학생 이름·연락처·상담 내용을 흐리게 가린다(이 기기에만 기억). */
export function setHideNames(on: boolean) {
  document.body.classList.toggle('hide-names', on)
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* 저장 못 해도 지금 화면엔 적용 */
  }
  window.dispatchEvent(new Event(EVENT))
}
export const toggleHideNames = () => setHideNames(!isHideNames())

/** 지금 가림 상태(다른 곳에서 바꿔도 따라감). */
export function useHideNames(): boolean {
  const [on, setOn] = useState(isHideNames)
  useEffect(() => {
    document.body.classList.toggle('hide-names', isHideNames())
    const sync = () => setOn(isHideNames())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  return on
}

/** 켜져 있을 때만 화면 위에 띠를 보이고, Ctrl+Shift+H로 켜고 끈다. */
export default function HideNamesBar() {
  const on = useHideNames()
  useShortcut('hideNames', toggleHideNames)
  if (!on) return null
  return (
    <div className="hide-names-bar" role="status">
      이름 가림 중 · 교실 화면에 띄워도 학생 이름과 상담 내용이 흐리게 보입니다.
      <button type="button" className="link" onClick={() => setHideNames(false)}>
        끄기
      </button>
    </div>
  )
}
