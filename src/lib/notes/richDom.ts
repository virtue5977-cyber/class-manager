/** 서식 있는 한 줄(contentEditable)의 DOM 다루기: 그리기·글 읽기·커서 위치. */
import { segments, styleCss, type Mark, type NoteLink } from './marks'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;')
const cssText = (css: Record<string, string>) =>
  Object.entries(css)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')

/** 글·서식·링크 → innerHTML. 끝이 줄바꿈이면 마지막 줄이 보이도록 꼬리 <br>. */
export function renderHtml(text: string, marks?: Mark[], links?: NoteLink[]): string {
  let out = ''
  for (const s of segments(text, marks, links)) {
    const css = cssText(styleCss(s.style))
    const body = esc(s.text)
    if (s.link) out += `<span class="nl" data-note="${s.link}" title="Ctrl+클릭: 노트 열기"${css ? ` style="${css}"` : ''}>${body}</span>`
    else if (css) out += `<span style="${css}">${body}</span>`
    else out += body
  }
  if (text.endsWith('\n')) out += '<br data-tail="1">'
  return out
}

const isTail = (n: Node) => n.nodeName === 'BR' && (n as Element).getAttribute('data-tail') === '1'
const BLOCKISH = /^(DIV|P)$/

/** DOM 안 글(꼬리 <br>은 빼고, 다른 <br>·브라우저가 넣은 div는 줄바꿈) */
export function readText(root: Node): string {
  let out = ''
  const walk = (n: Node, first: boolean) => {
    if (n.nodeType === 3) out += (n as Text).data.replace(/ /g, ' ')
    else if (n.nodeName === 'BR') {
      if (!isTail(n)) out += '\n'
    } else {
      if (n !== root && BLOCKISH.test(n.nodeName) && !first && !out.endsWith('\n')) out += '\n'
      n.childNodes.forEach((c, i) => walk(c, i === 0))
    }
  }
  walk(root, true)
  return out
}

/** (node, offset) → 글자 위치 */
function posOf(root: Node, node: Node, offset: number): number {
  let pos = 0
  let found = -1
  const walk = (n: Node): boolean => {
    if (n === node && n.nodeType === 3) {
      found = pos + Math.min(offset, (n as Text).data.length)
      return true
    }
    if (n === node) {
      // 요소 안 offset번째 자식 앞
      for (let i = 0; i < offset && i < n.childNodes.length; i++) pos += readText(n.childNodes[i]).length
      found = pos
      return true
    }
    if (n.nodeType === 3) pos += (n as Text).data.length
    else if (n.nodeName === 'BR') pos += isTail(n) ? 0 : 1
    else for (const c of Array.from(n.childNodes)) if (walk(c)) return true
    return false
  }
  walk(root)
  return found < 0 ? readText(root).length : found
}

/** 글자 위치 → (node, offset) */
function pointOf(root: Node, at: number): { node: Node; offset: number } {
  let left = at
  let last: { node: Node; offset: number } | null = null
  const walk = (n: Node): { node: Node; offset: number } | null => {
    if (n.nodeType === 3) {
      const len = (n as Text).data.length
      if (left <= len) return { node: n, offset: left }
      left -= len
      last = { node: n, offset: len }
      return null
    }
    if (n.nodeName === 'BR') {
      if (isTail(n)) return null
      const parent = n.parentNode!
      const idx = Array.prototype.indexOf.call(parent.childNodes, n)
      if (left === 0) return { node: parent, offset: idx }
      left -= 1
      last = { node: parent, offset: idx + 1 }
      return null
    }
    for (const c of Array.from(n.childNodes)) {
      const r = walk(c)
      if (r) return r
    }
    return null
  }
  return walk(root) ?? last ?? { node: root, offset: 0 }
}

/** 이 칸 안 고른 범위(없으면 null) */
export function getSel(root: HTMLElement): { start: number; end: number } | null {
  const s = root.ownerDocument.getSelection?.()
  if (!s || !s.rangeCount) return null
  const r = s.getRangeAt(0)
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null
  return { start: posOf(root, r.startContainer, r.startOffset), end: posOf(root, r.endContainer, r.endOffset) }
}

export function setSel(root: HTMLElement, start: number, end = start): void {
  const doc = root.ownerDocument
  const s = doc.getSelection?.()
  if (!s) return
  const a = pointOf(root, start)
  const b = end === start ? a : pointOf(root, end)
  const r = doc.createRange()
  r.setStart(a.node, a.offset)
  r.setEnd(b.node, b.offset)
  s.removeAllRanges()
  s.addRange(r)
}

/** 긴 글이 줄바꿈되어 보일 때 커서가 화면상 첫(↑)·마지막(↓) 줄인지. 잴 수 없으면(jsdom) true. */
export function atLineEdge(root: HTMLElement, dir: -1 | 1): boolean {
  const s = root.ownerDocument.getSelection?.()
  if (!s || !s.rangeCount) return true
  const r = s.getRangeAt(0)
  if (typeof r.getClientRects !== 'function') return true
  const rects = Array.from(r.getClientRects?.() ?? [])
  const box = root.getBoundingClientRect?.()
  if (!box || !box.height) return true
  const rect = rects[0] ?? (typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : null)
  if (!rect || !rect.height) return true
  const lh = parseFloat(getComputedStyle(root).lineHeight) || rect.height
  return dir === -1 ? rect.top - box.top < lh * 0.9 : box.bottom - rect.bottom < lh * 0.9
}
