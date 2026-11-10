import type { NoteBlock, NoteBlockType } from '../db/types'
import { choseong } from '../hangul'
import { newBlockId } from './notes'

const LIST: NoteBlockType[] = ['check', 'bullet', 'number']

export const SLASH_ITEMS: { type: NoteBlockType; label: string; keywords: string }[] = [
  { type: 'p', label: '문단', keywords: '글 텍스트' },
  { type: 'h1', label: '제목 1', keywords: '큰제목 헤딩' },
  { type: 'h2', label: '제목 2', keywords: '작은제목 헤딩' },
  { type: 'check', label: '체크 목록', keywords: '할일 체크박스 todo' },
  { type: 'bullet', label: '글머리 목록', keywords: '점 목록' },
  { type: 'number', label: '번호 목록', keywords: '숫자' },
  { type: 'divider', label: '구분선', keywords: '선 줄' },
  { type: 'file', label: '파일', keywords: '첨부 붙이기' },
  { type: 'folder', label: '폴더', keywords: '연결 탐색기' },
]

export function filterSlash(q: string) {
  const t = q.trim()
  if (!t) return SLASH_ITEMS
  return SLASH_ITEMS.filter((i) => i.label.includes(t) || i.keywords.includes(t) || choseong(i.label.replace(/\s/g, '')).startsWith(t))
}

/** Enter: 커서에서 나눈다. 빈 목록 블록이면 문단으로 바꿔 목록을 끝낸다. 제목 다음은 문단. */
export function splitBlock(blocks: NoteBlock[], id: string, caret: number): { blocks: NoteBlock[]; focusId: string } {
  const i = blocks.findIndex((b) => b.id === id)
  const b = blocks[i]
  const text = b.text ?? ''
  if (!text && LIST.includes(b.type)) {
    const next = blocks.map((x) => (x.id === id ? { id: x.id, type: 'p' as const, text: '' } : x))
    return { blocks: next, focusId: id }
  }
  const nb: NoteBlock = { id: newBlockId(), type: LIST.includes(b.type) ? b.type : 'p', text: text.slice(caret), ...(b.type === 'check' ? { checked: false } : {}), ...(b.indent ? { indent: b.indent } : {}) }
  const next = [...blocks.slice(0, i), { ...b, text: text.slice(0, caret) }, nb, ...blocks.slice(i + 1)]
  return { blocks: next, focusId: nb.id }
}

/** 맨 앞에서 Backspace: 위 글 블록 끝에 붙인다(위가 구분선·파일이면 그것을 지운다). */
export function mergeUp(blocks: NoteBlock[], id: string): { blocks: NoteBlock[]; focusId: string; caret: number } {
  const i = blocks.findIndex((b) => b.id === id)
  // 들여쓴 블록이면 먼저 한 칸 내어쓴다.
  if (i >= 0 && (blocks[i].indent ?? 0) > 0) return { blocks: indentBlock(blocks, id, -1), focusId: id, caret: 0 }
  if (i <= 0) {
    if (i === 0 && blocks[0].type !== 'p') return { blocks: setType(blocks, id, 'p'), focusId: id, caret: 0 }
    return { blocks, focusId: id, caret: 0 }
  }
  const up = blocks[i - 1]
  const cur = blocks[i]
  if (up.type === 'divider' || up.type === 'file' || up.type === 'folder') return { blocks: blocks.filter((b) => b.id !== up.id), focusId: id, caret: 0 }
  const caret = (up.text ?? '').length
  const next = [...blocks.slice(0, i - 1), { ...up, text: (up.text ?? '') + (cur.text ?? '') }, ...blocks.slice(i + 1)]
  return { blocks: next, focusId: up.id, caret }
}

export function moveBlock(blocks: NoteBlock[], id: string, toIndex: number): NoteBlock[] {
  const b = blocks.find((x) => x.id === id)
  if (!b) return blocks
  const rest = blocks.filter((x) => x.id !== id)
  const j = Math.max(0, Math.min(rest.length, toIndex))
  return [...rest.slice(0, j), b, ...rest.slice(j)]
}

export function setType(blocks: NoteBlock[], id: string, type: NoteBlockType): NoteBlock[] {
  return blocks.map((b) => (b.id === id ? { id: b.id, type, text: b.text ?? '', ...(type === 'check' ? { checked: false } : {}), ...(b.indent ? { indent: b.indent } : {}) } : b))
}

export const MAX_INDENT = 4

/** Tab(+1)·Shift+Tab(-1): 0~4 */
export function indentBlock(blocks: NoteBlock[], id: string, dir: 1 | -1): NoteBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, indent: Math.max(0, Math.min(MAX_INDENT, (b.indent ?? 0) + dir)) } : b))
}

const GANA = '가나다라마바사아자차카타파하'
const NUMBER_STYLE = [(n: number) => `${n}.`, (n: number) => `${GANA[(n - 1) % 14]}.`, (n: number) => `${n})`, (n: number) => `${GANA[(n - 1) % 14]})`, (n: number) => `(${n})`]
const BULLETS = ['•', '◦', '▪', '•', '◦']

/** 개요 표시: 번호 목록은 깊이별 1. → 가. → 1) → 가) → (1), 글머리는 • ◦ ▪. 얕거나 같은 깊이의 다른 블록이 오면 그 깊이부터 다시 센다. */
export function outlineMarks(blocks: NoteBlock[]): string[] {
  const count = [0, 0, 0, 0, 0]
  return blocks.map((b) => {
    const lv = Math.max(0, Math.min(MAX_INDENT, b.indent ?? 0))
    for (let k = lv + 1; k <= MAX_INDENT; k++) count[k] = 0
    if (b.type === 'number') return NUMBER_STYLE[lv](++count[lv])
    count[lv] = 0
    return b.type === 'bullet' ? BULLETS[lv] : ''
  })
}
