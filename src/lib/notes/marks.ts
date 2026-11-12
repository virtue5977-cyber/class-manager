/** 노트 글자 서식(marks)과 노트 링크(links): 블록 text 안의 글자 위치 [from, to). text는 서식 없는 글 그대로. */

export interface Style {
  b?: boolean
  u?: boolean
  i?: boolean
  s?: boolean
  /** 글자색(#rrggbb) */
  color?: string
  /** 형광펜(#rrggbb) */
  bg?: string
  /** 글꼴 이름(FONTS 중 하나) */
  font?: string
  /** 예전 글자 크기(0.14까지). 새 값은 pt */
  size?: 'sm' | 'lg'
  /** 글자 크기 pt(8~32) */
  pt?: number
}
export interface Mark extends Style {
  from: number
  to: number
}
export interface NoteLink {
  from: number
  to: number
  note: string
}

export const FONTS = ['맑은 고딕', '함초롬바탕', '함초롬돋움', '나눔고딕', '바탕', '돋움', '굴림', '궁서'] as const
export const COLORS = ['#000000', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#1f618d', '#7d3c98', '#7f8c8d'] as const
export const HIGHLIGHTS = ['#fff59d', '#c8e6c9', '#bbdefb', '#f8bbd0', '#ffe0b2'] as const

const KEYS = ['b', 'u', 'i', 's', 'color', 'bg', 'font', 'size', 'pt'] as const
export const PT_MIN = 8
export const PT_MAX = 32
/** 글자 크기(pt): pt가 있으면 그것, 예전 size면 base의 0.85·1.25배, 없으면 base */
export const ptOf = (s: Style, base: number): number => s.pt ?? (s.size ? Math.round(base * (s.size === 'sm' ? 0.85 : 1.25) * 10) / 10 : base)
type Key = (typeof KEYS)[number]

const HEX = /^#[0-9a-fA-F]{3,8}$/
/** 쓸 수 있는 값만 남긴다(백업·동기화로 들어온 이상한 값이 HTML·CSS에 끼어들지 못하게) */
const okValue = (k: Key, v: unknown): boolean =>
  k === 'color' || k === 'bg' ? typeof v === 'string' && HEX.test(v)
  : k === 'font' ? (FONTS as readonly unknown[]).includes(v)
  : k === 'size' ? v === 'sm' || v === 'lg'
  : k === 'pt' ? typeof v === 'number' && v >= PT_MIN && v <= PT_MAX
  : v === true
const clean = (s: Style): Style => {
  const o: Style = {}
  for (const k of KEYS) if (s[k] && okValue(k, s[k])) (o as Record<string, unknown>)[k] = s[k]
  return o
}
const LINK_ID = /^[\w-]{1,64}$/
const same = (a: Style, b: Style) => KEYS.every((k) => (a[k] || undefined) === (b[k] || undefined))
const empty = (s: Style) => KEYS.every((k) => !s[k])

/** 글자마다 서식 */
export function toChars(marks: Mark[] | undefined, len: number): Style[] {
  const out: Style[] = Array.from({ length: len }, () => ({}))
  for (const m of marks ?? []) for (let i = Math.max(0, m.from); i < Math.min(len, m.to); i++) out[i] = { ...out[i], ...clean(m) }
  return out
}
/** 글자마다 서식 → 겹치지 않고 이웃이 같으면 합친 marks(빈 서식은 뺀다) */
export function fromChars(chars: Style[]): Mark[] {
  const out: Mark[] = []
  chars.forEach((c, i) => {
    if (empty(c)) return
    const last = out[out.length - 1]
    if (last && last.to === i && same(last, c)) last.to = i + 1
    else out.push({ ...clean(c), from: i, to: i + 1 })
  })
  return out
}

/** [from,to) 서식 바꾸기. 켜고 끄는 것(b u i s)은 모두 켜져 있으면 끄고 아니면 켠다. 값(color 등)은 같은 값이면 끄고, 아니면 그 값으로. */
export function applyStyle(marks: Mark[] | undefined, len: number, from: number, to: number, key: Key, value?: string | number): Mark[] {
  const chars = toChars(marks, len)
  const a = Math.max(0, Math.min(from, to))
  const z = Math.min(len, Math.max(from, to))
  if (a >= z) return fromChars(chars)
  const range = chars.slice(a, z)
  const all = value === undefined ? range.every((c) => c[key]) : range.every((c) => c[key] === value)
  for (let i = a; i < z; i++) {
    const c = { ...chars[i] } as Record<string, unknown>
    if (all) delete c[key]
    else c[key] = value === undefined ? true : value
    // pt를 정하면 예전 size는 지운다
    if (key === 'pt') delete c.size
    chars[i] = c as Style
  }
  return fromChars(chars)
}

/** [from,to)의 한 서식을 값으로 정한다(undefined·false면 없앤다). 켜고 끄기가 아닌 '그 값으로'. */
export function forceStyle(marks: Mark[] | undefined, len: number, from: number, to: number, key: Key, value: string | number | boolean | undefined): Mark[] {
  const chars = toChars(marks, len)
  for (let i = Math.max(0, from); i < Math.min(len, to); i++) {
    const c = { ...chars[i] } as Record<string, unknown>
    if (value === undefined || value === false) delete c[key]
    else c[key] = value
    if (key === 'pt') delete c.size
    chars[i] = c as Style
  }
  return fromChars(chars)
}

/** 그 자리 글자 서식(모은 서식 막대 표시용): 범위 안 모든 글자에 공통인 것 */
export function styleAt(marks: Mark[] | undefined, len: number, from: number, to: number): Style {
  const chars = toChars(marks, len)
  const a = Math.max(0, Math.min(from, to))
  const z = Math.min(len, Math.max(from, to))
  const range = a < z ? chars.slice(a, z) : [chars[Math.max(0, a - 1)] ?? {}]
  const out: Style = {}
  for (const k of KEYS) if (range.every((c) => c[k] && c[k] === range[0][k])) (out as Record<string, unknown>)[k] = range[0][k]
  return out
}

/**
 * 앞뒤 같은 부분으로 바뀐 구간 찾기: 옛 [p, oldEnd) → 새 [p, newEnd).
 * caret(바꾼 뒤 커서 자리)을 주면 같은 글자가 이어져도(가가, !!, 띄어쓰기 둘) 커서 자리에서 바뀐 것으로 본다.
 */
export function diffRange(oldText: string, newText: string, caret?: number): { p: number; oldEnd: number; newEnd: number } {
  let p = 0
  const max = Math.min(oldText.length, newText.length)
  const limit = caret === undefined ? max : Math.max(0, Math.min(max, caret - Math.max(0, newText.length - oldText.length)))
  while (p < limit && oldText[p] === newText[p]) p++
  let q = 0
  while (q < max - p && oldText[oldText.length - 1 - q] === newText[newText.length - 1 - q]) q++
  return { p, oldEnd: oldText.length - q, newEnd: newText.length - q }
}

/** 글이 바뀌면 서식 위치를 옮긴다. 새로 들어온 글자는 바뀐 자리의 첫 글자(바꿔 쓰기) 또는 바로 앞 글자(넣기)의 서식을 이어받는다. */
export function shiftMarks(marks: Mark[] | undefined, oldText: string, newText: string, caret?: number): Mark[] {
  if (!marks?.length || oldText === newText) return marks ?? []
  const { p, oldEnd, newEnd } = diffRange(oldText, newText, caret)
  const chars = toChars(marks, oldText.length)
  const inherit = oldEnd > p ? chars[p] : p > 0 ? chars[p - 1] : chars[0] ?? {}
  const added = Array.from({ length: newEnd - p }, () => ({ ...inherit }))
  return fromChars([...chars.slice(0, p), ...added, ...chars.slice(oldEnd)])
}

/** 글이 바뀌면 링크 위치를 옮긴다. 링크 안 글이 바뀐 링크는 없앤다(링크 끝에 이어 쓴 글은 링크가 아니다). */
export function shiftLinks(links: NoteLink[] | undefined, oldText: string, newText: string, caret?: number): NoteLink[] {
  if (!links?.length || oldText === newText) return links ?? []
  const { p, oldEnd, newEnd } = diffRange(oldText, newText, caret)
  const d = newEnd - oldEnd
  return links.flatMap((l) => (l.to <= p ? [l] : l.from >= oldEnd ? [{ ...l, from: l.from + d, to: l.to + d }] : []))
}

/** 줄 나누기: at 앞 / 뒤(뒤는 0부터) */
export function splitRanges<T extends { from: number; to: number }>(list: T[] | undefined, at: number): [T[], T[]] {
  const a: T[] = []
  const b: T[] = []
  for (const r of list ?? []) {
    if (r.from < at) a.push({ ...r, to: Math.min(r.to, at) })
    if (r.to > at) b.push({ ...r, from: Math.max(0, r.from - at), to: r.to - at })
  }
  return [a.filter((r) => r.to > r.from), b.filter((r) => r.to > r.from)]
}
/** 링크는 나누는 자리에 걸리면 없앤다 */
export function splitLinks(list: NoteLink[] | undefined, at: number): [NoteLink[], NoteLink[]] {
  const keep = (list ?? []).filter((l) => l.to <= at || l.from >= at)
  return splitRanges(keep, at)
}
/** 줄 합치기: a 뒤에 b(b는 aLen만큼 민다) */
export function joinRanges<T extends { from: number; to: number }>(a: T[] | undefined, aLen: number, b: T[] | undefined): T[] {
  return [...(a ?? []), ...(b ?? []).map((r) => ({ ...r, from: r.from + aLen, to: r.to + aLen }))]
}
export function joinMarks(a: Mark[] | undefined, aText: string, b: Mark[] | undefined, bText: string): Mark[] {
  return fromChars(toChars(joinRanges(a, aText.length, b), aText.length + bText.length))
}

export interface Segment {
  text: string
  from: number
  style: Style
  link?: string
}
/** 그리기용 조각: 서식·링크가 같은 이어진 글자끼리 */
export function segments(text: string, marks?: Mark[], links?: NoteLink[]): Segment[] {
  const chars = toChars(marks, text.length)
  const linkAt: (string | undefined)[] = Array.from({ length: text.length }, () => undefined)
  for (const l of (links ?? []).filter((x) => LINK_ID.test(x.note))) for (let i = Math.max(0, l.from); i < Math.min(text.length, l.to); i++) linkAt[i] = l.note
  const out: Segment[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && same(last.style, chars[i]) && last.link === linkAt[i] && !(linkAt[i] && (links ?? []).some((l) => l.from === i))) last.text += text[i]
    else out.push({ text: text[i], from: i, style: clean(chars[i]), ...(linkAt[i] ? { link: linkAt[i] } : {}) })
  }
  return out
}

