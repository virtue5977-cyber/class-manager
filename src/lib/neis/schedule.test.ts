// @vitest-environment node
import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import { updateSettings, setNeisKey } from '../settings'
import { mapScheduleRow, importSchoolSchedule, listCalendar } from './schedule'
import { fakeFetch, neisPage, neisResult } from './fixtures'

const row = (AA_YMD: string, EVENT_NM: string, SBTR_DD_SC_NM: string, grades: Partial<Record<string, string>> = {}) => ({
  AA_YMD, EVENT_NM, SBTR_DD_SC_NM, EVENT_CNTNT: '',
  ONE_GRADE_EVENT_YN: 'N', TW_GRADE_EVENT_YN: 'N', THREE_GRADE_EVENT_YN: 'N', FR_GRADE_EVENT_YN: '*', FIV_GRADE_EVENT_YN: '*', SIX_GRADE_EVENT_YN: '*',
  ...grades,
})

async function ready() {
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { school_name: '가락중학교', neis_office_code: 'B10', neis_school_code: '7130165', school_kind: '중학교' })
  await setNeisKey(db, 'K')
  return db
}

test('해당없음은 행사·수업일, 공휴일·휴업일은 비수업일, 방학 이름은 방학', () => {
  expect(mapScheduleRow(row('20261102', '기말고사(3학년)', '해당없음'))).toMatchObject({ date: '2026-11-02', title: '기말고사(3학년)', type: '행사', is_class_day: true, source: 'neis' })
  expect(mapScheduleRow(row('20260302', '대체공휴일', '공휴일'))).toMatchObject({ type: '휴업일', is_class_day: false })
  expect(mapScheduleRow(row('20260307', '토요휴업일', '휴업일'))).toMatchObject({ type: '휴업일', is_class_day: false })
  expect(mapScheduleRow(row('20260720', '여름방학', '휴업일'))).toMatchObject({ type: '방학', is_class_day: false })
})

test('학년 행사 표시: THREE만 Y면 grades [3], 모두 N/*이면 null', () => {
  expect(mapScheduleRow(row('20261102', '기말고사(3학년)', '해당없음', { THREE_GRADE_EVENT_YN: 'Y' })).grades).toEqual([3])
  expect(mapScheduleRow(row('20261102', '개교기념일', '휴업일')).grades).toBeNull()
})

test('같은 날 행사 2개면 2개 저장', async () => {
  const db = await ready()
  const f = fakeFetch(() => neisPage('SchoolSchedule', [row('20261110', '체육대회', '해당없음'), row('20261110', '학부모 상담', '해당없음')]))
  expect(await importSchoolSchedule(db, 2026, { fetch: f })).toEqual({ count: 2 })
  expect((await listCalendar(db, '2026-11-10', '2026-11-10')).map((c) => c.title).sort()).toEqual(['체육대회', '학부모 상담'])
})

test('다시 가져오면 neis 레코드는 바뀌고 manual 레코드는 남는다', async () => {
  const db = await ready()
  await db.school_calendar.add(newRecord({ date: '2026-11-20', title: '우리반 생일파티', type: '행사' as const, is_class_day: true, source: 'manual' as const, grades: null }))
  await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisPage('SchoolSchedule', [row('20261110', '체육대회', '해당없음')])) })
  await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisPage('SchoolSchedule', [row('20261111', '체육대회(변경)', '해당없음')])) })
  const titles = (await listCalendar(db, '2026-03-01', '2027-02-28')).map((c) => c.title)
  expect(titles).toEqual(['체육대회(변경)', '우리반 생일파티'])
})

test('키 오류면 기존 neis 레코드가 그대로다', async () => {
  const db = await ready()
  await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisPage('SchoolSchedule', [row('20261110', '체육대회', '해당없음')])) })
  await expect(importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisResult('ERROR-290', 'x')) })).rejects.toThrow('NEIS 인증키가 올바르지 않습니다.')
  expect((await listCalendar(db, '2026-11-10', '2026-11-10')).map((c) => c.title)).toEqual(['체육대회'])
})

test('학교 미선택이면 "먼저 학교를 선택하세요."', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  await setNeisKey(db, 'K')
  await expect(importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => ({})) })).rejects.toThrow('먼저 학교를 선택하세요.')
})

test('요청 범위는 3월 1일부터 다음 해 2월 28일', async () => {
  const db = await ready()
  const f = fakeFetch(() => neisPage('SchoolSchedule', []))
  await importSchoolSchedule(db, 2026, { fetch: f })
  expect(Object.fromEntries(f.calls[0].searchParams)).toMatchObject({ ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7130165', AA_FROM_YMD: '20260301', AA_TO_YMD: '20270228' })
})

test('다른 학년도 neis 레코드는 지우지 않는다', async () => {
  const db = await ready()
  await importSchoolSchedule(db, 2025, { fetch: fakeFetch(() => neisPage('SchoolSchedule', [row('20251110', '작년 행사', '해당없음')])) })
  await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisPage('SchoolSchedule', [row('20261110', '올해 행사', '해당없음')])) })
  expect((await listCalendar(db, '2025-01-01', '2027-12-31')).map((c) => c.title)).toEqual(['작년 행사', '올해 행사'])
})

test('NEIS가 0건(INFO-200)이면 기존 학사일정을 지우지 않고 kept로 알린다', async () => {
  const db = await ready()
  await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisPage('SchoolSchedule', [row('20261110', '체육대회', '해당없음')])) })
  const r = await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisResult('INFO-200', '해당하는 데이터가 없습니다.')) })
  expect(r).toEqual({ count: 0, kept: true })
  expect((await listCalendar(db, '2026-11-10', '2026-11-10')).map((c) => c.title)).toEqual(['체육대회'])
})

test('다시 가져와도 삭제된 이전 학사일정 때문에 백업이 커지지 않는다', async () => {
  const { exportSnapshot, serializeSnapshot } = await import('../backup/snapshot')
  const db = await ready()
  const many = Array.from({ length: 200 }, (_, i) => row('20261110', `행사${i}`, '해당없음'))
  await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisPage('SchoolSchedule', many)) })
  const one = serializeSnapshot(await exportSnapshot(db)).length
  for (let i = 0; i < 5; i++) await importSchoolSchedule(db, 2026, { fetch: fakeFetch(() => neisPage('SchoolSchedule', many)) })
  expect(serializeSnapshot(await exportSnapshot(db)).length).toBeLessThan(one * 2.5)
})
