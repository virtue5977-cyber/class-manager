import type { AppDB } from '../db/schema'
import { neisRequest, type FetchLike } from './client'
import { compact, getCache, putCache, rangeKey, schoolContext, weekRange } from './cache'
import { ymdToIso } from './schedule'

export interface ClassPeriod {
  date: string
  grade: number
  classNo: string
  period: number
  subject: string
}

interface TimetableRow {
  ALL_TI_YMD: string
  GRADE: string
  CLASS_NM: string
  PERIO: string
  ITRT_CNTNT: string
}

export function timetableService(kind: string): 'elsTimetable' | 'misTimetable' | 'hisTimetable' {
  if (kind === '초등학교') return 'elsTimetable'
  if (kind === '중학교') return 'misTimetable'
  if (kind === '고등학교') return 'hisTimetable'
  throw new Error('학교 종류를 알 수 없어 시간표를 가져올 수 없습니다.')
}

export async function fetchWeekTimetable(db: AppDB, date: string, opts: { fetch?: FetchLike } = {}): Promise<ClassPeriod[]> {
  const ctx = await schoolContext(db, opts.fetch)
  const service = timetableService(ctx.settings.school_kind)
  const range = weekRange(date)
  const rows = await neisRequest<TimetableRow>(service, { ...ctx.params, TI_FROM_YMD: compact(range.from), TI_TO_YMD: compact(range.to) }, ctx.opts)
  const periods = rows.map((r) => ({
    date: ymdToIso(r.ALL_TI_YMD),
    grade: Number(r.GRADE),
    classNo: String(r.CLASS_NM).trim(),
    period: Number(r.PERIO),
    subject: (r.ITRT_CNTNT ?? '').trim(),
  }))
  await putCache(db, 'class_timetable', rangeKey(range), periods)
  return periods
}

export async function getCachedTimetable(db: AppDB, date: string): Promise<ClassPeriod[] | null> {
  return getCache<ClassPeriod[]>(db, 'class_timetable', rangeKey(weekRange(date)))
}
