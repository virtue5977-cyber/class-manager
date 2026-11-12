import type { AppDB } from '../db/schema'
import type { BaseRecord, ChatRec } from '../db/types'
import { newRecord, save } from '../db/records'
import { toYmd } from '../schoolDays'
import { currentThread, LEGACY_THREAD } from './chatThreads'

/** 학년도: 3월 1일 시작 */
export function schoolYearOf(ymd: string): number {
  const y = Number(ymd.slice(0, 4))
  return Number(ymd.slice(5, 7)) >= 3 ? y : y - 1
}

export async function appendChat(db: AppDB, entry: Omit<ChatRec, keyof BaseRecord | 'at' | 'school_year'>, now = new Date()): Promise<ChatRec> {
  const thread = entry.thread ?? currentThread()
  const rec = newRecord({ ...entry, at: now.toISOString(), school_year: schoolYearOf(toYmd(now)), ...(thread !== LEGACY_THREAD ? { thread } : {}) }, now) as ChatRec
  await db.chat_log.add(rec)
  return rec
}

const threadOf = (c: ChatRec) => c.thread ?? LEGACY_THREAD

/** 이번 학년도 대화(thread를 주면 그 묶음만) */
export async function listChat(db: AppDB, schoolYear: number, thread?: string): Promise<ChatRec[]> {
  return (await db.chat_log.where('school_year').equals(schoolYear).toArray()).filter((c) => !c.deleted && (thread === undefined || threadOf(c) === thread)).sort((a, b) => a.at.localeCompare(b.at))
}

/** 최근 대화 목록: 묶음마다 제목(첫 입력)·마지막 때·개수, 최근 순 */
export async function listThreads(db: AppDB, schoolYear: number): Promise<{ id: string; title: string; last: string; count: number }[]> {
  const by = new Map<string, ChatRec[]>()
  for (const c of await listChat(db, schoolYear)) by.set(threadOf(c), [...(by.get(threadOf(c)) ?? []), c])
  return [...by.entries()]
    .map(([id, cs]) => ({ id, title: id === LEGACY_THREAD ? '이전 대화' : cs[0].input.slice(0, 40), last: cs[cs.length - 1].at, count: cs.length }))
    .sort((a, b) => b.last.localeCompare(a.last))
}

/** 대화 묶음 지우기(글도 비운다) */
export async function deleteThread(db: AppDB, thread: string): Promise<void> {
  for (const c of await db.chat_log.toArray()) if (!c.deleted && threadOf(c) === thread) await deleteChat(db, c.id)
}

/** 지우면 글(입력·요약·링크)도 비운다 — 건강 사유 같은 내용이 지운 기록·백업에 남지 않게. */
export async function deleteChat(db: AppDB, id: string): Promise<void> {
  const cur = await db.chat_log.get(id)
  if (cur) await save(db.chat_log, { ...cur, deleted: true, input: '', summary: '', links: [], detail: undefined })
}

/** 그날(노트북 시간 기준) 대화 지우기 */
export async function clearChatOn(db: AppDB, ymd: string): Promise<void> {
  for (const c of await db.chat_log.toArray()) if (!c.deleted && toYmd(new Date(c.at)) === ymd) await deleteChat(db, c.id)
}

/** 지난 학년도 대화는 지운다. 지운 개수. */
export async function pruneChat(db: AppDB, today: string): Promise<number> {
  const cur = schoolYearOf(today)
  let n = 0
  for (const c of await db.chat_log.where('school_year').below(cur).toArray())
    if (!c.deleted) {
      await deleteChat(db, c.id)
      n++
    }
  return n
}
