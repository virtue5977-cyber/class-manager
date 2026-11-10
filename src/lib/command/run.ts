import type { ChatRec } from '../db/types'
import { appendChat } from './chatLog'
import { HANDLERS, type RunEnv, type RunResult } from './handlers'
import { parseCommand, type ParseCtx, type Parsed } from './parse'
import { COMMAND_META, commandNames, commandSubs } from './registry'

export type { RunEnv, RunResult } from './handlers'

export interface Executed {
  chat: ChatRec
  result?: RunResult
  parsed: Parsed
}

/** 10초(기본) 안에 한 번만 되돌릴 수 있는 함수 */
export function makeUndo(fn: () => Promise<void>, ms = 10_000, now: () => number = Date.now): { undo(): Promise<boolean>; expiresAt: number } {
  const expiresAt = now() + ms
  let used = false
  return {
    expiresAt,
    async undo() {
      if (used || now() > expiresAt) return false
      used = true
      await fn()
      return true
    },
  }
}

/** 입력 한 줄을 해석·실행하고 대화 기록에 남긴다. AI가 필요한 입력은 aiFallback이 맡는다(없으면 안내). */
export async function executeInput(
  input: string,
  ctx: ParseCtx,
  env: RunEnv,
  aiFallback?: (input: string, ctx: ParseCtx, env: RunEnv) => Promise<RunResult | null>,
): Promise<Executed> {
  const text = input.trim()
  const parsed = parseCommand(text, ctx, commandNames(), commandSubs())
  const meta = COMMAND_META.find((c) => c.id === parsed.cmd)
  const mode = meta?.mode === 'ai' ? 'ai' : meta?.mode === 'hybrid' ? 'hybrid' : 'rule'
  const log = (status: ChatRec['status'], summary: string, result?: RunResult, detail?: string, m: ChatRec['mode'] = mode) =>
    appendChat(env.db, { input: text, mode: m, summary, links: result?.links ?? [], status, ...(detail ? { detail } : {}) }).then((chat) => ({ chat, result, parsed }))

  try {
    if (aiFallback && (!parsed.cmd || meta?.mode !== 'rule')) {
      const r = await aiFallback(text, ctx, env)
      if (r) return log(r.failed ? '실패' : r.pending ? '확인 필요' : '성공', r.summary, r, undefined, meta?.mode === 'hybrid' ? 'hybrid' : 'ai')
    }
    if (!parsed.cmd) return log('확인 필요', parsed.errors[0] ?? '명령은 /로 시작합니다. /를 눌러 고르세요.')
    if (parsed.ambiguous.length) return log('확인 필요', `'${parsed.ambiguous[0]}'에 맞는 학생이 여럿입니다. @를 눌러 고르세요.`)
    if (parsed.missing.length) return log('확인 필요', `'${parsed.missing[0]}' 학생을 찾지 못했습니다. @를 눌러 고르세요.`)
    const h = HANDLERS[parsed.cmd]
    if (!h) return log('확인 필요', 'AI 연결이 필요한 명령입니다. 설정 > AI를 확인하세요.', { summary: '', links: [{ label: '설정 > AI', to: '/settings?tab=ai' }] })
    const need = h.needs?.(parsed)
    if (need) return log('확인 필요', need.message, { summary: need.message, links: [], form: need.form, pending: true })
    const r = await h.run(parsed, ctx, env)
    return log(r.pending ? '확인 필요' : '성공', r.summary, r)
  } catch (e) {
    return log('실패', e instanceof Error ? e.message : String(e))
  }
}
