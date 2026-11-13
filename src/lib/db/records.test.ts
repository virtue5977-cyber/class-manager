// @vitest-environment node
import { createDb } from './schema'
import { newRecord, save, softDelete, listActive } from './records'
import type { StudentRec } from './types'

const testDb = () => createDb('test-' + crypto.randomUUID())

function student(name: string, now?: Date): StudentRec {
  return newRecord(
    {
      class_id: 'c1', number: 1, name, address: '', birth_date: '', prev_school: '', phone: '',
      hobby: '', talent: '', commute: '', friends: '', memo: '', guardian_name: '', guardian_phone: '',
      active: true,
    },
    now,
  )
}

test('newRecord는 uuid와 같은 created_at/updated_at, deleted=false를 붙인다', () => {
  const now = new Date('2026-11-04T01:00:00Z')
  const r = newRecord({ name: '가' }, now)
  expect(r.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(r.created_at).toBe('2026-11-04T01:00:00.000Z')
  expect(r.updated_at).toBe(r.created_at)
  expect(r.deleted).toBe(false)
})

// 시계도 넘긴 now에 맞춘다: vault DB는 updated_at을 실제 시계로 도장 찍는다(spec §5.5). 평문 DB에는 차이 없음.
const atClock = (iso: string) => { vi.setSystemTime(new Date(iso)); return new Date(iso) }
afterEach(() => { vi.useRealTimers() })

test('save는 updated_at만 갱신한다', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const db = testDb()
  const r = student('가', atClock('2026-11-04T01:00:00Z'))
  await save(db.students, r, new Date('2026-11-04T01:00:00Z'))
  const later = atClock('2026-11-05T02:00:00Z')
  const back = await save(db.students, { ...r, name: '나' }, later)
  const got = await db.students.get(r.id)
  expect(got?.name).toBe('나')
  expect(got?.created_at).toBe('2026-11-04T01:00:00.000Z')
  expect(got?.updated_at).toBe('2026-11-05T02:00:00.000Z')
  expect(back.updated_at).toBe(got?.updated_at)
})

test('softDelete는 deleted=true로 바꾸고 행을 남긴다', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const db = testDb()
  const r = student('가', atClock('2026-11-05T00:00:00Z'))
  await save(db.students, r)
  await softDelete(db.students, r.id, atClock('2026-11-06T00:00:00Z'))
  const got = await db.students.get(r.id)
  expect(got?.deleted).toBe(true)
  expect(got?.updated_at).toBe('2026-11-06T00:00:00.000Z')
})

test('listActive는 삭제된 행을 뺀다', async () => {
  const db = testDb()
  const a = student('가')
  const b = student('나')
  await save(db.students, a)
  await save(db.students, b)
  await softDelete(db.students, a.id)
  const list = await listActive(db.students)
  expect(list.map((s) => s.name)).toEqual(['나'])
})
