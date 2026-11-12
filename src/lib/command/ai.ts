import { allStudentNames } from '../roster/roster'
import { extractJson } from '../ai/client'
import { maskText, unmaskText } from '../ai/mask'
import { getPrompt } from '../ai/prompts'
import { listLogsByStudent, updateNuga } from '../counseling/counseling'
import { runNuga } from '../counseling/nuga'
import { effectiveMask, getSettings } from '../settings'
import type { RunEnv, RunResult } from './handlers'
import { describe, parseCommand, type ParseCtx } from './parse'
import { COMMAND_META, commandLabel, commandNames, commandSubs } from './registry'
import { parseSkill } from './skills'
import { appContext, runSkillAi } from './skillRun'

const AI_OFF: RunResult = { summary: 'AI가 꺼져 있습니다. 설정 > AI에서 연결 방식을 고르고 켜세요.', links: [{ label: '설정 > AI', to: '/settings?tab=ai' }], failed: true }

/** 긴 붙여넣기: 세 줄 이상이거나 200자 이상 */
export const isLongPaste = (t: string) => t.split(/\n/).filter((l) => l.trim()).length >= 3 || t.length >= 200

async function aiReady(env: RunEnv) {
  const s = await getSettings(env.db)
  return s.ai_enabled && env.ai ? s : null
}

