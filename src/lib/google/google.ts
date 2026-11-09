import type { AppDB } from '../db/schema'
import type { GoogleEventRec, SchoolCalendarRec } from '../db/types'
import { listReportsForMonth } from '../absenceReports/list'
import { addDays } from '../schoolDays'

/** exe의 preload가 넣어 주는 구글 연결(토큰은 메인 프로세스에만 있음) */
export interface GoogleBridge {
  status(): Promise<{ client: boolean; loggedIn: boolean }>
  setClient(json: string): Promise<boolean>
  login(): Promise<boolean>
  logout(): Promise<boolean>
  api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown>
}

export function getGoogle(): GoogleBridge | undefined {
  return (globalThis as { desktop?: { google?: GoogleBridge } }).desktop?.google
}

export const APP_CALENDAR_NAME = '학사일정(담임업무)'
const CAL_ID_KEY = 'googleCalendarId'
const LAST_SYNC_KEY = 'googleLastSync'
const TZ = 'Asia/Seoul'
const enc = encodeURIComponent

interface GEvent {
  id: string
  status?: string
  summary?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  updated?: string
  extendedProperties?: { private?: Record<string, string> }
}
type List<T> = { items?: T[]; nextPageToken?: string }

async function listAll<T>(g: GoogleBridge, path: string): Promise<T[]> {
  const out: T[] = []
  let token = ''
  for (let i = 0; i < 20; i++) {
    const r = (await g.api('GET', `${path}${path.includes('?') ? '&' : '?'}maxResults=250${token ? `&pageToken=${enc(token)}` : ''}`)) as List<T>
    out.push(...(r.items ?? []))
    if (!r.nextPageToken) break
    token = r.nextPageToken
  }
  return out
}

/** 앱 전용 캘린더(없으면 만든다). */
export async function ensureAppCalendar(db: AppDB, g: GoogleBridge): Promise<string> {
  const saved = (await db.device_local.get(CAL_ID_KEY))?.value as string | undefined
  const list = await listAll<{ id: string; summary?: string }>(g, '/calendar/v3/users/me/calendarList?minAccessRole=owner')
  const found = list.find((c) => c.id === saved) ?? list.find((c) => c.summary === APP_CALENDAR_NAME)
  let id = found?.id
  if (!id) id = ((await g.api('POST', '/calendar/v3/calendars', { summary: APP_CALENDAR_NAME, timeZone: TZ, description: '담임 업무 앱이 만든 캘린더입니다. 앱에서 고치세요.' })) as { id: string }).id
  await db.device_local.put({ id: CAL_ID_KEY, value: id })
  return id
}

export interface PushItem {
  key: string
  date: string
  end_date: string
  title: string
  description?: string
}

/** 보낼 일정: 학사일정(나이스·직접) + 달마다 미제출 결석신고서가 있으면 말일 알림 */
export async function buildPushItems(db: AppDB, from: string, to: string, classId?: string): Promise<PushItem[]> {
  const cal = (await db.school_calendar.where('date').between(from, to, true, true).toArray()).filter((r: SchoolCalendarRec) => !r.deleted && r.title && r.title !== '토요휴업일')
  const items: PushItem[] = cal.map((r) => ({ key: `cal-${r.id}`, date: r.date, end_date: r.date, title: r.title, description: r.is_class_day ? '' : '수업 없는 날' }))
  if (classId) {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) {
      const open = (await listReportsForMonth(db, classId, m)).filter((r) => !r.report.submitted)
      if (!open.length) continue
      const [y, mm] = m.split('-').map(Number)
      const last = `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`
      items.push({ key: `report-${m}`, date: last, end_date: last, title: `결석신고서 정리(미제출 ${open.length}건)`, description: open.map((r) => `${r.student.number}번`).join(', ') })
    }
  }
  return items
}

const sameEvent = (e: GEvent, it: PushItem) => e.summary === it.title && e.start?.date === it.date && e.end?.date === addDays(it.end_date, 1) && (e as { description?: string }).description === (it.description ?? '')

