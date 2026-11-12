import { SKILLS } from './skills'
import { choseong } from '../hangul'
import { findStudents, parseCommand, type ParseCtx } from './parse'
import { commandNames, commandSubs, type CommandMeta } from './registry'

export interface Suggestion {
  label: string
  insert: string
  kind: 'cmd' | 'sub' | 'student' | 'note' | 'tag' | 'word'
  detail?: string
}

const MAX = 8

/** @ 뒤: 학생(번호 이름)과 노트 제목 */
function atSuggest(q: string, ctx: ParseCtx): Suggestion[] {
  const studs = (q ? findStudents(q, ctx.students) : ctx.students).filter((s) => !s.deleted && s.active !== false)
  const out: Suggestion[] = studs.map((s) => ({
    label: `${s.number}번 ${s.name}`,
    insert: ctx.students.filter((x) => x.name === s.name).length === 1 ? `@${s.name}` : `@${s.number}`,
    kind: 'student' as const,
  }))
  for (const n of ctx.notes)
    if (!n.deleted && n.title.trim() && (!q || n.title.includes(q))) out.push({ label: n.title, insert: `@${n.title.trim()}`, kind: 'note', detail: '노트' })
  return out.slice(0, MAX)
}

function tokenAt(input: string, caret: number): { start: number; text: string } {
  let start = caret
  while (start > 0 && !/\s/.test(input[start - 1])) start--
  return { start, text: input.slice(start, caret) }
}

export function suggest(input: string, caret: number, ctx: ParseCtx & { commands: CommandMeta[] }): Suggestion[] {
  const { start, text } = tokenAt(input, caret)
  const before = input.slice(0, start)
  const isFirst = !before.trim()
  // ! 스킬: 처음 낱말 → 스킬, 둘째 낱말 → 하위(받는 사람)
  if (isFirst && text.startsWith('!')) {
    const q = text.slice(1)
    return SKILLS.filter((k) => k.id.startsWith(q) || (q && choseong(k.id).startsWith(q))).map((k) => ({ label: `!${k.id}`, insert: `!${k.id}`, kind: 'cmd' as const, detail: k.help }))
  }
  const sk = /^!(\S+)\s+$/.exec(before) && SKILLS.find((k) => k.id === /^!(\S+)/.exec(before)![1])
  if (sk && sk.subs) return sk.subs.filter((x) => x.startsWith(text) && x !== text).map((x) => ({ label: x, insert: x, kind: 'sub' as const, detail: sk.help }))
  if (before.trimStart().startsWith('!')) return text.startsWith('@') ? atSuggest(text.slice(1), ctx) : []
  // 명령
  if (isFirst && text.startsWith('/')) {
    const q = text.slice(1)
    const out: Suggestion[] = []
    for (const c of ctx.commands)
      for (const n of c.names)
        if (n.startsWith(q) || (q && choseong(n).startsWith(q))) {
          out.push({ label: `/${n}`, insert: `/${n}`, kind: 'cmd', detail: c.help })
          break
        }
    return out.slice(0, MAX)
  }
  const parsed = parseCommand(before, ctx, commandNames(ctx.commands), commandSubs(ctx.commands))
  const cmd = ctx.commands.find((c) => c.id === parsed.cmd)
  // 학생·노트
  if (text.startsWith('@')) return atSuggest(text.slice(1), ctx)
  if (!cmd) return []
  // 태그
  if (text.startsWith('#'))
    return (cmd.tags ?? []).filter((t) => t.startsWith(text.slice(1))).map((t) => ({ label: `#${t}`, insert: `#${t}`, kind: 'tag' as const }))
  // 세부 명령(명령 바로 다음 낱말)
  const words = before.trim().split(/\s+/)
  if (cmd.subs && words.length === 1 && !parsed.sub)
    return cmd.subs.filter((s) => s.startsWith(text)).map((s) => ({ label: s, insert: s, kind: 'sub' as const }))
  return (cmd.expects?.(parsed) ?? []).filter((w) => w.startsWith(text)).slice(0, MAX).map((w) => ({ label: w, insert: w, kind: 'word' as const }))
}

/** 커서가 있는 토큰을 후보로 바꾸고 뒤에 띄어쓰기 하나(이미 있으면 그 뒤로). */
export function applySuggestion(input: string, caret: number, s: Suggestion): { value: string; caret: number } {
  const { start } = tokenAt(input, caret)
  let end = caret
  while (end < input.length && !/\s/.test(input[end])) end++
  const after = input.slice(end)
  if (/^\s/.test(after)) {
    const value = input.slice(0, start) + s.insert + after
    return { value, caret: start + s.insert.length + 1 }
  }
  const value = input.slice(0, start) + s.insert + ' ' + after
  return { value, caret: start + s.insert.length + 1 }
}
