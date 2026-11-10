import type { Table } from 'dexie'
import type { BaseRecord } from './types'

export function newRecord<T extends object>(fields: T, now: Date = new Date()): T & BaseRecord {
  const ts = now.toISOString()
  return { ...fields, id: crypto.randomUUID(), created_at: ts, updated_at: ts, deleted: false }
}

/** 레코드를 저장하면서 updated_at만 갱신한다. */
export async function save<T extends BaseRecord>(table: Table<T, string>, rec: T, now: Date = new Date()): Promise<T> {
  const next = { ...rec, updated_at: now.toISOString() }
  await table.put(next)
  return next
}

/** 행을 지우지 않고 삭제 표시만 한다(2단계 동기화의 tombstone). */
export async function softDelete<T extends BaseRecord>(table: Table<T, string>, id: string, now: Date = new Date()): Promise<void> {
  const rec = await table.get(id)
  if (!rec) return
  await table.put({ ...rec, deleted: true, updated_at: now.toISOString() })
}

export async function listActive<T extends BaseRecord>(table: Table<T, string>): Promise<T[]> {
  return (await table.toArray()).filter((r) => !r.deleted)
}

/** 지우면서 내용 글도 비운다(지운 기록·백업에 학생 자료가 남지 않게). blanks: 비울 칸과 빈 값 */
export async function scrubDelete<T extends BaseRecord>(table: Table<T, string>, id: string, blanks: Partial<T>, now: Date = new Date()): Promise<T | undefined> {
  const rec = await table.get(id)
  if (!rec) return undefined
  await table.put({ ...rec, ...blanks, deleted: true, updated_at: now.toISOString() })
  return rec
}
