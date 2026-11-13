import { allStudentNames } from '../roster/roster'
import type { AppDB } from '../db/schema'
import type { CounselingLogRec, StudentRec } from '../db/types'
import { extractJson, type AiCaller } from '../ai/client'
import { maskText, unmaskText } from '../ai/mask'
import { fillInstruction, getPrompt } from '../ai/prompts'
import { effectiveMask, getSettings } from '../settings'
import { updateNuga } from './counseling'

/** 앱 고정 출력 형식: 지시문을 어떻게 고쳐도 이 형식이 우선한다. */
export const NUGA_OUTPUT_FORMAT = `# 출력 형식(앱 고정, 반드시 지킬 것)
- 입력은 JSON 배열이며 각 항목에 id, 날짜, 장소, 메모가 있다.
- 각 항목마다 누가기록 내용 문장만 만든다. 머리줄(일자 → 시각 → 장소 → 대상·방법)은 앱이 붙이므로 쓰지 않는다.
- 종류가 관찰이면 교사가 본 행동을 중심으로, 상담이면 나눈 이야기와 지도를 중심으로 쓴다.
- 다른 설명 없이 아래 JSON만 출력한다.
{"items":[{"id":"입력의 id","text":"정리한 내용"}]}`

export const DIAGNOSIS_TERMS = ['ADHD', '우울증', '우울', '자폐', '조울', '불안장애', '틱장애', '경계선', '지적장애', '품행장애', '공황']

export function buildNugaPrompt(instruction: string, items: { id: string; date: string; place: string; memo: string; kind?: string }[], maxChars: number | null) {
  return {
    system: `${fillInstruction(instruction, { 최대글자수: maxChars })}\n\n${NUGA_OUTPUT_FORMAT}${maxChars ? `\n- 항목마다 ${maxChars}자를 넘지 않는다.` : ''}`,
    user: JSON.stringify(items.map((i) => ({ id: i.id, ...(i.kind ? { 종류: i.kind } : {}), 날짜: i.date, 장소: i.place, 메모: i.memo }))),
  }
}

/** 결과 검사(경고만). */
export function checkNuga(text: string, o: { targetName: string; source: string; maxChars: number | null }): string[] {
  const w: string[] = []
  if (o.targetName && text.includes(o.targetName)) w.push(`학생 본인 이름(${o.targetName})이 들어 있습니다.`)
  if (/학생[A-Z]\d*/.test(text)) w.push('가명(학생A 등)이 남아 있습니다.')
  if (/\[(전화|번호)\d*\]/.test(text)) w.push('가린 번호 표시([전화]·[번호])가 남아 있습니다.')
  const terms = DIAGNOSIS_TERMS.filter((t) => text.includes(t))
  if (terms.length) w.push(`진단 용어가 있습니다: ${terms.join(', ')}`)
  if (o.maxChars && text.length > o.maxChars) w.push(`최대 ${o.maxChars}자를 넘었습니다(${text.length}자).`)
  const nums = [...new Set(text.match(/\d+/g) ?? [])].filter((n) => !o.source.includes(n))
  if (nums.length) w.push(`메모에 없는 숫자가 있습니다: ${nums.join(', ')}`)
  return w
}

export interface NugaResult {
  id: string
  text: string
  warnings: string[]
}

/** 한 학생의 기록들을 한 번에 정리해 저장한다. roster는 가릴 이름 목록(학급 전체). */
export async function runNuga(db: AppDB, ai: AiCaller, student: StudentRec, roster: StudentRec[], logs: CounselingLogRec[]): Promise<NugaResult[]> {
  if (!logs.length) return []
  const settings = await getSettings(db)
  const names = effectiveMask(settings) ? [...new Set([...roster.map((s) => s.name), student.name, ...(await allStudentNames(db))])] : []
  let map: Record<string, string> = {}
  // AI에는 앱 안 기록 번호 대신 이 요청 안 순번(1, 2, 3)을 보낸다
  const seq = (i: number) => String(i + 1)
  const items = logs.map((l, i) => {
    const m = maskText(`${l.content}`, names, map)
    map = m.map
    const place = maskText(l.place, names, map)
    map = place.map
    return { id: seq(i), kind: l.kind ?? '상담', date: l.date, place: place.text, memo: m.text }
  })
  const { system, user } = buildNugaPrompt(await getPrompt(db, 'nuga'), items, settings.nuga_max_chars)
  const reply = extractJson<{ items?: { id: string; text: string }[] }>(await ai({ system, user, maxTokens: 1500 + logs.length * 400 }))
  const got = new Map((reply.items ?? []).map((i) => [i.id, String(i.text ?? '').trim()]))
  const out: NugaResult[] = []
  for (const [i, l] of logs.entries()) {
    const raw = got.get(seq(i))
    if (!raw) {
      out.push({ id: l.id, text: '', warnings: ['AI가 이 기록을 정리하지 않았습니다. 다시 시도하세요.'] })
      continue
    }
    const text = unmaskText(raw, map)
    await updateNuga(db, l.id, { nuga_text: text, nuga_status: '정리됨' })
    out.push({ id: l.id, text, warnings: checkNuga(text, { targetName: student.name, source: `${l.content} ${l.date} ${l.place}`, maxChars: settings.nuga_max_chars }) })
  }
  return out
}
