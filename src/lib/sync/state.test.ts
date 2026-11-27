// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createDb } from '../db/schema'
import { newRecord } from '../db/records'
import { readRaw } from '../vault/middleware'
import { deviceTag } from '../backup/service'
import { getSyncState, setSyncState, isDirty, markBase, getBase, syncErrorCode, syncErrorText } from './state'
import { GoogleApiError } from '../google/google'
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

  test('syncErrorCode 매핑', () => {
    expect(syncErrorCode(new GoogleApiError(401, undefined, 'x'))).toBe('auth')
    expect(syncErrorCode(new GoogleApiError(403, 'storageQuotaExceeded', 'x'))).toBe('storage')
    expect(syncErrorCode(new GoogleApiError(429, undefined, 'x'))).toBe('rate')
    expect(syncErrorCode(new GoogleApiError(403, 'quotaExceeded', 'x'))).toBe('quota')
    expect(syncErrorCode(new GoogleApiError(0, undefined, 'x'))).toBe('offline')
    expect(syncErrorCode(new GoogleApiError(500, undefined, 'x'))).toBe('unknown')
    expect(syncErrorCode(new Error('NEWER_FORMAT'))).toBe('newer-format')
    expect(syncErrorCode(new Error('KEY_MISMATCH'))).toBe('key-mismatch')
    expect(syncErrorCode(new Error('BAD_SNAPSHOT'))).toBe('bad-snapshot')
    expect(syncErrorText('offline')).toMatch(/인터넷/)
  })
  test('lastError는 코드만 저장, 메시지는 버린다', async () => {
    const db = testDb()
    const code = syncErrorCode(new Error('학생 가나다 상담 내용'))
    expect(code).toBe('unknown')
    await setSyncState(db, { lastError: { code, at: 't' } })
    expect(JSON.stringify(await readRaw(db, 'meta'))).not.toContain('가나다')
    expect((await getSyncState(db)).lastError).toEqual({ code: 'unknown', at: 't' })
    await setSyncState(db, { lastError: null })
    expect((await getSyncState(db)).lastError).toBeNull()
  })
  test('잘못된 lastError 모양은 TypeError, 모르는 키·deviceId는 저장 안 함', async () => {
    const db = testDb()
    const bad = (v: unknown) => setSyncState(db, { lastError: v } as never)
    await expect(bad('학생 가나다')).rejects.toThrow(TypeError)
    await expect(bad({ code: 'nope', at: 't' })).rejects.toThrow(TypeError)
    await expect(bad({ code: 'auth', at: 't', message: '가나다' })).rejects.toThrow(TypeError)
    await setSyncState(db, { enabled: true, deviceId: 'x', memo: '가나다' } as never)
    const raw = (await readRaw(db, 'meta'))[0]
    expect(raw).not.toHaveProperty('deviceId')
    expect(raw).not.toHaveProperty('memo')
    expect((await getSyncState(db)).deviceId).not.toBe('x')
  })
  test('동시 setSyncState 둘 다 반영', async () => {
    const db = testDb()
    await Promise.all([setSyncState(db, { rootId: 'r' }), setSyncState(db, { deviceName: 'n' }), setSyncState(db, { lastOk: 'o' })])
    expect(await getSyncState(db)).toMatchObject({ rootId: 'r', deviceName: 'n', lastOk: 'o' })
  })
})

describe('isDirty와 base at', () => {
  test('워터마크 위의 행도 base at이 같으면(받은 그대로) dirty 아님, 고치면 dirty', async () => {
    const db = createDb('test-' + crypto.randomUUID())
    const rec = newRecord({ school_year: 2026, grade: 1, class_no: 1 })
    await db.classes.add(rec)
    const stored = (await db.classes.get(rec.id))!
    expect(await isDirty(db)).toBe(true)
    await markBase(db, [{ table: 'classes', id: rec.id, hash: H('x'), at: stored.updated_at }])
    expect(await isDirty(db)).toBe(false)
    await db.classes.put({ ...stored, grade: 2, updated_at: new Date(Date.parse(stored.updated_at) + 5).toISOString() })
    expect(await isDirty(db)).toBe(true)
  })
  test('base at이 없으면(옛 base) 예외가 아니다', async () => {
    const db = createDb('test-' + crypto.randomUUID())
    const rec = newRecord({ school_year: 2026, grade: 1, class_no: 1 })
    await db.classes.add(rec)
    await markBase(db, [{ table: 'classes', id: rec.id, hash: H('x') }])
    expect(await isDirty(db)).toBe(true)
  })
})
