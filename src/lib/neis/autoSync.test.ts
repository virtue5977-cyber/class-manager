import { createDb } from '../db/schema'
import { dueNeis, NEIS_EVERY, neisAutoSync, readNeisSyncTimes } from './autoSync'

test('받을 때: 학사일정 7일마다, 급식·시간표 하루마다(처음엔 둘 다)', () => {
  const now = new Date('2026-11-11T08:00:00Z')
  expect(NEIS_EVERY).toEqual({ schedule: 7 * 86400000, week: 86400000 })
  expect(dueNeis({}, now)).toEqual({ schedule: true, week: true })
  expect(dueNeis({ schedule: '2026-11-06T08:00:00Z', week: '2026-11-11T01:00:00Z' }, now)).toEqual({ schedule: false, week: false })
  expect(dueNeis({ schedule: '2026-11-03T08:00:00Z', week: '2026-11-10T07:00:00Z' }, now)).toEqual({ schedule: true, week: true })
})

test('neisAutoSync: 키·학교가 없으면 아무것도 안 함, 있으면 할 일만 하고 시각을 남긴다(실패해도 앱은 계속)', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const calls: string[] = []
  const jobs = { schedule: async () => void calls.push('s'), week: async () => void calls.push('w') }
  expect(await neisAutoSync(db, new Date('2026-11-11T08:00:00Z'), jobs, false)).toEqual([])
  expect(await neisAutoSync(db, new Date('2026-11-11T08:00:00Z'), jobs, true)).toEqual(['schedule', 'week'])
  expect(calls).toEqual(['s', 'w'])
  const t = await readNeisSyncTimes(db)
  expect(t.week).toBe('2026-11-11T08:00:00.000Z')
  expect(await neisAutoSync(db, new Date('2026-11-11T09:00:00Z'), jobs, true)).toEqual([])
  const bad = { schedule: async () => { throw new Error('망') }, week: async () => {} }
  expect(await neisAutoSync(db, new Date('2026-11-20T09:00:00Z'), bad, true)).toEqual(['week'])
})