/** 규칙으로 안 되는 입력을 AI로. 맡을 입력이 아니면 null(규칙 실행으로 넘김). AI는 저장을 하지 않거나(초안·확인), 되돌릴 수 있게만 한다. */
export async function aiFallback(input: string, ctx: ParseCtx, env: RunEnv): Promise<RunResult | null> {
  // ! 스킬: 전달·상담정리는 아래 옛 길(/전달 …·/상담정리)로 바꿔 처리하고, 나머지는 skillRun
  const bang = input.trim().startsWith('!') ? parseSkill(input) : null
  if (bang?.skill === '전달') {
    if (!bang.sub) return { summary: '받는 사람을 고르세요: !전달 학생 · !전달 교사 · !전달 학부모', links: [], pending: true }
    if (!bang.body) return { summary: `!전달 ${bang.sub} 뒤에 전할 내용을 쓰세요.`, links: [], pending: true }
    input = `/전달 ${bang.sub} ${bang.body}`
  } else if (bang?.skill === '상담정리') input = `/상담정리 ${bang.body}`
  const p = parseCommand(input, ctx, commandNames(), commandSubs())
  const isMessage = p.cmd === 'notice' && (p.sub === '학부모' || p.sub === '교사')
  // /전달 학생 …: AI가 학생에게 맞게 고쳐 전달사항으로. AI가 꺼져 있으면 규칙(글 그대로)
  const isStudentNotice = p.cmd === 'notice' && p.sub === '학생' && !!p.rest
  if (p.cmd && p.cmd !== 'counselDraft' && !isMessage && !isStudentNotice) return null
  if (!p.cmd && input.startsWith('/')) return null
  const s = await aiReady(env)
  if (!s) return isStudentNotice && !bang ? null : AI_OFF
  const names = effectiveMask(s) ? [...new Set([...(ctx.maskNames ?? ctx.students.map((x) => x.name)), ...(await allStudentNames(env.db))])] : []
  // ! 스킬과 질문은 설정과 상관없이 이름을 늘 가린다(설계서 10 §1)
  const allNames = [...new Set([...(ctx.maskNames ?? ctx.students.map((x) => x.name)), ...(await allStudentNames(env.db))])]
  // 나머지 ! 스킬(일정·할일·나누기·요약·누가·추천)
  if (bang && bang.skill !== '전달' && bang.skill !== '상담정리') return runSkillAi(input, env as never, allNames)
  // 옛 쓰임 안내: /전달 학생|교사|학부모, /상담정리 → 이제는 !
  const hint = !bang && (isMessage || isStudentNotice || p.cmd === 'counselDraft') ? ` (이제는 !${p.cmd === 'counselDraft' ? '상담정리' : `전달 ${p.sub}`})` : ''

  if (p.cmd === 'counselDraft') {
    if (p.students.length !== 1) return { summary: '학생을 @로 한 명 고르세요.', links: [], pending: true }
    const st = p.students[0]
    const logs = (await listLogsByStudent(env.db, st.id)).filter((l) => l.nuga_status === '미정리')
    if (!logs.length) return { summary: `${st.number}번 ${st.name}: 정리할 기록이 없습니다.`, links: [{ label: '상담일지', to: `/counseling?sid=${st.id}` }] }
    const before = logs.map((l) => ({ id: l.id, nuga_text: l.nuga_text, nuga_status: l.nuga_status }))
    const res = await runNuga(env.db, env.ai!, st, ctx.students, logs)
    const ok = res.filter((r) => r.text).length
    return {
      summary: `${st.number}번 ${st.name} 누가기록 ${ok}건 정리${res.some((r) => r.warnings.length) ? ' · 확인할 점 있음' : ''}${hint}`,
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
    return { summary: `학생에게 알릴 글 — 고쳐서 넣으세요.${hint}`, links: [], card: { kind: 'suggest', data: { items: [{ kind: 'notice', text, date: p.date }] } }, pending: true }
  }

  if (isMessage) {
    const who = p.students.map((x) => `${x.name} ${p.sub === '학부모' ? '보호자' : ''}`.trim()).join(', ')
    const m = maskText(`받는 사람: ${who || p.sub}\n날짜: ${p.date}\n전할 내용: ${p.rest}`, names)
    const reply = extractJson<{ text?: string }>(await env.ai!({ system: `${await getPrompt(env.db, 'message')}\n\n# 출력 형식\nJSON {"text": "보낼 글"} 만.`, user: m.text, maxTokens: 600 }))
    const text = unmaskText(String(reply.text ?? '').trim(), m.map)
    return { summary: `${p.sub}께 보낼 글 초안${hint}`, links: [], card: { kind: 'draft', data: { kind: 'message', text } } }
  }

  // 긴 붙여넣기 → ! 와 같이 추천 카드
  if (isLongPaste(input)) return runSkillAi(`! ${input}`, env as never, allNames)

  // 짧은 글 → 질문이면 앱 자료로 대답, 할 일이면 명령 제안(AI 한 번)
  const list = COMMAND_META.map((c) => `- ${c.help}`).join('\n')
  // 질문과 앱 자료는 같은 가명 표로(같은 학생 = 같은 가명, 다른 학생 = 다른 가명)
  const m = maskText(input, allNames)
  const data = maskText(await appContext(env, p.students.map((x) => x.id)), allNames, m.map)
  const reply = extractJson<{ command?: string; answer?: string }>(
    await env.ai!({
      system: `${await getPrompt(env.db, 'command')}\n- 글이 앱에 기록·실행할 일이면 command에 명령 한 줄을 쓴다.\n- 글이 질문이면 answer에 아래 '앱 자료'만 보고 짧게(3문장 안팎) 답한다. 자료에 없는 것은 모른다고 하고 지어내지 않는다. 앱 자료와 상관없는 일반 질문이면 answer에 "앱 자료와 상관없는 질문은 Claude 앱에서 물어보세요."라고만 쓴다.\n\n# 명령 목록\n${list}\n\n# 앱 자료\n${data.text}\n\n# 출력 형식\nJSON {"command": "/..."} 또는 {"answer": "..."} 하나만.`,
      user: m.text,
      maxTokens: 600,
    }),
  )
  const answer = unmaskText(String(reply.answer ?? '').trim(), data.map)
  if (answer) return { summary: answer, links: [] }
  const command = unmaskText(String(reply.command ?? '').trim(), data.map)
  if (!command.startsWith('/')) return { summary: '알맞은 명령을 찾지 못했습니다. /는 기록, !는 AI 글, 질문은 그냥 쓰세요.', links: [], pending: true }
  const parsed = parseCommand(command, ctx, commandNames(), commandSubs())
  return { summary: '이렇게 실행할까요?', links: [], card: { kind: 'confirm', data: { command, preview: describe(parsed, commandLabel) } }, pending: true }
}
