import type { AppDB } from '../db/schema'
import { neisRequest, type FetchLike } from './client'
import { compact, getCache, putCache, rangeKey, schoolContext, weekRange } from './cache'
import { ymdToIso } from './schedule'

export { weekRange }

export interface MealDish {
  name: string
  allergies: number[]
}

export interface Meal {
  date: string
  kind: string
  dishes: MealDish[]
  calories: string
}

interface MealRow {
  MLSV_YMD: string
  MMEAL_SC_NM: string
  DDISH_NM: string
  CAL_INFO: string
}

/** '미니어묵우동- (1.5.6.7.9.18)<br/>김치 (9)' → [{name, allergies}] */
export function parseDishes(ddish: string): MealDish[] {
  return ddish
    .split(/<br\s*\/?>/i)
    .map((part) => {
      const m = part.match(/\(([\d.\s]+)\)\s*$/)
      const allergies = m ? m[1].split('.').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0) : []
      const name = (m ? part.slice(0, m.index) : part).replace(/[\s\-*]+$/, '').trim()
      return { name, allergies }
    })
    .filter((d) => d.name !== '')
}

export async function fetchMeals(db: AppDB, date: string, opts: { fetch?: FetchLike } = {}): Promise<Meal[]> {
  const ctx = await schoolContext(db, opts.fetch)
  const range = weekRange(date)
  const rows = await neisRequest<MealRow>('mealServiceDietInfo', { ...ctx.params, MLSV_FROM_YMD: compact(range.from), MLSV_TO_YMD: compact(range.to) }, ctx.opts)
  const meals = rows.map((r) => ({ date: ymdToIso(r.MLSV_YMD), kind: r.MMEAL_SC_NM, dishes: parseDishes(r.DDISH_NM), calories: r.CAL_INFO ?? '' }))
  await putCache(db, 'meal', rangeKey(range), meals)
  return meals
}

export async function getCachedMeals(db: AppDB, date: string): Promise<Meal[] | null> {
  return getCache<Meal[]>(db, 'meal', rangeKey(weekRange(date)))
}
