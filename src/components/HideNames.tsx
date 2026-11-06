import { useEffect, useState } from 'react'

const KEY = 'cm.hideNames'
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** 교실 화면(TV)에 띄울 때 학생 이름·상담 내용을 흐리게 가린다. 이 브라우저에만 기억. */
export default function HideNames() {
  const [on, setOn] = useState(read)
  useEffect(() => {
    document.body.classList.toggle('hide-names', on)
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      /* 저장 못 해도 동작은 한다 */
    }
  }, [on])
  return (
    <button type="button" className={`hide-names-btn${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setOn(!on)} title="교실 화면에 띄울 때 학생 이름과 상담 내용을 가립니다">
      {on ? '🙈 이름 가림' : '👁 이름 보임'}
    </button>
  )
}
