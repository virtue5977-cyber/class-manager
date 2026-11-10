import { allStudentNames } from '../roster/roster'
import { extractJson } from '../ai/client'
import { maskText, unmaskText } from '../ai/mask'
import { getPrompt } from '../ai/prompts'
import { buildBriefingPrompt } from '../briefing/briefing'
import { listLogsByStudent, updateNuga } from '../counseling/counseling'
import { runNuga } from '../counseling/nuga'
import { addNotice, deleteNotice } from '../notices/notices'
import { effectiveMask, getSettings } from '../settings'
import type { RunEnv, RunResult } from './handlers'
import { describe, parseCommand, type ParseCtx } from './parse'
import { COMMAND_META, commandLabel, commandNames, commandSubs } from './registry'

const AI_OFF: RunResult = { summary: 'AI가 꺼져 있습니다. 설정 > AI에서 연결 방식을 고르고 켜세요.', links: [{ label: '설정 > AI', to: '/settings?tab=ai' }], failed: true }

/** 긴 붙여넣기: 세 줄 이상이거나 200자 이상 */
export const isLongPaste = (t: string) => t.split(/\n/).filter((l) => l.trim()).length >= 3 || t.length >= 200

async function aiReady(env: RunEnv) {
  const s = await getSettings(env.db)
  return s.ai_enabled && env.ai ? s : null
}

/** 규칙으로 안 되는 입력을 AI로. 맡을 입력이 아니면 null(규칙 실행으로 넘김). AI는 저장을 하지 않거나(초안·확인), 되돌릴 수 있게만 한다. */
export async function aiFallback(input: string, ctx: ParseCtx, env: RunEnv): Promise<RunResult | null> {
  const p = parseCommand(input, ctx, commandNames(), commandSubs())
  const isMessage = p.cmd === 'notice' && (p.sub === '학부모' || p.sub === '교사')
  // /전달 학생 …: AI가 학생에게 맞게 고쳐 전달사항으로. AI가 꺼져 있으면 규칙(글 그대로)
  const isStudentNotice = p.cmd === 'notice' && p.sub === '학생' && !!p.rest
  if (p.cmd && p.cmd !== 'counselDraft' && !isMessage && !isStudentNotice) return null
  if (!p.cmd && input.startsWith('/')) return null
  const s = await aiReady(env)
  if (!s) return isStudentNotice ? null : AI_OFF
  const names = effectiveMask(s) ? [...new Set([...(ctx.maskNames ?? ctx.students.map((x) => x.name)), ...(await allStudentNames(env.db))])] : []

  if (p.cmd === 'counselDraft') {
    if (p.students.length !== 1) return { summary: '학생을 @로 한 명 고르세요.', links: [], pending: true }
    const st = p.students[0]
    const logs = (await listLogsByStudent(env.db, st.id)).filter((l) => l.nuga_status === '미정리')
    if (!logs.length) return { summary: `${st.number}번 ${st.name}: 정리할 기록이 없습니다.`, links: [{ label: '상담일지', to: `/counseling?sid=${st.id}` }] }
    const before = logs.map((l) => ({ id: l.id, nuga_text: l.nuga_text, nuga_status: l.nuga_status }))
    const res = await runNuga(env.db, env.ai!, st, ctx.students, logs)
    const ok = res.filter((r) => r.text).length
    return {
      summary: `${st.number}번 ${st.name} 누가기록 ${ok}건 정리${res.some((r) => r.warnings.length) ? ' · 확인할 점 있음' : ''}`,
      links: [{ label: '상담일지', to: `/counseling?sid=${st.id}` }],
      undo: async () => {
        for (const b of before) await updateNuga(env.db, b.id, { nuga_text: b.nuga_text, nuga_status: b.nuga_status })
      },
    }
  }

  if (isStudentNotice) {
    const m = maskText(p.rest, names)
    const reply = extractJson<{ text?: string }>(
      await env.ai!({
        system:
          '담임이 학생들에게 알릴 전달사항을 학생이 바로 알아듣게 고쳐 쓴다. 한두 문장, 해야 할 일·때·준비물을 분명히, "~하세요" 꼴의 존댓말. 없는 내용을 지어내지 않는다. 학생A 같은 가명은 그대로 둔다.\n\n# 출력 형식\nJSON {"text": "전달사항"} 만.',
        user: `대상: 학생\n날짜: ${p.date}\n원래 글: ${m.text}`,
        maxTokens: 400,
      }),
    )
    const text = unmaskText(String(reply.text ?? '').trim(), m.map) || p.rest
    const rec = await addNotice(env.db, { text, start_date: p.date })
    return { summary: `학생용으로 고쳐 전달사항 추가 · ${text}`, links: [{ label: '전달사항 보기', to: '/?tab=notice' }], undo: async () => void (await deleteNotice(env.db, rec.id)) }
  }

  if (isMessage) {
    const who = p.students.map((x) => `${x.name} ${p.sub === '학부모' ? '보호자' : ''}`.trim()).join(', ')
    const m = maskText(`받는 사람: ${who || p.sub}\n날짜: ${p.date}\n전할 내용: ${p.rest}`, names)
    const reply = extractJson<{ text?: string }>(await env.ai!({ system: `${await getPrompt(env.db, 'message')}\n\n# 출력 형식\nJSON {"text": "보낼 글"} 만.`, user: m.text, maxTokens: 600 }))
    const text = unmaskText(String(reply.text ?? '').trim(), m.map)
    return { summary: `${p.sub}께 보낼 글 초안`, links: [], card: { kind: 'draft', data: { kind: 'message', text } } }
  }

  if (isLongPaste(input)) {
    const m = maskText(input, names)
    const reply = extractJson<Record<string, string[]>>(await env.ai!(buildBriefingPrompt(await getPrompt(env.db, 'briefing'), m.text, env.today)))
    const items = Object.values(reply).flat().map((t) => unmaskText(String(t).trim(), m.map)).filter(Boolean)
    return { summary: `전달사항 ${items.length}개로 나눴습니다. 넣을 것을 고르세요.`, links: [], card: { kind: 'draft', data: { kind: 'notices', items } }, pending: true }
  }

  // 짧은 문장 → 명령 한 줄
  const list = COMMAND_META.map((c) => `- ${c.help}`).join('\n')
  const m = maskText(input, names)
  const reply = extractJson<{ command?: string }>(await env.ai!({ system: `${await getPrompt(env.db, 'command')}\n\n# 명령 목록\n${list}\n\n# 출력 형식\nJSON {"command": "/..."} 만.`, user: m.text, maxTokens: 300 }))
  const command = unmaskText(String(reply.command ?? '').trim(), m.map)
  if (!command.startsWith('/')) return { summary: '알맞은 명령을 찾지 못했습니다. /를 눌러 고르세요.', links: [], pending: true }
  const parsed = parseCommand(command, ctx, commandNames(), commandSubs())
  return { summary: '이렇게 실행할까요?', links: [], card: { kind: 'confirm', data: { command, preview: describe(parsed, commandLabel) } }, pending: true }
}
