// @vitest-environment node
import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import type { SchoolCalendarRec } from '../db/types'
import { createClass, emptyStudent, saveStudent } from '../roster/roster'
import { saveAttendance } from '../attendance/attendance'
import { reconcileStudent } from '../absenceReports/reconcile'
import { syncGoogle, listGoogleEvents, APP_CALENDAR_NAME, type GoogleBridge } from './google'

/** 구글 캘린더 API를 흉내 내는 가짜(요청 경로·본문만 확인) */
function fakeGoogle(primary: unknown[]) {
  const calendars: { id: string; summary: string }[] = []
  const events = new Map<string, Record<string, unknown>>()
  let n = 0
  const calls: string[] = []
  const g: GoogleBridge = {
    status: async () => ({ client: true, loggedIn: true }),
    setClient: async () => true,
    login: async () => true,
    logout: async () => true,
    api: async (method, path, body) => {
      calls.push(`${method} ${path.split('?')[0]}`)
      if (path.startsWith('/calendar/v3/users/me/calendarList')) return { items: calendars }
      if (method === 'POST' && path === '/calendar/v3/calendars') {
        const c = { id: 'app-cal', summary: (body as { summary: string }).summary }
        calendars.push(c)
        return c
      }
      if (path.startsWith('/calendar/v3/calendars/primary/events')) return { items: primary }
      const m = path.match(/^\/calendar\/v3\/calendars\/app-cal\/events(?:\/([^?]+))?/)
      if (m) {
        if (method === 'GET') return { items: [...events.values()] }
        if (method === 'POST') {
          const id = `e${++n}`
          events.set(id, { id, ...(body as object) })
          return events.get(id)
        }
        if (method === 'PATCH') return events.set(m[1], { id: m[1], ...(body as object) }).get(m[1])
        if (method === 'DELETE') return void events.delete(m[1])
      }
      throw new Error('예상 못 한 호출 ' + method + ' ' + path)
    },
  }
  return { g, events, calls, calendars }
}

test('보내기: 앱 캘린더를 만들고 학사일정·신고서 알림을 넣고, 다시 하면 바뀐 것만, 사라진 일정은 지운다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '가'))
  await saveAttendance(db, { student_id: s.id, date: '2026-11-10', kind: '결석', category: '질병', period: null, reason: '', evidence_type: null, memo: '' })
  await reconcileStudent(db, s.id)
  const ev = newRecord({ date: '2026-11-20', title: '체육대회', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec
  await db.school_calendar.add(ev)
  const f = fakeGoogle([])
  const r1 = await syncGoogle(db, f.g, '2026-11-09', c.id)
  expect(f.calendars.map((x) => x.summary)).toEqual([APP_CALENDAR_NAME])
  expect(r1).toMatchObject({ created: 2, updated: 0, removed: 0 })
  expect([...f.events.values()].map((e) => e.summary).sort()).toEqual(['결석신고서 정리(미제출 1건)', '체육대회'])
  expect([...f.events.values()].find((e) => e.summary === '체육대회')).toMatchObject({ start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
  const r2 = await syncGoogle(db, f.g, '2026-11-09', c.id)
  expect(r2).toMatchObject({ created: 0, updated: 0, removed: 0 })
  await db.school_calendar.update(ev.id, { title: '체육대회(우천 시 연기)' })
  await db.school_calendar.add(newRecord({ date: '2026-11-25', title: '현장체험', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec)
  await db.school_calendar.update(ev.id, { deleted: true })
  const r3 = await syncGoogle(db, f.g, '2026-11-09', c.id)
  expect(r3).toMatchObject({ created: 1, removed: 1 })
  expect(f.calls.filter((x) => x === 'POST /calendar/v3/calendars')).toHaveLength(1)
})

test('가져오기: 종일·시간 일정을 한국 시간으로, 앱이 만든 일정은 빼고, 다시 가져오면 통째로 바꾼다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const f = fakeGoogle([
    { id: 'a', summary: '학부모 상담', start: { dateTime: '2026-11-12T06:30:00Z' }, end: { dateTime: '2026-11-12T07:00:00Z' } },
    { id: 'b', summary: '연수', start: { date: '2026-11-13' }, end: { date: '2026-11-15' } },
    { id: 'c', summary: '앱 것', start: { date: '2026-11-13' }, end: { date: '2026-11-14' }, extendedProperties: { private: { damim: '1' } } },
    { id: 'd', status: 'cancelled', summary: '취소', start: { date: '2026-11-13' } },
  ])
  const r = await syncGoogle(db, f.g, '2026-11-09')
  expect(r.pulled).toBe(2)
  expect((await listGoogleEvents(db, '2026-11-01', '2026-11-30')).map((e) => [e.date, e.end_date, e.time, e.title])).toEqual([
    ['2026-11-12', '2026-11-12', '15:30', '학부모 상담'],
    ['2026-11-13', '2026-11-14', '', '연수'],
  ])
})

test('연결 정보가 없으면 앱에 든 기본값을 넣고, 이미 있으면 그대로 둔다', async () => {
  const { ensureGoogleClient } = await import('./google')
  let client = false
  const set: string[] = []
  const g = { ...fakeGoogle([]).g, status: async () => ({ client, loggedIn: false }), setClient: async (j: string) => { set.push(j); client = true; return true } }
  expect(await ensureGoogleClient(g, '{"installed":{}}')).toEqual({ client: true, loggedIn: false })
  await ensureGoogleClient(g, '{"installed":{}}')
  expect(set).toHaveLength(1)
})

test('내 일정 제목의 학생 이름은 구글로 보낼 때 ○○로 가린다', async () => {
  const { createDb } = await import('../db/schema')
  const { createClass, emptyStudent, saveStudent } = await import('../roster/roster')
  const { addLocalEvent } = await import('../events/localEvents')
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(3, '김민수'))
  await addLocalEvent(db, { date: '2026-11-12', time: '15:00', title: '김민수 어머니 상담, 민수 진로', tag: '업무' })
  const { buildPushItems } = await import('./google')
  const items = await buildPushItems(db, '2026-11-01', '2026-11-30', c.id)
  expect(items.map((i) => i.title)).toContain('[업무] 15:00 ○○ 어머니 상담, ○○ 진로')
})

test('내 일정 장소·메모는 구글 location·description으로(이름은 가림)', async () => {
  const { createDb } = await import('../db/schema')
  const { createClass, emptyStudent, saveStudent } = await import('../roster/roster')
  const { addLocalEvent } = await import('../events/localEvents')
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(3, '김민수'))
  await addLocalEvent(db, { date: '2026-11-12', title: '협의회', tag: '업무', place: '3층 시청각실', memo: '김민수 자료' })
  const { buildPushItems } = await import('./google')
  const it = (await buildPushItems(db, '2026-11-01', '2026-11-30', c.id)).find((i) => i.title.includes('협의회'))!
  expect([it.location, it.description]).toEqual(['3층 시청각실', '○○ 자료'])
})
