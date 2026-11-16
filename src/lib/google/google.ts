import { hideForExport } from '../ai/mask'
import { allStudentNames } from '../roster/roster'
import type { AppDB } from '../db/schema'
import type { GoogleEventRec, SchoolCalendarRec } from '../db/types'
import { listReportsForMonth } from '../absenceReports/list'
import { addDays } from '../schoolDays'

/** 메인(electron/googleApi.cjs)과 같은 목록. 렌더러는 이 둘 중 하나를 login에 넘긴다. */
export const BASE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file']
export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']

export interface GoogleStatus {
  client: boolean
  connected: boolean
  email: string | null
  /** 받은 권한(토큰 응답의 scope). 옛 설치는 캘린더 세 권한. */
  scopes: string[]
  /** safeStorage 비동기를 못 써서 이번 실행에만 연결됨 */
  sessionOnly?: boolean
}
export interface GoogleApiResult {
  status: number
  headers?: Record<string, string>
  json?: unknown
  bytes?: Uint8Array
}
export type GoogleMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** exe의 preload가 넣어 주는 구글 연결(토큰은 메인 프로세스에만 있음) */
export interface GoogleBridge {
  status(): Promise<GoogleStatus>
  setClient(json: string): Promise<boolean>
  login(scopes: string[], opts: { incremental: boolean }): Promise<boolean>
  logout(): Promise<boolean>
  /** 2xx가 아니어도 던지지 않고 status(+오류 json)를 돌려준다. */
  api(method: GoogleMethod, url: string, body?: unknown, opts?: { binary?: boolean; wantHeaders?: boolean; contentType?: string }): Promise<GoogleApiResult>
  /** 던지지 않고 결과로(Electron invoke는 오류의 message만 넘긴다). 크기·형식 틀림만 한국어 오류. */
  uploadResumable?(meta: Record<string, unknown>, bytes: Uint8Array, fileId?: string): Promise<GoogleUploadResult>
  download?(fileId: string): Promise<GoogleDownloadResult>
}
export type GoogleFail = { ok: false; status: number; reason?: string }
export type GoogleUploadResult = { ok: true; id: string } | GoogleFail
export type GoogleDownloadResult = { ok: true; bytes: Uint8Array } | GoogleFail

/** 받은 권한에 캘린더 세 권한이 다 있는지 */
export const hasCalendar = (st: Pick<GoogleStatus, 'connected' | 'scopes'> | undefined) => !!st?.connected && CALENDAR_SCOPES.every((s) => st.scopes?.includes(s))

/** 구글 API 오류(상태·이유를 가진다. 화면은 status 401이면 '다시 연결'). */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }
}
const errReason = (json: unknown): string | undefined => {
  const e = (json as { error?: unknown } | undefined)?.error
  if (typeof e === 'string') return e
  const o = e as { errors?: { reason?: string }[]; status?: string } | undefined
  return o?.errors?.[0]?.reason ?? o?.status
}
export function googleErrorText(status: number, reason?: string): string {
  if (status === 401) return '구글 연결이 끊겼습니다. 설정에서 다시 연결하세요.'
  if (reason === 'admin_policy_enforced' || reason === 'access_not_configured' || reason === 'accessNotConfigured') return '학교 구글 계정은 관리자가 막았을 수 있습니다. 개인 Gmail을 쓰거나 학교 관리자에게 앱 등록을 부탁하세요.'
  if (reason === 'storageQuotaExceeded') return '구글 드라이브 저장 공간이 가득 찼습니다. 공간을 비운 뒤 다시 하세요.'
  if (status === 429 || (reason !== undefined && QUOTA_REASONS.has(reason))) return '구글 요청이 너무 많습니다. 잠시 뒤 다시 하세요.'
  if (status === 0) return '구글에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'
  return `구글 오류(${status})${status === 403 ? ': 권한을 확인하세요' : ''}`
}
const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'RESOURCE_EXHAUSTED'])

const NEED_NEW_EXE = '이 기능은 새 Watson 설치 파일이 필요합니다. 새로 받아 설치하세요.'
/** 드라이브 이어 올리기. 성공이면 파일 id, 아니면 GoogleApiError(401 → 다시 연결, 저장 공간, 할당량…). */
export async function googleUpload(g: GoogleBridge, meta: Record<string, unknown>, bytes: Uint8Array, fileId?: string): Promise<string> {
  if (!g.uploadResumable) throw new Error(NEED_NEW_EXE)
  const r = await g.uploadResumable(meta, bytes, fileId)
  if (r.ok) return r.id
  throw new GoogleApiError(r.status, r.reason, googleErrorText(r.status, r.reason))
}
/** 드라이브 파일 받기(60MB까지). 실패는 GoogleApiError. */
export async function googleDownload(g: GoogleBridge, fileId: string): Promise<Uint8Array> {
  if (!g.download) throw new Error(NEED_NEW_EXE)
  const r = await g.download(fileId)
  if (r.ok) return r.bytes
  throw new GoogleApiError(r.status, r.reason, googleErrorText(r.status, r.reason))
}

