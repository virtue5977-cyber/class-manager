import { useEffect, useState } from 'react'

/** 대답을 기다리는 말풍선: 300ms가 지나야 보인다(바로 끝나는 규칙 명령은 깜박이지 않게). */
export default function TypingBubble({ delay = 300 }: { delay?: number }) {
  const [show, setShow] = useState(delay <= 0)
  useEffect(() => {
    if (delay <= 0) return
    const t = setTimeout(() => setShow(true), delay)
    return () => clearTimeout(t)
  }, [delay])
  if (!show) return null
  return (
    <div className="typing" role="status" aria-label="대답을 만드는 중">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  )
}
