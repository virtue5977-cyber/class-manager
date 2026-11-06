import type { AppDB } from '../db/schema'
import { newRecord } from '../db/records'
import type { NeisCacheRec } from '../db/types'
import { getNeisKey, getSettings } from '../settings'
import { addDays, weekday } from '../schoolDays'
import type { FetchLike } from './client'

/** 그 날짜가 속한 주의 월~금. 토·일이면 다가오는 주(주말에 다음 주를 준비하는 경우). */
export function weekRange(date: string): { from: string; to: string } {
  const w = weekday(date)
  const from = w >= 6 ? addDays(date, 8 - w) : addDays(date, 1 - w)
  return { from, to: addDays(from, 4) }
}

export const rangeKey = (r: { from: string; to: string }) => `${r.from}~${r.to}`
export const compact = (d: string) => d.replace(/-/g, '')

/** 같은 종류·범위의 이전 캐시는 실제로 지우고 새로 저장한다(NEIS에서 다시 받을 수 있는 값이라 삭제 표시를 남기지 않는다). */
export async function putCache(db: AppDB, kind: NeisCacheRec['kind'], key: string, payload: unknown): Promise<void> {
  const now = new Date()
  await db.transaction('rw', db.neis_cache, async () => {
    const old = await db.neis_cache.where('[kind+range_key]').equals([kind, key]).toArray()
    await db.neis_cache.bulkDelete(old.map((r) => r.id))
    await db.neis_cache.add(newRecord({ kind, range_key: key, payload, fetched_at: now.toISOString() }, now))
  })
}

export async function getCache<T>(db: AppDB, kind: NeisCacheRec['kind'], key: string): Promise<T | null> {
  const rows = (await db.neis_cache.where('[kind+range_key]').equals([kind, key]).toArray()).filter((r) => !r.deleted)
  return rows.length ? (rows[rows.length - 1].payload as T) : null
}

/** 학교 설정과 키를 확인하고 요청 공통 인자를 만든다. */
export async function schoolContext(db: AppDB, fetch?: FetchLike) {
  const s = await getSettings(db)
  if (!s.neis_school_code || !s.neis_office_code) throw new Error('먼저 학교를 선택하세요.')
  return {
    settings: s,
    params: { ATPT_OFCDC_SC_CODE: s.neis_office_code, SD_SCHUL_CODE: s.neis_school_code },
    opts: { key: await getNeisKey(db), fetch },
  }
}
