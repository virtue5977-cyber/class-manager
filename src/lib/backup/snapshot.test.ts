// @vitest-environment node
import { createDb, SCHEMA_VERSION, SYNCED_TABLES } from '../db/schema'
import { newRecord, softDelete } from '../db/records'
import { exportSnapshot, importSnapshot, serializeSnapshot, parseSnapshot, type Snapshot } from './snapshot'
import { BackupFormatError, BackupVersionError } from './errors'

const testDb = () => createDb('test-' + crypto.randomUUID())
const cls = (grade: number) => newRecord({ school_year: 2026, grade, class_no: 5 })

async function seeded() {
  const db = testDb()
  const a = cls(1)
  const b = cls(2)
  await db.classes.bulkAdd([a, b])
  await softDelete(db.classes, b.id)
  await db.device_local.put({ id: 'aiApiKey', value: 'sk-secret' })
  return { db, a, b }
}

test('내보내기는 삭제 표시된 행도 포함하고 device_local은 뺀다', async () => {
  const { db, b } = await seeded()
  const snap = await exportSnapshot(db, new Date('2026-11-05T00:00:00Z'))
  expect(snap.app).toBe('class-manager')
  expect(snap.schemaVersion).toBe(SCHEMA_VERSION)
  expect(snap.exportedAt).toBe('2026-11-05T00:00:00.000Z')
  expect(Object.keys(snap.tables).sort()).toEqual([...SYNCED_TABLES].sort())
  expect(snap.tables.classes).toHaveLength(2)
  expect(snap.tables.classes.find((r) => (r as { id: string }).id === b.id)).toMatchObject({ deleted: true })
  expect(JSON.stringify(snap)).not.toContain('sk-secret')
})

test('가져오기는 기존 데이터를 백업 내용으로 바꾼다', async () => {
  const { db } = await seeded()
  const snap = await exportSnapshot(db)
  const target = testDb()
  await target.classes.add(cls(3))
  await importSnapshot(target, snap)
  const grades = (await target.classes.toArray()).map((c) => c.grade).sort()
  expect(grades).toEqual([1, 2])
})

test('가져오기 후에도 device_local(aiApiKey)은 그대로다', async () => {
  const { db } = await seeded()
  const snap = await exportSnapshot(db)
  const target = testDb()
  await target.device_local.put({ id: 'aiApiKey', value: 'target-key' })
  await importSnapshot(target, snap)
  expect((await target.device_local.get('aiApiKey'))?.value).toBe('target-key')
})

test('schemaVersion이 더 크면 BackupVersionError이고 기존 데이터는 그대로다', async () => {
  const { db } = await seeded()
  const snap = await exportSnapshot(db)
  const target = testDb()
  await target.classes.add(cls(3))
  await expect(importSnapshot(target, { ...snap, schemaVersion: SCHEMA_VERSION + 1 })).rejects.toBeInstanceOf(BackupVersionError)
  expect((await target.classes.toArray()).map((c) => c.grade)).toEqual([3])
})

test('app 값이 다르면 BackupFormatError', async () => {
  const { db } = await seeded()
  const snap = await exportSnapshot(db)
  await expect(importSnapshot(testDb(), { ...snap, app: 'other' } as unknown as Snapshot)).rejects.toBeInstanceOf(BackupFormatError)
})

test('id 없는 행이 하나라도 있으면 아무 표도 바뀌지 않는다', async () => {
  const { db } = await seeded()
  const snap = await exportSnapshot(db)
  snap.tables.students = [{ name: 'id 없음' }]
  const target = testDb()
  await target.classes.add(cls(3))
  await expect(importSnapshot(target, snap)).rejects.toBeInstanceOf(BackupFormatError)
  expect((await target.classes.toArray()).map((c) => c.grade)).toEqual([3])
})

test('가져오기 중 bulkAdd가 실패하면 모든 표가 원래대로다', async () => {
  const { db, a } = await seeded()
  const snap = await exportSnapshot(db)
  // classes는 정상, students에 같은 id 두 행 → students bulkAdd에서 ConstraintError
  const s = { id: 'dup', class_id: a.id, name: '가' }
  snap.tables.students = [s, { ...s }]
  const target = testDb()
  await target.classes.add(cls(3))
  await expect(importSnapshot(target, snap)).rejects.toThrow()
  expect((await target.classes.toArray()).map((c) => c.grade)).toEqual([3])
  expect(await target.students.count()).toBe(0)
})

test('Uint8Array 값은 serialize/parse 왕복 후 같은 바이트다', async () => {
  const db = testDb()
  const data = Uint8Array.from([0, 1, 2, 250, 255])
  await db.hwpx_templates.add(newRecord({ name: '결석신고서', version: 1, data, active: true }))
  const snap = await exportSnapshot(db)
  const back = parseSnapshot(serializeSnapshot(snap))
  const row = back.tables.hwpx_templates[0] as { data: Uint8Array }
  expect(row.data).toBeInstanceOf(Uint8Array)
  expect([...row.data]).toEqual([...data])
})

test('JSON이 아닌 바이트를 parse하면 BackupFormatError', () => {
  expect(() => parseSnapshot(new TextEncoder().encode('not json'))).toThrow(BackupFormatError)
})

test('새 표(전달사항·노트·첨부·할 일·내 일정·대화·반성문)도 백업에 들어간다', () => {
  for (const t of ['notice_items', 'notes', 'note_files', 'todos', 'local_events', 'chat_log', 'reflections', 'reflection_phrases']) expect(SYNCED_TABLES).toContain(t)
})

test('표 목록을 바꾸면 백업 형식 번호도 올린다(형식별 표 목록과 같아야 함)', async () => {
  const { BACKUP_TABLES_BY_VERSION } = await import('../db/schema')
  expect([...SYNCED_TABLES]).toEqual([...BACKUP_TABLES_BY_VERSION[SCHEMA_VERSION]])
})

test('옛 형식(1) 백업에 없는 표는 지우지 않고, 있는 표만 바꾼다', async () => {
  const target = testDb()
  await target.classes.add(cls(3))
  await target.notes.add(newRecord({ title: '남아야 할 노트', blocks: [], pinned: false }) as never)
  const old = { app: 'class-manager', schemaVersion: 1, exportedAt: '2026-01-01T00:00:00Z', tables: { classes: [cls(1)] } } as unknown as Snapshot
  await importSnapshot(target, old)
  expect((await target.classes.toArray()).map((c) => c.grade)).toEqual([1])
  expect((await target.notes.toArray()).map((n) => n.title)).toEqual(['남아야 할 노트'])
})
