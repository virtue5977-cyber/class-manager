// @vitest-environment node
import { createDb } from '../db/schema'
import { updateSettings, setNeisKey } from '../settings'
import { timetableService, fetchWeekTimetable, getCachedTimetable } from './timetable'
import { fakeFetch, pagedHandler } from './fixtures'

async function ready(kind: '중학교' | '고등학교') {
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { school_name: 'x', neis_office_code: 'B10', neis_school_code: '1', school_kind: kind })
  await setNeisKey(db, 'K')
  return db
}
const tt = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ALL_TI_YMD: '20261102', GRADE: String(1 + (i % 3)), CLASS_NM: String(1 + (i % 9)), PERIO: String(1 + (i % 7)), ITRT_CNTNT: ' 과학 ' }))

test('중학교는 misTimetable, 고등학교는 hisTimetable 요청', async () => {
  expect(timetableService('초등학교')).toBe('elsTimetable')
  expect(timetableService('중학교')).toBe('misTimetable')
  expect(timetableService('고등학교')).toBe('hisTimetable')
  expect(() => timetableService('')).toThrow('학교 종류를 알 수 없어 시간표를 가져올 수 없습니다.')
  const f = fakeFetch(pagedHandler('hisTimetable', tt(3)))
  await fetchWeekTimetable(await ready('고등학교'), '2026-11-05', { fetch: f })
  expect(f.calls[0].pathname).toBe('/hub/hisTimetable')
  expect(Object.fromEntries(f.calls[0].searchParams)).toMatchObject({ TI_FROM_YMD: '20261102', TI_TO_YMD: '20261106' })
})

test('시간표 479건(1000 미만)과 1200건(2쪽) 모두 빠짐없이 저장', async () => {
  for (const n of [479, 1200]) {
    const db = await ready('중학교')
    const out = await fetchWeekTimetable(db, '2026-11-05', { fetch: fakeFetch(pagedHandler('misTimetable', tt(n))) })
    expect(out).toHaveLength(n)
    expect(out[0]).toEqual({ date: '2026-11-02', grade: 1, classNo: '1', period: 1, subject: '과학' })
    expect(await getCachedTimetable(db, '2026-11-06')).toHaveLength(n)
  }
})
