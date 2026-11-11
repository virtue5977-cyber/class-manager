/** 줄(칸) 사이 방향키 이동: 노트 블록·전달사항 줄에서 함께 쓴다.
 * ↑: 커서가 첫 줄이면 위 칸으로, ↓: 마지막 줄이면 아래 칸으로(같은 열), ←: 맨 앞이면 위 칸 끝, →: 맨 끝이면 아래 칸 앞. */
export interface CaretMove {
  dir: -1 | 1
  col: number | 'end' | 'start'
}
type KeyLike = { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; isComposing: boolean }
type FieldLike = { value: string; selectionStart: number | null; selectionEnd: number | null }

export function caretNav(e: KeyLike, el: FieldLike): CaretMove | null {
  if (e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null
  const s = el.selectionStart ?? 0
  if (s !== (el.selectionEnd ?? 0)) return null
  const v = el.value
  const lineStart = v.lastIndexOf('\n', s - 1) + 1
  if (e.key === 'ArrowUp') return v.slice(0, s).includes('\n') ? null : { dir: -1, col: s }
  if (e.key === 'ArrowDown') return v.slice(s).includes('\n') ? null : { dir: 1, col: s - lineStart }
  if (e.key === 'ArrowLeft') return s === 0 ? { dir: -1, col: 'end' } : null
  if (e.key === 'ArrowRight') return s === v.length ? { dir: 1, col: 'start' } : null
  return null
}

/** 옮겨 간 칸에서 커서 자리 */
export function placeCaret(value: string, m: CaretMove): number {
  if (m.col === 'end') return value.length
  if (m.col === 'start') return 0
  if (m.dir === -1) {
    const start = value.lastIndexOf('\n') + 1
    return start + Math.min(m.col, value.length - start)
  }
  const nl = value.indexOf('\n')
  const end = nl < 0 ? value.length : nl
  return Math.min(m.col, end)
}

/** 긴 글이 줄바꿈되어 보일 때: 커서가 화면상 첫(↑)/마지막(↓) 줄에 있는지. 잴 수 없으면(jsdom 등) true. */
export function atVisualEdge(el: HTMLTextAreaElement, dir: -1 | 1): boolean {
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 0
  if (!lh || !el.clientWidth || typeof document === 'undefined') return true
  const y = caretTop(el)
  if (y === null) return true
  const pad = parseFloat(getComputedStyle(el).paddingTop) || 0
  return dir === -1 ? y - pad < lh * 0.9 : el.scrollHeight - (y + lh) - pad < lh * 0.9
}

/** 커서 위치의 y(textarea 안 좌표): 같은 모양의 숨은 div에 커서 앞 글을 넣어 잰다. */
function caretTop(el: HTMLTextAreaElement): number | null {
  const cs = getComputedStyle(el)
  const div = document.createElement('div')
  for (const p of ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'wordBreak', 'overflowWrap', 'tabSize'] as const)
    (div.style as unknown as Record<string, string>)[p] = (cs as unknown as Record<string, string>)[p]
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', top: '0', left: '-9999px', borderStyle: 'solid' })
  div.textContent = el.value.slice(0, el.selectionStart ?? 0)
  const mark = document.createElement('span')
  mark.textContent = el.value.slice(el.selectionStart ?? 0) || '.'
  div.appendChild(mark)
  document.body.appendChild(div)
  const y = mark.offsetTop
  div.remove()
  return Number.isFinite(y) ? y : null
}
