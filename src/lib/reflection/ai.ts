import type { AppDB } from '../db/schema'
import { extractJson, type AiCaller } from '../ai/client'
import { maskText, unmaskText } from '../ai/mask'
import { getPrompt } from '../ai/prompts'
import { getSettings } from '../settings'

/** 사유로 반성문 16줄 만들기(AI). 학생 이름·학번은 보내지 않는다(사유 안의 이름도 가림). */
export async function fillByAi(db: AppDB, ai: AiCaller | undefined, reason: string, names: string[]): Promise<string[]> {
  if (!reason.trim()) throw new Error('사유를 먼저 쓰세요.')
  const s = await getSettings(db)
  if (!s.ai_enabled || !ai) throw new Error('AI가 꺼져 있습니다. 설정 > AI에서 켜세요.')
  const m = maskText(reason, names)
  const reply = extractJson<{ lines?: unknown[] }>(
    await ai({ system: `${await getPrompt(db, 'reflection')}\n\n# 출력 형식\nJSON {"lines": ["문장", … 16개]} 만. 번호는 붙이지 않는다.`, user: `사유: ${m.text}`, maxTokens: 2000 }),
  )
  const lines = (reply.lines ?? []).map((l) => unmaskText(String(l).replace(/^\s*\d{1,2}\s*[.)]\s*/, '').trim(), m.map)).filter(Boolean)
  if (lines.length !== 16) throw new Error('16줄을 받지 못했습니다. 다시 시도하세요.')
  return lines
}
