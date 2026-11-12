import type { AppDB } from '../db/schema'
import { newRecord, save } from '../db/records'
import type { BriefingItem, BriefingRec, NoticeRec } from '../db/types'
import { extractJson, type AiCaller } from '../ai/client'
import { maskText, unmaskText } from '../ai/mask'
import { fillInstruction, getPrompt } from '../ai/prompts'
import { effectiveMask, getSettings } from '../settings'

export type Slot = BriefingRec['slot']
export const SLOTS: Slot[] = ['조례', '종례']

export const BRIEFING_OUTPUT_FORMAT = `# 출력 형식(앱 고정, 반드시 지킬 것)
- 배열 한 칸 = 항목 하나(안내 하나). 딸린 내용은 같은 칸 안에서 줄바꿈(\\n)과 "- "로 잇는다. 말할 순서대로, 해당 없으면 빈 배열.
- 다른 설명 없이 아래 JSON만 출력한다.
{"조례":["문장"],"종례":["문장"]}`

const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`

export function buildBriefingPrompt(instruction: string, raw: string, date: string) {
  return { system: `${fillInstruction(instruction, { 날짜: md(date) })}\n\n${BRIEFING_OUTPUT_FORMAT}`, user: raw.slice(0, 12000) }
}

export async function getBriefing(db: AppDB, date: string, slot: Slot): Promise<BriefingRec | undefined> {
  return (await db.briefings.where('[target_date+slot]').equals([date, slot]).toArray()).find((b) => !b.deleted)
}

/** 항목 목록을 통째로 저장(편집·완료 체크·순서 바꾸기 공용). */
export async function saveBriefingItems(db: AppDB, date: string, slot: Slot, items: BriefingItem[], edited = true): Promise<BriefingRec> {
  const ordered = items.map((it, i) => ({ ...it, order: i }))
  return db.transaction('rw', db.briefings, async () => {
    const cur = await getBriefing(db, date, slot)
    if (cur) return save(db.briefings, { ...cur, items: ordered, edited: cur.edited || edited })
    const rec = newRecord({ target_date: date, slot, items: ordered, edited }) as BriefingRec
    await db.briefings.add(rec)
    return rec
  })
}

/** 붙여넣은 글을 AI로 정리해 그날 조례·종례 목록 뒤에 덧붙인다. 원문은 notices에 남긴다. */
export async function runBriefing(db: AppDB, ai: AiCaller, raw: string, date: string, rosterNames: string[]): Promise<{ 조례: number; 종례: number }> {
  if (!raw.trim()) throw new Error('정리할 글을 붙여넣으세요.')
  const settings = await getSettings(db)
  const m = maskText(raw, effectiveMask(settings) ? rosterNames : [])
  const reply = extractJson<Partial<Record<Slot, string[]>>>(await ai(buildBriefingPrompt(await getPrompt(db, 'briefing'), m.text, date)))
  await db.notices.add(newRecord({ raw_text: raw, source_kind: 'paste', target_date: date }) as NoticeRec)
  const out = { 조례: 0, 종례: 0 }
  for (const slot of SLOTS) {
    const lines = (reply[slot] ?? []).map((t) => unmaskText(String(t).trim(), m.map)).filter(Boolean)
    if (!lines.length) continue
    const cur = (await getBriefing(db, date, slot))?.items ?? []
    await saveBriefingItems(db, date, slot, [...cur, ...lines.map((text) => ({ text, order: 0, done: false }))], false)
    out[slot] = lines.length
  }
  return out
}
