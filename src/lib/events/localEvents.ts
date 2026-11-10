import type { AppDB } from '../db/schema'
import type { LocalEventRec } from '../db/types'
import { newRecord } from '../db/records'

export async function addLocalEvent(db: AppDB, input: { date: string; end_date?: string | null; time?: string | null; title: string; tag: LocalEventRec['tag'] }): Promise<LocalEventRec> {
  const title = input.title.trim()
  if (!title) throw new Error('일정 제목을 입력하세요.')
  if (input.end_date && input.end_date < input.date) throw new Error('끝 날짜가 시작 날짜보다 앞입니다.')
  const rec = newRecord({ date: input.date, end_date: input.end_date ?? null, time: input.time ?? null, title, tag: input.tag, google_id: null }) as LocalEventRec
  await db.local_events.add(rec)
  return rec
}

/** from~to와 기간이 겹치는 내 일정(날짜·시각 순). */
export async function listLocalEvents(db: AppDB, from: string, to: string): Promise<LocalEventRec[]> {
  const rows = await db.local_events.where('date').belowOrEqual(to).toArray()
  return rows
    .filter((e) => !e.deleted && (e.end_date ?? e.date) >= from)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}
