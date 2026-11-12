import type { AppDB } from '../db/schema'
import { newRecord, save, scrubDelete } from '../db/records'
import type { CounselingLogRec, NugaStatus, StudentRec } from '../db/types'
import { weekday } from '../schoolDays'

export interface LogInput {
  student_id: string
  date: string
  place: string
  content: string
  target?: string
  method?: string
  topic?: string
  time?: string
  kind?: '상담' | '관찰'
}

export const KINDS = ['상담', '관찰'] as const
export const kindOf = (l: { kind?: '상담' | '관찰' }) => l.kind ?? '상담'

/** 담임용으로 줄인 분류(위로그의 상담 분류 참고) */
export const TARGETS = ['학생', '보호자', '교사', '기타'] as const
export const METHODS = ['대면', '전화', '문자', '온라인'] as const
export const TOPICS = ['학업', '교우관계', '진로', '가정', '생활·행동', '건강', '학교폭력', '기타'] as const

/** 카드·표에 붙이는 짧은 꼬리표: 보호자 · 전화 · 진로 */
export function logTags(l: { target?: string; method?: string; topic?: string; time?: string }): string {
  return [l.time, l.target && l.target !== '학생' ? l.target : '', l.method && l.method !== '대면' ? l.method : '', l.topic].filter(Boolean).join(' · ')
}

export async function saveLog(db: AppDB, input: LogInput, id?: string): Promise<CounselingLogRec> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('날짜를 입력하세요.')
  if (!input.content.trim()) throw new Error('내용을 입력하세요.')
  const obs = input.kind === '관찰'
  // 관찰 기록은 날짜·시각·장소·내용만(대상·방법은 비운다)
  const fields = { ...input, kind: input.kind ?? '상담', place: input.place.trim(), content: input.content.trim(), target: obs ? '' : (input.target ?? '학생'), method: obs ? '' : (input.method ?? '대면'), topic: input.topic ?? '', time: input.time ?? '' }
  if (id) {
    const cur = await db.counseling_logs.get(id)
    if (!cur) throw new Error('상담 기록을 찾을 수 없습니다.')
    // 원문이 바뀌면 정리본은 남기되 다시 정리가 필요하다고 표시한다.
    const status: NugaStatus = cur.content !== fields.content && cur.nuga_status !== '미정리' ? '미정리' : cur.nuga_status
    return save(db.counseling_logs, { ...cur, ...fields, nuga_status: status, nuga_entered_at: status === '나이스 입력 완료' ? cur.nuga_entered_at : null })
  }
  const rec = newRecord({ ...fields, nuga_text: '', nuga_status: '미정리' as NugaStatus, nuga_entered_at: null }) as CounselingLogRec
  await db.counseling_logs.add(rec)
  return rec
}

export const deleteLog = (db: AppDB, id: string) => scrubDelete(db.counseling_logs, id, { content: '', nuga_text: '', place: '' }).then(() => undefined)

const byDate = (a: CounselingLogRec, b: CounselingLogRec) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created_at < b.created_at ? -1 : 1)

export async function listLogsByStudent(db: AppDB, studentId: string): Promise<CounselingLogRec[]> {
  return (await db.counseling_logs.where('student_id').equals(studentId).toArray()).filter((l) => !l.deleted).sort(byDate)
}

/** 여러 학생의 상담 기록을 한 번에 읽어 학생별로(날짜순) 묶는다. */
export async function listLogsByStudents(db: AppDB, ids: string[]): Promise<Record<string, CounselingLogRec[]>> {
  const out: Record<string, CounselingLogRec[]> = Object.fromEntries(ids.map((id) => [id, []]))
  for (const l of await db.counseling_logs.where('student_id').anyOf(ids).toArray()) if (!l.deleted) out[l.student_id]?.push(l)
  for (const list of Object.values(out)) list.sort(byDate)
  return out
}

export async function updateNuga(db: AppDB, id: string, patch: { nuga_text?: string; nuga_status?: NugaStatus }): Promise<CounselingLogRec> {
  return db.transaction('rw', db.counseling_logs, async () => {
    const cur = await db.counseling_logs.get(id)
    if (!cur) throw new Error('상담 기록을 찾을 수 없습니다.')
    const next = { ...cur, ...patch }
    if (patch.nuga_status) next.nuga_entered_at = patch.nuga_status === '나이스 입력 완료' ? new Date().toISOString() : null
    return save(db.counseling_logs, next)
  })
}

/** 학급 전체에서 원문·정리본·장소에 낱말이 든 기록(학생과 함께). */
export async function searchLogs(db: AppDB, students: StudentRec[], keyword: string): Promise<{ log: CounselingLogRec; student: StudentRec }[]> {
  const q = keyword.trim()
  if (!q) return []
  const out: { log: CounselingLogRec; student: StudentRec }[] = []
  for (const s of students) for (const log of await listLogsByStudent(db, s.id)) if ([log.content, log.nuga_text, log.place].some((t) => t.includes(q))) out.push({ log, student: s })
  return out.sort((a, b) => byDate(a.log, b.log))
}

const DAY = ['', '월', '화', '수', '목', '금', '토', '일']
/** 누가기록 머리줄: 2026.11.05.(목) | 점심시간 교실 */
export function nugaHeader(date: string, place: string): string {
  const head = `${date.replace(/-/g, '.')}.(${DAY[weekday(date)]})`
  return place ? `${head} | ${place}` : head
}

/** 누가기록 머리줄(일자 → 시각 → 장소 → 상담이면 대상·방법). 빈 것은 뺀다: 2026.11.05.(목) 12:40 | 점심시간 교실 | 보호자·전화 */
export function nugaHead(l: Pick<CounselingLogRec, 'date' | 'place'> & { time?: string; target?: string; method?: string; kind?: '상담' | '관찰' }): string {
  const day = `${l.date.replace(/-/g, '.')}.(${DAY[weekday(l.date)]})`
  const first = [day, l.time].filter(Boolean).join(' ')
  const who = kindOf(l) === '상담' ? [l.target, l.method].filter(Boolean).join('·') : ''
  return [first, l.place, who].filter(Boolean).join(' | ')
}

/** 나이스에 붙여넣을 글: 머리줄 + 정리본(없으면 원문). */
export function nugaCopyText(log: CounselingLogRec): string {
  return `${nugaHead(log)}\n${log.nuga_text || log.content}`
}

/** 학급 전체 기록(최근 먼저) */
export async function listAllLogs(db: AppDB, studentIds: string[]): Promise<CounselingLogRec[]> {
  const set = new Set(studentIds)
  return (await db.counseling_logs.where('student_id').anyOf([...set]).toArray()).filter((l) => !l.deleted).sort((a, b) => -byDate(a, b))
}