/** 앱 → 구글: 바뀐 것만 만들고 고치고 지운다(앱이 만든 일정만 건드림). */
export async function pushToGoogle(g: GoogleBridge, calId: string, items: PushItem[], from: string, to: string) {
  const existing = await listAll<GEvent>(g, `/calendar/v3/calendars/${enc(calId)}/events?privateExtendedProperty=${enc('damim=1')}&timeMin=${enc(`${from}T00:00:00+09:00`)}&timeMax=${enc(`${addDays(to, 1)}T00:00:00+09:00`)}&showDeleted=false`)
  const byKey = new Map(existing.map((e) => [e.extendedProperties?.private?.damimKey ?? '', e]))
  let created = 0
  let updated = 0
  let removed = 0
  for (const it of items) {
    const body = { summary: it.title, description: it.description ?? '', start: { date: it.date }, end: { date: addDays(it.end_date, 1) }, transparency: 'transparent', extendedProperties: { private: { damim: '1', damimKey: it.key } } }
    const cur = byKey.get(it.key)
    byKey.delete(it.key)
    if (!cur) {
      await g.api('POST', `/calendar/v3/calendars/${enc(calId)}/events`, body)
      created++
    } else if (!sameEvent(cur, it)) {
      await g.api('PATCH', `/calendar/v3/calendars/${enc(calId)}/events/${enc(cur.id)}`, body)
      updated++
    }
  }
  for (const e of byKey.values()) {
    await g.api('DELETE', `/calendar/v3/calendars/${enc(calId)}/events/${enc(e.id)}`)
    removed++
  }
  return { created, updated, removed }
}

const toLocal = (iso: string) => {
  const d = new Date(iso)
  const k = new Date(d.getTime() + 9 * 3600000) // 한국 시간
  return { date: k.toISOString().slice(0, 10), time: k.toISOString().slice(11, 16) }
}

/** 구글 → 앱: 기본 캘린더 일정을 가져와 google_events를 통째로 바꾼다(앱 전용 캘린더는 빼고). */
export async function pullFromGoogle(db: AppDB, g: GoogleBridge, from: string, to: string): Promise<number> {
  const events = await listAll<GEvent>(g, `/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${enc(`${from}T00:00:00+09:00`)}&timeMax=${enc(`${addDays(to, 1)}T00:00:00+09:00`)}`)
  const recs: GoogleEventRec[] = events
    .filter((e) => e.status !== 'cancelled' && e.extendedProperties?.private?.damim !== '1' && (e.start?.date || e.start?.dateTime))
    .map((e) => {
      const allDay = !!e.start?.date
      const s = allDay ? { date: e.start!.date!, time: '' } : toLocal(e.start!.dateTime!)
      const end = allDay ? addDays(e.end?.date ?? s.date, -1) : toLocal(e.end?.dateTime ?? e.start!.dateTime!).date
      return { id: e.id, date: s.date, end_date: end < s.date ? s.date : end, time: s.time, title: e.summary || '(제목 없음)', calendar: 'primary', updated: e.updated ?? '' }
    })
  await db.transaction('rw', db.google_events, async () => {
    await db.google_events.clear()
    await db.google_events.bulkPut(recs)
  })
  return recs.length
}

/** 한 번에: 앱 캘린더 준비 → 보내기 → 가져오기. 기간: 지난 30일 ~ 앞으로 180일 */
export async function syncGoogle(db: AppDB, g: GoogleBridge, today: string, classId?: string) {
  const from = addDays(today, -30)
  const to = addDays(today, 180)
  const calId = await ensureAppCalendar(db, g)
  const pushed = await pushToGoogle(g, calId, await buildPushItems(db, from, to, classId), from, to)
  const pulled = await pullFromGoogle(db, g, from, to)
  await db.device_local.put({ id: LAST_SYNC_KEY, value: new Date().toISOString() })
  return { ...pushed, pulled }
}

export async function lastGoogleSync(db: AppDB): Promise<string | null> {
  return ((await db.device_local.get(LAST_SYNC_KEY))?.value as string | undefined) ?? null
}

/** 화면용: 기간 안 구글 일정(여러 날 일정은 시작일 기준) */
export async function listGoogleEvents(db: AppDB, from: string, to: string): Promise<GoogleEventRec[]> {
  return (await db.google_events.where('date').between(from, to, true, true).toArray()).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
}
