/** ! AI 스킬: 이름·하위, 읽기, 자동완성, 추천 정리. 실행은 ai.ts(runSkill). */
export interface Skill {
  id: string
  help: string
  subs?: string[]
}
export const SKILLS: Skill[] = [
  { id: '전달', help: '!전달 학생|교사|학부모 글 — 받는 사람에 맞게 고쳐 쓰기(학생은 전달사항으로)', subs: ['학생', '교사', '학부모'] },
  { id: '일정', help: '!일정 글 — 글에서 일정을 뽑아 추천(고쳐서 넣기)' },
  { id: '할일', help: '!할일 글 — 글에서 할 일을 뽑아 추천(고쳐서 넣기)' },
  { id: '나누기', help: '!나누기 공문 — 전달사항으로 나눠 추천(안내 하나 = 하나)' },
  { id: '요약', help: '!요약 글 — 요점만' },
  { id: '누가', help: '!누가 관찰 메모 — 누가기록 문체로' },
  { id: '상담정리', help: '!상담정리 @학생 — 미정리 상담을 누가기록 초안으로' },
]

export interface ParsedSkill {
  skill: string // SKILLS id 또는 'auto'
  sub?: string
  body: string
}

/** '!' 다음 첫 낱말이 스킬 이름이면 그 스킬, 아니면 auto(글 전체를 보고 추천) */
export function parseSkill(input: string): ParsedSkill {
  const t = input.replace(/^\s*!/, '')
  const m = /^(\S+)([\s\S]*)$/.exec(t.trimStart())
  const sk = m && SKILLS.find((s) => s.id === m[1])
  if (!sk || t.match(/^\s/)) return { skill: 'auto', sub: undefined, body: t.trim() }
  let rest = m![2]
  let sub: string | undefined
  const s2 = /^\s+(\S+)/.exec(rest)
  if (sk.subs && s2 && sk.subs.includes(s2[1])) {
    sub = s2[1]
    rest = rest.slice(s2[0].length)
  }
  return { skill: sk.id, sub, body: rest.trim() }
}

/** 자동완성: '!'·'!전' → 스킬, '!전달 ' → 하위 */
export function skillSuggestions(input: string): { label: string; insert: string; detail: string }[] {
  const m = /^!(\S*)(\s*)(\S*)$/.exec(input)
  if (!m) return []
  const [, name, sp, sub] = m
  if (!sp) return SKILLS.filter((s) => s.id.startsWith(name)).map((s) => ({ label: `!${s.id}`, insert: `!${s.id} `, detail: s.help }))
  const sk = SKILLS.find((s) => s.id === name)
  if (!sk?.subs) return []
  return sk.subs.filter((x) => x.startsWith(sub)).filter((x) => x !== sub).map((x) => ({ label: `!${sk.id} ${x}`, insert: `!${sk.id} ${x} `, detail: sk.help }))
}

/** 고칠 수 있는 추천 한 줄 */
export interface Suggestion {
  kind: 'notice' | 'event' | 'todo'
  text: string
  /** 전달사항: 날짜, 일정: 날짜, 할 일: 마감일('' = 없음) */
  date: string
  time?: string
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
/** AI 답(JSON)을 추천 목록으로: 형식이 틀린 날짜·시간은 비우거나 오늘로, 빈 글은 버린다. 종류마다 5개까지. */
export function normalizeSuggestions(
  r: { notices?: unknown[]; events?: unknown[]; todos?: unknown[] },
  today: string,
): Suggestion[] {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const time = (v: unknown) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(str(v))
    return m && +m[1] < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
  }
  const out: Suggestion[] = []
  for (const n of (r.notices ?? []).slice(0, 5)) if (str(n)) out.push({ kind: 'notice', text: str(n), date: today })
  for (const e of (r.events ?? []).slice(0, 5)) {
    const o = (e ?? {}) as Record<string, unknown>
    if (str(o.title)) out.push({ kind: 'event', text: str(o.title), date: YMD.test(str(o.date)) ? str(o.date) : today, time: time(o.time) })
  }
  for (const t of (r.todos ?? []).slice(0, 5)) {
    const o = (t ?? {}) as Record<string, unknown>
    if (str(o.text)) out.push({ kind: 'todo', text: str(o.text), date: YMD.test(str(o.due)) ? str(o.due) : '' })
  }
  return out
}
