// @vitest-environment node
import { createDb, SYNCED_TABLES, SCHEMA_VERSION } from './schema'
import { newRecord } from './records'

test('SYNCED_TABLES는 24개이고 device_local을 포함하지 않는다', () => {
  expect(SYNCED_TABLES).toHaveLength(24)
  expect(SYNCED_TABLES).not.toContain('device_local')
  expect(SCHEMA_VERSION).toBe(1)
})

test('모든 SYNCED_TABLES와 device_local이 DB에 존재한다', () => {
  const db = createDb('test-' + crypto.randomUUID())
  const names = db.tables.map((t) => t.name)
  for (const t of SYNCED_TABLES) expect(names).toContain(t)
  expect(names).toContain('device_local')
})

test('같은 학생·날짜·구분 출결은 중복 저장되지 않는다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const base = {
    student_id: 's1', date: '2026-11-04', kind: '결석' as const, category: '질병' as const,
    period: null, reason: '', evidence_type: null, memo: '',
  }
  await db.attendance.add(newRecord(base))
  await expect(db.attendance.add(newRecord(base))).rejects.toThrow()
})
