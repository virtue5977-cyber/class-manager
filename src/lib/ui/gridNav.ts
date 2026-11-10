/**
 * 격자 목록에서 방향키로 옮겨 갈 칸. tops = 각 칸의 화면 위치(top), 같은 값끼리 한 줄.
 * 줄 길이를 모르면(모두 같은 줄) 위·아래도 한 칸씩 움직인다. 다른 키면 null.
 */
export function gridNext(tops: number[], index: number, key: string): number | null {
  const n = tops.length
  if (!n) return null
  const cols = Math.max(1, tops.filter((t) => t === tops[0]).length)
  const rowStep = cols === n ? 1 : cols
  const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: rowStep, ArrowUp: -rowStep } as Record<string, number>)[key]
  if (step === undefined) return null
  if (index < 0) return 0
  return Math.min(n - 1, Math.max(0, index + step < 0 ? index : index + step))
}
