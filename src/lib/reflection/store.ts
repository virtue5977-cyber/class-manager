import type { AppDB } from '../db/schema'
import type { ReflectionPhraseRec, ReflectionRec, BaseRecord } from '../db/types'
import { newRecord, scrubDelete, softDelete } from '../db/records'

/** 반성문 양식 기본 16문장(보내 주신 생성기 그대로) */
export const DEFAULT_LINES: string[] = [
 "감정을 통제하지 못하고 타인의 기분을 상하게 하는 것은 결코 자랑거리가 될 수 없습니다. 이는 자신의 미숙함을 드러내는 것입니다.",
 "순간의 기분에 휩쓸려 섣불리 행동하는 것은 스스로의 인격을 깎아내리고 깊은 후회를 남길 수 있습니다.",
 "우리는 각자 다르며, 나의 좋고 싫음의 기준을 타인에게 억지로 강요하는 것은 폭력이 될 수 있습니다.",
 "무심코 내뱉은 거친 말과 무례한 태도는 타인과의 소통을 단절시키고 마음에 깊은 흉터를 남길 수 있습니다.",
 "나의 가벼운 언행이 남긴 상처는 시간이 흘러 아무리 후회하더라도 예전처럼 온전히 돌이킬 수 없는 법입니다.",
 "나를 가장 아끼고 위하는 사람들에게 감정을 앞세워 투정을 부리는 것은 그들의 마음에 큰 상처를 입힙니다.",
 "혼자 살아갈 수 없는 세상에서 타인의 마음을 깊이 헤아리지 못하는 것은 결국 고립을 자초할 수 있습니다.",
 "공동체 안에서 정해진 규칙을 가볍게 여기는 것은 우리 모두의 안전과 평화를 크게 위협할 수 있습니다.",
 "나 하나의 이익을 위해 질서를 무시하는 것은 모두가 함께 평화롭게 공존하기 위한 약속을 깨는 행동입니다.",
 "내게 주어진 자유로운 선택의 이면에는 그로 인해 발생할 결과에 대한 무거운 책임이 따를 수 있습니다.",
 "행동하기 전에 먼저 생각하지 않는 무책임한 습관은 결국 스스로의 밝은 미래와 삶의 방향을 망칠 수 있습니다.",
 "지나간 잘못을 단순한 핑계로 덮으려 하는 것은 스스로의 성장을 가로막고 더 큰 실수를 불러올 수 있습니다.",
 "이제는 타인과 나의 다름을 존중하고, 상대방의 입장에서 한 번 더 배려하는 따뜻한 마음을 잃지 않겠습니다.",
 "우리 모두를 지켜주는 공동체의 규칙을 준수하며, 긍정적인 관계를 맺는 성숙한 사람으로 거듭나겠습니다.",
 "매 순간 나의 언행이 미칠 영향을 헤아리며, 바른 언어와 예절로 주변과 굳건한 신뢰를 쌓아가겠습니다.",
 "어제보다 단단해진 내면으로 내 행동의 무게를 감당하며, 스스로에게 당당하게 밝은 미래를 열어가겠습니다."
]
export const DEFAULT_T1 = "자유로운 선택은 자유롭지 않은 책임을 불러옵니다. 자신의 행동에 대한 책임을 지는 학생이 됩시다."
export const DEFAULT_T2 = "※ 글자를 정자로 또박또박 적으세요."

export async function saveReflection(db: AppDB, input: Omit<ReflectionRec, keyof BaseRecord>, id?: string): Promise<ReflectionRec> {
  if (input.lines.length !== 16) throw new Error('반성문은 16줄입니다.')
  if (id) {
    const cur = await db.reflections.get(id)
    if (cur) {
      const next = { ...cur, ...input, updated_at: new Date().toISOString() }
      await db.reflections.put(next)
      return next
    }
  }
  const rec = newRecord(input) as ReflectionRec
  await db.reflections.add(rec)
  return rec
}

/** 날짜 최근 순. studentId 없으면 전체. */
export async function listReflections(db: AppDB, studentId?: string): Promise<ReflectionRec[]> {
  const rows = studentId ? await db.reflections.where('student_id').equals(studentId).toArray() : await db.reflections.toArray()
  return rows.filter((r) => !r.deleted).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
}

export const deleteReflection = (db: AppDB, id: string) => scrubDelete(db.reflections, id, { reason: '', lines: [] }).then(() => undefined)

/** 좋은 문장 모음. 기본 16문장은 id를 정해(phrase-default-<n>) 넣어 기기·복원과 상관없이 한 번만. 뺀 기본 문장은 되살리지 않는다. */
export async function listPhrases(db: AppDB): Promise<ReflectionPhraseRec[]> {
  await db.transaction('rw', db.reflection_phrases, async () => {
    const now = Date.now()
    for (const [i, text] of DEFAULT_LINES.entries()) {
      const id = `phrase-default-${i}`
      if (await db.reflection_phrases.get(id)) continue
      await db.reflection_phrases.add({ ...newRecord({ text, starred_at: new Date(now - (16 - i) * 1000).toISOString() }), id } as ReflectionPhraseRec)
    }
  })
  return readPhrases(db)
}

/** 별표: 같은 글이 이미 있으면 그대로. */
export async function starPhrase(db: AppDB, text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  const all = await listPhrases(db)
  if (all.some((p) => p.text === t)) return
  await db.reflection_phrases.add(newRecord({ text: t, starred_at: new Date().toISOString() }) as ReflectionPhraseRec)
}

export const unstarPhrase = (db: AppDB, id: string) => softDelete(db.reflection_phrases, id)

/** 모음 읽기만(넣지 않음) — liveQuery 안에서 쓴다. 처음 넣기는 listPhrases. */
export async function readPhrases(db: AppDB): Promise<ReflectionPhraseRec[]> {
  return (await db.reflection_phrases.toArray()).filter((p) => !p.deleted).sort((a, b) => b.starred_at.localeCompare(a.starred_at))
}
