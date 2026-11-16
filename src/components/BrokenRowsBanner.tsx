import { useEffect, useState } from 'react'
import { onBrokenRow } from '../lib/vault/middleware'

/** 이번 실행 중 풀리지 않은 기록 수(같은 행은 한 번만). */
export default function BrokenRowsBanner() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const seen = new Set<string>()
    return onBrokenRow(({ table, id }) => {
      seen.add(`${table}\u0000${String(id)}`)
      setN(seen.size)
    })
  }, [])
  if (!n) return null
  return (
    <div className="banner" role="status">
      <span>손상된 기록 {n}개 — 백업에서 복원할 수 있습니다</span>
    </div>
  )
}
