import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 화면 머리: 제목(+선택 한 줄 요약)과 같은 줄 오른쪽에 도구. 하위 탭의 도구도 HeadTools로 이 줄에 모은다. */
/** compact: 요약을 제목 옆 한 줄에, 도구는 제목 줄 높이에(내용이 위에서 시작) */
export default function PageHead({ title, summary, children, compact }: { title: ReactNode; summary?: ReactNode; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={`page-head${compact ? ' compact' : ''}`}>
      <div className="page-title">
        <h2>{title}</h2>
        {typeof summary === 'string' ? <span className="muted">{summary}</span> : summary}
      </div>
      <div className="tools">
        <span className="head-slot" data-head-slot="" />
        {children}
      </div>
    </div>
  )
}

/** 하위 화면(탭)의 도구를 화면 머리 오른쪽에 넣는다. 머리가 없으면(시험 등) 제자리에 그린다. */
export function HeadTools({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<Element | null>(null)
  const [looked, setLooked] = useState(false)
  useLayoutEffect(() => {
    setSlot(document.querySelector('[data-head-slot]'))
    setLooked(true)
  }, [])
  if (!looked) return null
  return slot ? createPortal(children, slot) : <div className="toolbar">{children}</div>
}
