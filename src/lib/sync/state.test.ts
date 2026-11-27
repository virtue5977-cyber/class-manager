// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import { readRaw } from '../vault/middleware'
import { deviceTag } from '../backup/service'
import { getSyncState, setSyncState, isDirty, markBase, getBase } from './state'
import { syncKeyFrom, rowHash } from './hash'

const testDb = () => createDb('test-' + crypto.randomUUID())
const H = (s: string) => rowHash(syncKeyFrom(new Uint8Array(32).fill(1)), { s })

describe('sync state', () => {
  test('기본 상태와 deviceId', async () => {
    const db = testDb()
    const s = await getSyncState(db)
    expect(s.enabled).toBe(false)
    expect(s.seen).toEqual({})
    expect(s.deviceId.startsWith(await deviceTag(db))).toBe(true)
    expect((await getSyncState(db)).deviceId).toBe(s.deviceId)
  })
  test('patch 병합', async () => {
    const db = testDb()
    await setSyncState(db, { enabled: true, rootId: 'r1' })
    await setSyncState(db, { seen: { a: 't' } })
    const s = await getSyncState(db)
    expect(s).toMatchObject({ enabled: true, rootId: 'r1', seen: { a: 't' } })
  })
  test('쓰기 후 dirty, 올린 max를 적으면 dirty 아님', async () => {
    const db = testDb()
    expect(await isDirty(db)).toBe(false)
    const rec = newRecord({ school_year: 2026, grade: 1, class_no: 1 })
    await db.classes.add(rec)
    expect(await isDirty(db)).toBe(true)
    const stored = (await db.classes.get(rec.id))!
    await setSyncState(db, { lastUploadedMax: stored.updated_at })
    expect(await isDirty(db)).toBe(false)
    await db.classes.put({ ...stored, grade: 2, updated_at: new Date(Date.parse(stored.updated_at) + 5).toISOString() })
    expect(await isDirty(db)).toBe(true)
  })
  test('동기화하지 않는 표의 쓰기는 dirty가 아니다', async () => {
    const db = testDb()
    await db.device_local.put({ id: 'x', value: 1 })
    expect(await isDirty(db)).toBe(false)
  })
  test('note_files 생성도 dirty', async () => {
    const db = testDb()
    await db.note_files.add({ ...newRecord({ note_id: 'n', name: 'a', mime: 'x', size: 1 }) })
    expect(await isDirty(db)).toBe(true)
  })
  test('base 왕복과 트랜잭션 안 사용', async () => {
    const db = testDb()
    await markBase(db, [{ table: 'notes', id: 'a', hash: H('1') }, { table: 'todos', id: 'a', hash: H('2') }])
    expect(await getBase(db, 'notes', ['a', 'zz'])).toEqual(new Map([['a', H('1')]]))
    await db.transaction('rw', db.sync_rows, async () => {
      await markBase(db, [{ table: 'notes', id: 'a', hash: H('3') }])
      expect((await getBase(db, 'notes', ['a'])).get('a')).toBe(H('3'))
    })
  })
  test('sync_rows에는 hash만(HMAC 64자)', async () => {
    const db = testDb()
    await markBase(db, [{ table: 'notes', id: 'a', hash: H('1') }])
    const raw = await readRaw(db, 'sync_rows')
    expect(raw).toEqual([{ id: 'notes\u0000a', hash: H('1') }])
    expect(raw[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