/** 글꼴 이름 → CSS font-family(없는 PC는 비슷한 글꼴로) */
export function fontStack(font?: string): string | undefined {
  if (!font) return undefined
  const serif = /바탕|궁서/.test(font)
  return `'${font}', ${serif ? "'Batang', 'Noto Serif KR', serif" : "'Malgun Gothic', 'Noto Sans KR', sans-serif"}`
}
/** 서식 → 인라인 CSS(화면·한글 복사 공용). size: 작게 0.85em, 크게 1.25em */
export function styleCss(s: Style, unit: 'em' | 'pt' = 'em', base = 11): Record<string, string> {
  const css: Record<string, string> = {}
  if (s.b) css['font-weight'] = 'bold'
  const deco = [s.u && 'underline', s.s && 'line-through'].filter(Boolean).join(' ')
  if (deco) css['text-decoration'] = deco
  if (s.i) css['font-style'] = 'italic'
  if (s.color) css.color = s.color
  if (s.bg) css['background-color'] = s.bg
  const f = fontStack(s.font)
  if (f) css['font-family'] = f
  if (s.pt) css['font-size'] = unit === 'em' ? `calc(var(--pt, 1.5px) * ${s.pt})` : `${s.pt}pt`
  else if (s.size) css['font-size'] = unit === 'em' ? (s.size === 'sm' ? '0.85em' : '1.25em') : `${Math.round(base * (s.size === 'sm' ? 0.85 : 1.25))}pt`
  return css
}