const RESULT_KEYS = new Set(['status', 'headers', 'json', 'bytes'])
/** api를 부르고 2xx면 json, 아니면 GoogleApiError. (옛 exe는 json을 바로 돌려주고 오류는 던졌다 → 그대로 받는다.) */
export async function callJson<T = unknown>(g: GoogleBridge, method: GoogleMethod, url: string, body?: unknown): Promise<T> {
  const r = (await g.api(method, url, body)) as unknown
  const isNew = !!r && typeof r === 'object' && typeof (r as GoogleApiResult).status === 'number' && Object.keys(r).every((k) => RESULT_KEYS.has(k))
  if (!isNew) return r as T
  const res = r as GoogleApiResult
  if (res.status >= 200 && res.status < 300) return res.json as T
  const reason = errReason(res.json)
  throw new GoogleApiError(res.status, reason, googleErrorText(res.status, reason))
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
    const r = (await callJson(g, 'GET', `${path}${path.includes('?') ? '&' : '?'}maxResults=250${token ? `&pageToken=${enc(token)}` : ''}`)) as List<T>
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
  if (!id) id = ((await callJson(g, 'POST', '/calendar/v3/calendars', { summary: APP_CALENDAR_NAME, timeZone: TZ, description: '담임 업무 앱이 만든 캘린더입니다. 앱에서 고치세요.' })) as { id: string }).id
  await db.device_local.put({ id: CAL_ID_KEY, value: id })
  return id
}

export interface PushItem {
  key: string
  date: string
  end_date: string
  title: string
  description?: string
  /** 장소(구글 location) */
  location?: string
}

/** 보낼 일정: 학사일정(나이스·직접) + 달마다 미제출 결석신고서가 있으면 말일 알림 */
export async function buildPushItems(db: AppDB, from: string, to: string, classId?: string): Promise<PushItem[]> {
  const cal = (await db.school_calendar.where('date').between(from, to, true, true).toArray()).filter((r: SchoolCalendarRec) => !r.deleted && r.title && r.title !== '토요휴업일')
  const items: PushItem[] = cal.map((r) => ({ key: `cal-${r.id}`, date: r.date, end_date: r.date, title: r.title, description: r.is_class_day ? '' : '수업 없는 날' }))
  // 내 일정(개인·업무)도 앱 캘린더로. 제목의 학생 이름은 ○○로(학생 자료는 노트북 밖으로 보내지 않음).
  // 모든 반 학생·지운 학생·보호자 이름, 전화·주민번호·메일까지 가린다
  const names = await allStudentNames(db)
  for (const e of (await db.local_events.where('date').belowOrEqual(to).toArray()).filter((x) => !x.deleted && (x.end_date ?? x.date) >= from))
    items.push({
      key: `local-${e.id}`,
      date: e.date,
      end_date: e.end_date ?? e.date,
      title: hideForExport(`[${e.tag}] ${e.time ? e.time + ' ' : ''}${e.title}`, names),
      ...(e.memo ? { description: hideForExport(e.memo, names) } : {}),
      ...(e.place ? { location: hideForExport(e.place, names) } : {}),
    })
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

const sameEvent = (e: GEvent, it: PushItem) => e.summary === it.title && e.start?.date === it.date && e.end?.date === addDays(it.end_date, 1) && (e as { description?: string }).description === (it.description ?? '') && ((e as { location?: string }).location ?? '') === (it.location ?? '')

/** 앱 → 구글: 바뀐 것만 만들고 고치고 지운다(앱이 만든 일정만 건드림). */
export async function pushToGoogle(g: GoogleBridge, calId: string, items: PushItem[], from: string, to: string) {
  const existing = await listAll<GEvent>(g, `/calendar/v3/calendars/${enc(calId)}/events?privateExtendedProperty=${enc('damim=1')}&timeMin=${enc(`${from}T00:00:00+09:00`)}&timeMax=${enc(`${addDays(to, 1)}T00:00:00+09:00`)}&showDeleted=false`)
  const byKey = new Map(existing.map((e) => [e.extendedProperties?.private?.damimKey ?? '', e]))
  let created = 0
  let updated = 0
  let removed = 0
  for (const it of items) {
    const body = { summary: it.title, description: it.description ?? '', location: it.location ?? '', start: { date: it.date }, end: { date: addDays(it.end_date, 1) }, transparency: 'transparent', extendedProperties: { private: { damim: '1', damimKey: it.key } } }
    const cur = byKey.get(it.key)
    byKey.delete(it.key)
    if (!cur) {
      await callJson(g, 'POST', `/calendar/v3/calendars/${enc(calId)}/events`, body)
      created++
    } else if (!sameEvent(cur, it)) {
      await callJson(g, 'PATCH', `/calendar/v3/calendars/${enc(calId)}/events/${enc(cur.id)}`, body)
      updated++
    }
  }
  for (const e of byKey.values()) {
    await callJson(g, 'DELETE', `/calendar/v3/calendars/${enc(calId)}/events/${enc(e.id)}`)
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

/** 옛 exe의 status({client, loggedIn})도 새 모양으로 */
export function normStatus(st: unknown): GoogleStatus {
  const o = (st ?? {}) as Partial<GoogleStatus> & { loggedIn?: boolean }
  const connected = typeof o.connected === 'boolean' ? o.connected : !!o.loggedIn
  return { client: !!o.client, connected, email: typeof o.email === 'string' ? o.email : null, scopes: Array.isArray(o.scopes) ? o.scopes : connected ? CALENDAR_SCOPES.slice() : [], ...(o.sessionOnly ? { sessionOnly: true } : {}) }
}

/** 연결 정보가 아직 없으면 앱에 든 기본 연결 정보를 넣는다(로그인 버튼만 누르면 되게). */
export async function ensureGoogleClient(g: GoogleBridge, builtin: string): Promise<GoogleStatus> {
  const st = normStatus(await g.status())
  if (st.client || !builtin) return st
  await g.setClient(builtin)
  return normStatus(await g.status())
}
