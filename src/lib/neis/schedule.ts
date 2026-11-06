import type { AppDB } from '../db/schema'
import { newRecord } from '../db/records'
import type { BaseRecord, SchoolCalendarRec } from '../db/types'
import { getNeisKey, getSettings } from '../settings'
import { neisRequest, type FetchLike } from './client'

interface ScheduleRow {
  AA_YMD: string
  EVENT_NM: string
  SBTR_DD_SC_NM: string
  ONE_GRADE_EVENT_YN?: string
  TW_GRADE_EVENT_YN?: string
  THREE_GRADE_EVENT_YN?: string
  FR_GRADE_EVENT_YN?: string
  FIV_GRADE_EVENT_YN?: string
  SIX_GRADE_EVENT_YN?: string
}

const GRADE_KEYS = ['ONE', 'TW', 'THREE', 'FR', 'FIV', 'SIX'] as const

export const ymdToIso = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`

export function mapScheduleRow(row: ScheduleRow): Omit<SchoolCalendarRec, keyof BaseRecord> {
  const grades = GRADE_KEYS.flatMap((k, i) => (row[`${k}_GRADE_EVENT_YN` as keyof ScheduleRow] === 'Y' ? [i + 1] : []))
  const title = row.EVENT_NM.trim()
  const base = { date: ymdToIso(row.AA_YMD), title, source: 'neis' as const, grades: grades.length ? grades : null }
  if (row.SBTR_DD_SC_NM === '해당없음') return { ...base, type: '행사', is_class_day: true }
  if (title.includes('방학')) return { ...base, type: '방학', is_class_day: false }
  return { ...base, type: '휴업일', is_class_day: false }
}

/** 학년도: {y}-03-01 ~ {y+1}년 2월 말일 */
export function schoolYearRange(y: number): { from: string; to: string } {
  const leap = (y + 1) % 4 === 0 && ((y + 1) % 100 !== 0 || (y + 1) % 400 === 0)
  return { from: `${y}-03-01`, to: `${y + 1}-02-${leap ? 29 : 28}` }
}

/**
 * NEIS 학사일정으로 그 학년도의 neis 레코드를 바꾼다(manual은 유지).
 * NEIS가 0건이면 기존 일정을 지우지 않고 kept=true로 알린다.
 * 옛 neis 레코드는 다시 받을 수 있으므로 삭제 표시 없이 실제로 지운다(백업 크기 보호).
 */
export async function importSchoolSchedule(db: AppDB, schoolYear: number, opts: { fetch?: FetchLike } = {}): Promise<{ count: number; kept?: boolean }> {
  const s = await getSettings(db)
  if (!s.neis_school_code || !s.neis_office_code) throw new Error('먼저 학교를 선택하세요.')
  const { from, to } = schoolYearRange(schoolYear)
  const rows = await neisRequest<ScheduleRow>(
    'SchoolSchedule',
    { ATPT_OFCDC_SC_CODE: s.neis_office_code, SD_SCHUL_CODE: s.neis_school_code, AA_FROM_YMD: from.replace(/-/g, ''), AA_TO_YMD: to.replace(/-/g, '') },
    { key: await getNeisKey(db), fetch: opts.fetch },
  )
  const now = new Date()
  let kept = false
  await db.transaction('rw', db.school_calendar, async () => {
    const old = (await db.school_calendar.where('date').between(from, to, true, true).toArray()).filter((r) => r.source === 'neis')
    if (rows.length === 0 && old.some((r) => !r.deleted)) {
      kept = true
      return
    }
    await db.school_calendar.bulkDelete(old.map((r) => r.id))
    await db.school_calendar.bulkAdd(rows.map((r) => newRecord(mapScheduleRow(r), now)))
  })
  return kept ? { count: 0, kept } : { count: rows.length }
}

export async function listCalendar(db: AppDB, from: string, to: string): Promise<SchoolCalendarRec[]> {
  const rows = await db.school_calendar.where('date').between(from, to, true, true).toArray()
  return rows.filter((r) => !r.deleted).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
