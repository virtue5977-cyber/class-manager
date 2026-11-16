import { useEffect, useState } from 'react'

const isQuota = (e: unknown): boolean => {
  const x = e as { name?: unknown; inner?: { name?: unknown } } | null
  return x?.name === 'QuotaExceededError' || x?.inner?.name === 'QuotaExceededError'
}

/** 저장 공간이 모자라 쓰기가 거절되면 알린다(묶음은 Dexie가 이미 되돌렸다). */
export default function QuotaBanner() {
  const [full, setFull] = useState(false)
  useEffect(() => {
    const on = (ev: Event) => {
      if (isQuota((ev as PromiseRejectionEvent).reason)) setFull(true)
    }
    window.addEventListener('unhandledrejection', on)
    return () => window.removeEventListener('unhandledrejection', on)
  }, [])
  if (!full) return null
  return (
    <div className="banner" role="alert">
      <span>저장 공간이 부족합니다. 백업한 뒤 오래된 첨부를 지우세요.</span>
      <button type="button" className="link banner-dismiss" onClick={() => setFull(false)}>닫기</button>
    </div>
  )
}
