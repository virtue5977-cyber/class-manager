import { allStudentNames } from '../roster/roster'
import type { AppDB } from '../db/schema'
import type { AiCaller } from '../ai/client'
import { extractJson } from '../ai/client'
import { maskText, unmaskText } from '../ai/mask'
import { getPrompt } from '../ai/prompts'
import { buildBriefingPrompt } from '../briefing/briefing'
import { effectiveMask, getSettings } from '../settings'

/** 붙여 넣은 글을 전달사항 줄들로(AI, 이름 가림). AI가 꺼져 있으면 오류. */
export async function splitNoticesByAi(db: AppDB, ai: AiCaller | undefined, raw: string, date: string, names: string[]): Promise<string[]> {
  if (!raw.trim()) throw new Error('나눌 글을 붙여 넣으세요.')
  const s = await getSettings(db)
  if (!s.ai_enabled || !ai) throw new Error('AI가 꺼져 있습니다. 설정 > AI에서 켜세요.')
  const m = maskText(raw, effectiveMask(s) ? [...new Set([...names, ...(await allStudentNames(db))])] : [])
  const reply = extractJson<Record<string, string[]>>(await ai(buildBriefingPrompt(await getPrompt(db, 'briefing'), m.text, date)))
  return Object.values(reply).flat().map((t) => unmaskText(String(t).trim(), m.map)).filter(Boolean)
}
