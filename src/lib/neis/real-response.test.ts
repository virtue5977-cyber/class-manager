// @vitest-environment node
// 2026-11-05 사용자 노트북 내장 브라우저에서 키 없이 받은 실제 NEIS 응답의 일부(공개 학교 정보만).
import { createDb } from '../db/schema'
import { updateSettings, setNeisKey } from '../settings'
import { searchSchools } from './school'
import { importSchoolSchedule, listCalendar } from './schedule'
import { fetchMeals } from './meal'
import { fetchWeekTimetable } from './timetable'
import { fakeFetch } from './fixtures'

const head = (n: number) => ({ head: [{ list_total_count: n }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] })
const SCHOOL = { schoolInfo: [head(6), { row: [
  { ATPT_OFCDC_SC_CODE: 'B10', ATPT_OFCDC_SC_NM: '서울특별시교육청', SD_SCHUL_CODE: '7130165', SCHUL_NM: '가락중학교', ENG_SCHUL_NM: 'Karak Middle School', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '서울특별시 송파구 송이로 45', HS_SC_NM: null },
  { ATPT_OFCDC_SC_CODE: 'C10', ATPT_OFCDC_SC_NM: '부산광역시교육청', SD_SCHUL_CODE: '7201269', SCHUL_NM: '가락중학교', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '부산광역시 강서구 에코델타2로 24', HS_SC_NM: null },
] }] }
const S = (AA_YMD: string, EVENT_NM: string, SBTR_DD_SC_NM: string) => ({ ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7130165', AY: '2026', AA_YMD, SCHUL_NM: '가락중학교', EVENT_NM, EVENT_CNTNT: '', ONE_GRADE_EVENT_YN: 'Y', TW_GRADE_EVENT_YN: 'Y', THREE_GRADE_EVENT_YN: 'Y', FR_GRADE_EVENT_YN: '*', FIV_GRADE_EVENT_YN: '*', SIX_GRADE_EVENT_YN: '*', SBTR_DD_SC_NM, LOAD_DTM: '20261105' })
const SCHED = { SchoolSchedule: [head(5), { row: [S('20260301', '3·1절', '공휴일'), S('20260302', '대체공휴일', '공휴일'), S('20260303', '자(2)(입학식/시업식)', '해당없음'), S('20260307', '토요휴업일', '휴업일')] }] }
const M = (MLSV_YMD: string, DDISH_NM: string, CAL_INFO: string) => ({ ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7130165', MMEAL_SC_CODE: '2', MMEAL_SC_NM: '중식', MLSV_YMD, MLSV_FGR: 379, DDISH_NM, CAL_INFO, ORPLC_INFO: '쌀 : 국내산', NTR_INFO: '' })
const MEAL = { mealServiceDietInfo: [head(3), { row: [
  M('20261103', '통밀현미밥- (6)<br/>수제콘치즈또띠아- (1.2.5.6.12.13)<br/>감자된장찌개- (5.6)<br/>취나물볶음- (5.6)<br/>건파래볶음- (9.13)<br/>훈제오리구이&무쌈- (1.2.5.6)<br/>배추겉절이- (9)', '809.1 Kcal'),
  M('20261105', '기장현미밥- <br/>망고컵케익 (1.2.5.6)<br/>들깨미역국- (5.6.9)', '759.6 Kcal'),
  M('20261106', '쌀밥- <br/>콩나물무침 (5)<br/>깍두기- (9)<br/>과일 ', '743.8 Kcal'),
] }] }
const T = (PERIO: string, ITRT_CNTNT: string) => ({ ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7130165', AY: '2026', SEM: '2', ALL_TI_YMD: '20261102', DGHT_CRSE_SC_NM: '주간', GRADE: '1', CLASS_NM: '1', PERIO, ITRT_CNTNT, LOAD_DTM: '20261105' })
const TT = { misTimetable: [head(3), { row: [T('1', '동아리활동'), T('4', '자율·자치활동'), T('5', '수학')] }] }

const route = (u: URL) => ({ schoolInfo: SCHOOL, SchoolSchedule: SCHED, mealServiceDietInfo: MEAL, misTimetable: TT } as Record<string, unknown>)[u.pathname.split('/').pop()!]

async function ready() {
  const db = createDb('test-' + crypto.randomUUID())
  await setNeisKey(db, 'K')
  await updateSettings(db, { school_name: '가락중학교', neis_office_code: 'B10', neis_school_code: '7130165', school_kind: '중학교' })
  return db
}

test('실측: 같은 이름 학교가 지역별로 구분된다', async () => {
  const hits = await searchSchools('가락', { key: 'K', fetch: fakeFetch(route) })
  expect(hits.map((h) => `${h.name}/${h.officeName}/${h.schoolCode}`)).toEqual(['가락중학교/서울특별시교육청/7130165', '가락중학교/부산광역시교육청/7201269'])
})

test('실측: 학사일정의 공휴일·대체공휴일·토요휴업일은 비수업일, 입학식은 수업일', async () => {
  const db = await ready()
  await importSchoolSchedule(db, 2026, { fetch: fakeFetch(route) })
  const c = await listCalendar(db, '2026-03-01', '2026-03-31')
  expect(c.map((r) => `${r.date} ${r.title} ${r.is_class_day}`)).toEqual([
    '2026-03-01 3·1절 false', '2026-03-02 대체공휴일 false', '2026-03-03 자(2)(입학식/시업식) true', '2026-03-07 토요휴업일 false',
  ])
  expect(c[0].grades).toEqual([1, 2, 3])
})

test('실측: 급식 메뉴의 &, 알레르기 없는 "과일 ", 대시 없는 알레르기 표기', async () => {
  const meals = await fetchMeals(await ready(), '2026-11-05', { fetch: fakeFetch(route) })
  expect(meals).toHaveLength(3)
  expect(meals[0].dishes.find((d) => d.name === '훈제오리구이&무쌈')?.allergies).toEqual([1, 2, 5, 6])
  expect(meals[1].dishes[1]).toEqual({ name: '망고컵케익', allergies: [1, 2, 5, 6] })
  expect(meals[2].dishes.at(-1)).toEqual({ name: '과일', allergies: [] })
  expect(meals[2].calories).toBe('743.8 Kcal')
})

test('실측: 중학교 시간표의 활동명(자율·자치활동)도 과목으로 보존', async () => {
  const tt = await fetchWeekTimetable(await ready(), '2026-11-05', { fetch: fakeFetch(route) })
  expect(tt.map((t) => `${t.period}:${t.subject}`)).toEqual(['1:동아리활동', '4:자율·자치활동', '5:수학'])
})
