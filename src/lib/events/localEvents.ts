import type { AppDB } from '../db/schema'
import type { LocalEventRec } from '../db/types'
import { newRecord, save, softDelete } from '../db/records'

type EventInput = { date: string; end_date?: string | null; time?: string | null; title: string; tag: LocalEventRec['tag']; place?: string; memo?: string }

const check = (e: { title: string; date: string; end_date?: string | null }) => {
  if (!e.title.trim()) throw new Error('일정 제목을 입력하세요.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error('날짜를 고르세요.')
  if (e.end_date && e.end_date < e.date) throw new Error('끝 날짜가 시작 날짜보다 앞입니다.')
}
/** 빈 장소·메모는 넣지 않는다 */
const extras = (x: { place?: string; memo?: string }) => ({ ...(x.place?.trim() ? { place: x.place.trim() } : {}), ...(x.memo?.trim() ? { memo: x.memo.trim() } : {}) })

export async function addLocalEvent(db: AppDB, input: EventInput): Promise<LocalEventRec> {
  check(input)
  const title = input.title.trim()
  const rec = newRecord({ date: input.date, end_date: input.end_date ?? null, time: input.time ?? null, title, tag: input.tag, google_id: null, ...extras(input) }) as LocalEventRec
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

/** 내 일정 고치기(빈 장소·메모는 지운다) */
export async function updateLocalEvent(db: AppDB, id: string, patch: Partial<Omit<EventInput, 'tag'>> & { tag?: LocalEventRec['tag'] }): Promise<LocalEventRec> {
  const cur = await db.local_events.get(id)
  if (!cur || cur.deleted) throw new Error('일정을 찾지 못했습니다.')
  const { place: _p, memo: _m, ...base } = cur
  const merged = { ...base, ...patch, place: patch.place ?? cur.place, memo: patch.memo ?? cur.memo }
  const next = { ...base, date: merged.date, end_date: merged.end_date && merged.end_date !== merged.date ? merged.end_date : null, time: merged.time || null, title: merged.title.trim(), tag: merged.tag, ...extras(merged) } as LocalEventRec
  check(next)
  return save(db.local_events, next)
}

export async function deleteLocalEvent(db: AppDB, id: string): Promise<void> {
  await softDelete(db.local_events, id)
}
