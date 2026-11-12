/** 노트 쪽 보기: 블록 높이로 쪽 나누기(화면에만, 저장하지 않음), 여백, 머리말·꼬리말 글 */
export type MarginKey = 'narrow' | 'normal' | 'wide'
export const MARGINS: Record<MarginKey, { top: number; bottom: number; left: number; right: number }> = {
  narrow: { top: 15, bottom: 15, left: 15, right: 15 },
  normal: { top: 20, bottom: 20, left: 25, right: 25 },
  wide: { top: 25, bottom: 25, left: 30, right: 30 },
}
export const A4 = { w: 210, h: 297 }

/**
 * 각 쪽의 첫 블록 index(맨 앞은 늘 0).
 * - 지금 쪽에 쓴 높이 + 이 블록이 pageH를 넘으면 다음 쪽(쪽 맨 앞 블록은 커도 그 쪽에 둔다).
 * - forced[i]면 i는 새 쪽에서 시작(이미 쪽 맨 앞이면 그대로).
 */
export function paginate(heights: number[], forced: boolean[], pageH: number): number[] {
  const starts = [0]
  let y = 0
  heights.forEach((h, i) => {
    if (i > 0 && y > 0 && (forced[i] || y + h > pageH)) {
      starts.push(i)
      y = 0
    }
    y += h
  })
  return starts
}

const ymd = (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}.`
/** {쪽} {전체쪽} {날짜} 바꾸기 */
export function fillHeaderFooter(t: string, page: number, total: number, today: string): string {
  return t.replace(/\{쪽\}/g, String(page)).replace(/\{전체쪽\}/g, String(total)).replace(/\{날짜\}/g, ymd(today))
}
