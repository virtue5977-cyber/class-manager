// @vitest-environment node
import { createDb } from '../db/schema'
import { updateSettings, setNeisKey } from '../settings'
import { parseDishes, weekRange, fetchMeals, getCachedMeals } from './meal'
import { fakeFetch, neisPage } from './fixtures'

const REAL = '귀리현미밥- <br/>미니어묵우동- (1.5.6.7.9.18)<br/>오이도라지생채- (5.6.13)<br/>소시지브로콜리볶음- (2.5.6.10.12.13.15.16.18)<br/>돼지고기강정- (2.5.6.10.12.13)<br/>김치 (9)'

async function ready() {
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { school_name: '가락중학교', neis_office_code: 'B10', neis_school_code: '7130165', school_kind: '중학교' })
  await setNeisKey(db, 'K')
  return db
}
const mealRow = (MLSV_YMD: string, DDISH_NM: string, MMEAL_SC_NM = '중식') => ({ MLSV_YMD, MMEAL_SC_NM, DDISH_NM, CAL_INFO: '958.3 Kcal' })

test('parseDishes: 실측 문자열 → 이름과 알레르기 번호', () => {
  expect(parseDishes(REAL)).toEqual([
    { name: '귀리현미밥', allergies: [] },
    { name: '미니어묵우동', allergies: [1, 5, 6, 7, 9, 18] },
    { name: '오이도라지생채', allergies: [5, 6, 13] },
    { name: '소시지브로콜리볶음', allergies: [2, 5, 6, 10, 12, 13, 15, 16, 18] },
    { name: '돼지고기강정', allergies: [2, 5, 6, 10, 12, 13] },
    { name: '김치', allergies: [9] },
  ])
  expect(parseDishes('밥*<BR>국<br>  <br/>')).toEqual([{ name: '밥', allergies: [] }, { name: '국', allergies: [] }])
})

test('weekRange: 2026-11-05(목) → 2026-11-02 ~ 2026-11-06, 주말은 다음 주 월~금', () => {
  expect(weekRange('2026-11-05')).toEqual({ from: '2026-11-02', to: '2026-11-06' })
  expect(weekRange('2026-11-08')).toEqual({ from: '2026-11-09', to: '2026-11-13' }) // 일요일 → 다음 주
  expect(weekRange('2026-11-07')).toEqual({ from: '2026-11-09', to: '2026-11-13' }) // 토요일 → 다음 주
  expect(weekRange('2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-06' })
})

test('fetchMeals는 캐시에 저장하고 같은 주를 다시 받으면 교체한다', async () => {
  const db = await ready()
  const f1 = fakeFetch(() => neisPage('mealServiceDietInfo', [mealRow('20261102', REAL)]))
  const meals = await fetchMeals(db, '2026-11-05', { fetch: f1 })
  expect(meals).toEqual([{ date: '2026-11-02', kind: '중식', dishes: parseDishes(REAL), calories: '958.3 Kcal' }])
  expect(Object.fromEntries(f1.calls[0].searchParams)).toMatchObject({ MLSV_FROM_YMD: '20261102', MLSV_TO_YMD: '20261106', SD_SCHUL_CODE: '7130165' })
  await fetchMeals(db, '2026-11-03', { fetch: fakeFetch(() => neisPage('mealServiceDietInfo', [mealRow('20261103', '라면')])) })
  expect((await getCachedMeals(db, '2026-11-02'))!.map((m) => m.date)).toEqual(['2026-11-03'])
  expect((await db.neis_cache.toArray()).filter((r) => !r.deleted)).toHaveLength(1)
})

test('네트워크 실패 시 fetchMeals는 오류, getCachedMeals는 이전 값을 돌려준다', async () => {
  const db = await ready()
  await fetchMeals(db, '2026-11-05', { fetch: fakeFetch(() => neisPage('mealServiceDietInfo', [mealRow('20261102', REAL)])) })
  const down = async () => { throw new TypeError('offline') }
  await expect(fetchMeals(db, '2026-11-05', { fetch: down })).rejects.toThrow('NEIS에 연결하지 못했습니다')
  expect((await getCachedMeals(db, '2026-11-05'))![0].dishes).toHaveLength(6)
  expect(await getCachedMeals(db, '2026-12-01')).toBeNull()
})

test('삭제된 이전 캐시는 내용을 비워 백업이 커지지 않는다', async () => {
  const { exportSnapshot, serializeSnapshot } = await import('../backup/snapshot')
  const db = await ready()
  const big = Array.from({ length: 300 }, (_, i) => mealRow('20261102', `메뉴${i}- (1.2)`))
  await fetchMeals(db, '2026-11-05', { fetch: fakeFetch(() => neisPage('mealServiceDietInfo', big)) })
  const one = serializeSnapshot(await exportSnapshot(db)).length
  for (let i = 0; i < 5; i++) await fetchMeals(db, '2026-11-05', { fetch: fakeFetch(() => neisPage('mealServiceDietInfo', big)) })
  expect(serializeSnapshot(await exportSnapshot(db)).length).toBeLessThan(one * 1.2)
})
