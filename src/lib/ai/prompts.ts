import type { AppDB } from '../db/schema'
import { newRecord, save } from '../db/records'
import type { AiPromptRec } from '../db/types'
import { DEFAULT_BRIEFING_INSTRUCTION, DEFAULT_NUGA_INSTRUCTION } from './defaults'

export type PromptKind = AiPromptRec['kind']
export const DEFAULT_PROMPTS: Record<PromptKind, string> = { nuga: DEFAULT_NUGA_INSTRUCTION, briefing: DEFAULT_BRIEFING_INSTRUCTION }
/** 현재 것 외에 남기는 이전 버전 수 */
export const KEEP_OLD_VERSIONS = 5

export async function listPromptVersions(db: AppDB, kind: PromptKind): Promise<AiPromptRec[]> {
  return (await db.ai_prompts.where('kind').equals(kind).toArray()).filter((p) => !p.deleted).sort((a, b) => b.version - a.version)
}

export async function getPrompt(db: AppDB, kind: PromptKind): Promise<string> {
  return (await listPromptVersions(db, kind)).find((p) => p.active)?.instruction ?? DEFAULT_PROMPTS[kind]
}

/** 새 버전으로 저장·활성화하고 오래된 버전은 지운다. 같은 내용이면 그대로 둔다. */
export async function savePrompt(db: AppDB, kind: PromptKind, instruction: string): Promise<void> {
  await db.transaction('rw', db.ai_prompts, async () => {
    const all = await listPromptVersions(db, kind)
    const active = all.find((p) => p.active)
    if ((active?.instruction ?? DEFAULT_PROMPTS[kind]) === instruction) return
    if (active) await save(db.ai_prompts, { ...active, active: false })
    await db.ai_prompts.add(newRecord({ kind, instruction, version: (all[0]?.version ?? 0) + 1, active: true }) as AiPromptRec)
    for (const old of all.slice(KEEP_OLD_VERSIONS)) await save(db.ai_prompts, { ...old, active: false, deleted: true })
  })
}

export const resetPrompt = (db: AppDB, kind: PromptKind) => savePrompt(db, kind, DEFAULT_PROMPTS[kind])

/** 지시문 안의 {최대글자수}, {날짜}를 채운다. */
export function fillInstruction(text: string, vars: { 최대글자수?: number | null; 날짜?: string }): string {
  return text.replace(/\{최대글자수\}/g, vars.최대글자수 ? String(vars.최대글자수) : '제한 없음').replace(/\{날짜\}/g, vars.날짜 ?? '')
}
