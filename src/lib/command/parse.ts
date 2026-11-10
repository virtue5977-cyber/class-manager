import type { NoteRec, StudentRec, TodoPart } from '../db/types'
import { matchName } from '../hangul'
import { parseDateWords, shortDate } from './dates'
import { CATEGORIES, KINDS, parsePeriod } from './lexicon'

export interface Token {
  kind: 'cmd' | 'student' | 'tag' | 'word'
  text: string
  start: number
  end: number
}

export interface ParseCtx {
  students: StudentRec[]
  notes: NoteRec[]
  today: string
  /** AI에 보낼 때 가릴 이름(전출 학생 포함). 없으면 students의 이름 */
  maskNames?: string[]
}

export interface Parsed {
  cmd: string | null
  sub: string | null
  students: StudentRec[]
  /** 여러 학생이 맞은 @글(실행하지 않고 고르게 함) */
  ambiguous: string[]
  /** 맞는 학생이 없는 @글 */
  missing: string[]
  tags: string[]
  date: string
  /** 날짜 말을 직접 썼는지(할 일 마감일 등) */
  dateGiven: boolean
  /** 올해가 아닌 날짜(미리보기에 연도 표시) */
  otherYear?: boolean
  time: string | null
  kind?: string
  category?: string
  period?: string | null
  /** 알아들은 낱말을 뺀 나머지 글(사유·내용·제목) */
  rest: string
  /** 할 일용: 나머지 글과 @노트·@학생을 제자리에 */
  parts: TodoPart[]
  errors: string[]
}

/** 띄어쓰기로 나눈다. 명령 안의 '_'는 띄어쓰기와 같다(/일정_달력). */
export function tokenize(input: string): Token[] {
  const out: Token[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    const text = m[0]
    if (text.startsWith('/') && text.includes('_')) {
      let s = m.index
      for (const [k, piece] of text.split('_').entries()) {
        if (piece) out.push({ kind: k === 0 ? 'cmd' : 'word', text: piece, start: s, end: s + piece.length })
        s += piece.length + 1
      }
      continue
    }
    const kind = text.startsWith('/') && out.length === 0 ? 'cmd' : text.startsWith('@') ? 'student' : text.startsWith('#') ? 'tag' : 'word'
    out.push({ kind, text, start: m.index, end: m.index + text.length })
  }
  return out
}

/** @글에 맞는 학생: 번호 정확히 → 이름 정확히 → 이름 일부·초성. */
export function findStudents(q: string, students: StudentRec[]): StudentRec[] {
  if (/^\d+$/.test(q)) return students.filter((s) => s.number === Number(q))
  const exact = students.filter((s) => s.name === q)
  if (exact.length) return exact
  return students.filter((s) => matchName(q, s.name))
}

