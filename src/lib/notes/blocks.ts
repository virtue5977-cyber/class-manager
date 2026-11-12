import type { NoteBlock, NoteBlockType } from '../db/types'
import { choseong } from '../hangul'
import { newBlockId } from './notes'

const LIST: NoteBlockType[] = ['check', 'bullet', 'number']

export const SLASH_ITEMS: { type: NoteBlockType; label: string; keywords: string; icon: string; hint: string }[] = [
  { type: 'p', label: '문단', keywords: '글 텍스트', icon: '¶', hint: '보통 글 · Ctrl+1' },
  { type: 'h1', label: '제목 1', keywords: '큰제목 헤딩', icon: 'H1', hint: '큰 제목 · Ctrl+2 · # ' },
  { type: 'h2', label: '제목 2', keywords: '작은제목 헤딩', icon: 'H2', hint: '작은 제목 · Ctrl+3 · ## ' },
  { type: 'check', label: '체크 목록', keywords: '할일 체크박스 todo', icon: '☑', hint: '할 일처럼 체크 · Ctrl+6 · [] ' },
  { type: 'bullet', label: '글머리 목록', keywords: '점 목록', icon: '•', hint: '점으로 나열 · Ctrl+4 · - ' },
  { type: 'number', label: '번호 목록', keywords: '숫자', icon: '1.', hint: '1. 가. 1) 순서 · Ctrl+5 · 1. ' },
  { type: 'divider', label: '구분선', keywords: '선 줄', icon: '—', hint: '가로줄' },
  { type: 'file', label: '파일', keywords: '첨부 붙이기', icon: '📎', hint: '파일 붙이기(50MB까지)' },
  { type: 'folder', label: '폴더', keywords: '연결 탐색기', icon: '📁', hint: '노트북 폴더 연결' },
  { type: 'roster', label: '명렬표 체크', keywords: '명렬표 학생 체크 표 제출 확인', icon: '☑', hint: '학생 이름 표 + 체크(@명렬표) · Ctrl+Alt+T' },
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

/** 학생 체크 표 블록(번호 이름 · 체크). 학생은 만든 때의 명단으로 고정. */
export function rosterBlock(students: { id: string; number: number; name: string }[], title = ''): NoteBlock {
  return { id: newBlockId(), type: 'roster', text: title, rows: students.map((s) => ({ sid: s.id, label: `${s.number}번 ${s.name}`, checked: false })) }
}

/** 노트 안 Ctrl+숫자(한글 프로그램처럼): 1 문단 · 2 제목1 · 3 제목2 · 4 글머리 · 5 번호 · 6 체크 */
export const NOTE_CTRL_KEYS: Record<string, NoteBlockType> = { '1': 'p', '2': 'h1', '3': 'h2', '4': 'bullet', '5': 'number', '6': 'check' }
/** 예전 단축키(Ctrl+Shift·Ctrl+Alt + 숫자, Ctrl+Alt+T): 손에 익은 사람을 위해 계속 받는다 */
export const NOTE_SHORTCUTS: Record<string, NoteBlockType> = { '1': 'h1', '2': 'h2', '0': 'p', '7': 'number', '8': 'bullet', '9': 'check', t: 'roster' }

/** 노트 단축키 → 블록 종류. Ctrl+숫자(1~6), 예전 Ctrl+Shift+숫자·Ctrl+Alt+숫자·T. 한글 자판·Shift 기호여도 code(키 자리)로 읽는다. */
export function noteShortcut(e: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): NoteBlockType | null {
  if (!(e.ctrlKey || e.metaKey)) return null
  if (!e.altKey && !e.shiftKey) {
    const d = /^Digit(\d)$/.exec(e.code)?.[1] ?? (/^\d$/.test(e.key) ? e.key : '')
    return NOTE_CTRL_KEYS[d] ?? null
  }
  const alt = e.altKey && !e.shiftKey
  const shift = e.shiftKey && !e.altKey
  if (!alt && !shift) return null
  const k = /^Digit(\d)$/.exec(e.code)?.[1] ?? (e.code === 'KeyT' ? 't' : /^[0-9t]$/i.test(e.key) ? e.key.toLowerCase() : '')
  if (k === 't' && !alt) return null
  return NOTE_SHORTCUTS[k] ?? null
}

/** 줄 맨 앞 글자로 블록 바꾸기 */
export function markdownPrefix(text: string): { type: NoteBlockType; rest: string } | null {
  const m = /^(##|#|-|\*|1\.|\[\]) ([\s\S]*)$/.exec(text)
  if (!m) return null
  const type: NoteBlockType = m[1] === '#' ? 'h1' : m[1] === '##' ? 'h2' : m[1] === '1.' ? 'number' : m[1] === '[]' ? 'check' : 'bullet'
  return { type, rest: m[2] }
}