export function parseCommand(input: string, ctx: ParseCtx, names: Record<string, string>, subs: Record<string, string[]> = {}): Parsed {
  const toks = tokenize(input)
  const p: Parsed = { cmd: null, sub: null, students: [], ambiguous: [], missing: [], tags: [], date: ctx.today, dateGiven: false, time: null, rest: '', parts: [], errors: [] }
  let i = 0
  if (toks[0]?.kind === 'cmd') {
    const name = toks[0].text.slice(1)
    p.cmd = names[name] ?? null
    if (!p.cmd) p.errors.push(`'/${name}' 명령을 모릅니다. /를 눌러 고르세요.`)
    i = 1
    if (p.cmd && subs[p.cmd]?.includes(toks[1]?.text ?? '')) {
      p.sub = toks[1].text
      i = 2
    }
  }
  const seq: (string | TodoPart)[] = []
  const restWords: string[] = []
  const words = toks.map((t) => t.text)
  while (i < toks.length) {
    const t = toks[i]
    if (t.kind === 'student') {
      const q = t.text.slice(1)
      // 번호·이름이 정확히 맞는 학생이 있으면 학생이 먼저(같은 이름의 노트가 있어도)
      const exactStudent = ctx.students.some((s) => s.name === q || (/^\d+$/.test(q) && s.number === Number(q)))
      // 그다음 노트 제목(띄어쓰기 포함, 가장 긴 것)
      let noteHit: { note: NoteRec; used: number } | null = null
      if (!exactStudent) for (const n of ctx.notes) {
        if (n.deleted) continue
        const len = n.title.trim().split(/\s+/).length
        if ([q, ...words.slice(i + 1, i + len)].join(' ') === n.title.trim() && (!noteHit || len > noteHit.used)) noteHit = { note: n, used: len }
      }
      if (noteHit) {
        seq.push({ note: noteHit.note.id })
        i += noteHit.used
        continue
      }
      const hits = findStudents(q, ctx.students)
      if (hits.length === 1) {
        p.students.push(hits[0])
        seq.push({ student: hits[0].id })
      } else if (hits.length > 1) p.ambiguous.push(q)
      else if (q) p.missing.push(q)
      i++
      continue
    }
    if (t.kind === 'tag') {
      if (t.text.length > 1) p.tags.push(t.text.slice(1))
      i++
      continue
    }
    // 날짜·시각 말은 앞쪽(사유·내용이 시작되기 전)에서만 읽는다. 할 일·일정은 맨 끝의 날짜 말도 마감일·날짜로.
    const dt = parseDateWords(words, i, ctx.today, p.cmd === 'attendance' || p.cmd === 'counsel' ? 'past' : 'future')
    const isTodo = p.cmd === 'todo' || (p.cmd === 'event' && p.sub === '할일')
    const atEnd = i + dt.used === toks.length
    if (dt.used && (!restWords.length || ((isTodo || p.cmd === 'event') && atEnd))) {
      if (dt.invalid) {
        p.errors.push(`날짜가 올바르지 않습니다: ${dt.invalid}`)
        i += dt.used
        continue
      }
      // 할 일은 시각을 쓰지 않으므로 시각 말은 글로 남긴다.
      const used = isTodo && dt.time ? (dt.dateUsed ?? 0) : dt.used
      if (used) {
        if (dt.date) {
          p.date = dt.date
          p.dateGiven = true
          p.otherYear = dt.date.slice(0, 4) !== ctx.today.slice(0, 4)
        }
        if (dt.time && !isTodo) p.time = dt.time
        i += used
        continue
      }
    }
    const w = t.text
    if (!p.kind && (KINDS as readonly string[]).includes(w)) p.kind = w
    else if (!p.category && w in CATEGORIES) p.category = CATEGORIES[w]
    else if (p.period == null && parsePeriod(w)) p.period = parsePeriod(w)
    else {
      restWords.push(w)
      seq.push(w)
    }
    i++
  }
  p.rest = restWords.join(' ')
  // 조각 사이에 띄어쓰기를 넣고 이웃한 글은 합친다.
  for (const [k, item] of seq.entries()) {
    const piece = k < seq.length - 1 ? [item, ' '] : [item]
    for (const x of piece) {
      const last = p.parts[p.parts.length - 1]
      if (typeof x === 'string' && typeof last === 'string') p.parts[p.parts.length - 1] = last + x
      else p.parts.push(x as TodoPart)
    }
  }
  return p
}

/** 입력하는 동안 막대 아래 한 줄: '출결 · 3번 박도윤 · 11/10(화) · 결석(질병) · 사유: 감기' */
export function describe(p: Parsed, label: (id: string) => string): string {
  const bits: string[] = []
  if (p.cmd) bits.push(label(p.cmd) + (p.sub ? ` ${p.sub}` : ''))
  for (const s of p.students) bits.push(`${s.number}번 ${s.name}`)
  bits.push((p.otherYear ? `${p.date.slice(0, 4)}년 ` : '') + shortDate(p.date) + (p.time ? ` ${p.time}` : ''))
  if (p.kind) bits.push(`${p.kind}${p.period ? ` ${p.period}교시` : ''}${p.category ? `(${p.category})` : ''}`)
  for (const t of p.tags) bits.push(`#${t}`)
  if (p.rest) bits.push(`${p.cmd === 'attendance' ? '사유' : '내용'}: ${p.rest}`)
  return bits.join(' · ')
}
