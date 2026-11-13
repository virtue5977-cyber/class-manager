import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, afterEach } from 'vitest'
import { AppDB } from '../db/schema'
import { VAULT_STORES, UNENCRYPTED_TABLES } from './vaultDb'

const dbs: AppDB[] = []
afterEach(async () => { for (const d of dbs.splice(0)) { d.close(); await d.delete() } })

describe('vault schema', () => {
  it('drops name/updated_at indexes and adds three tables', () => {
    expect(VAULT_STORES.hwpx_templates).toBe('id')
    expect(VAULT_STORES.notes).toBe('id')
    expect(VAULT_STORES.note_blobs).toBe('id')
    expect(VAULT_STORES.meta).toBe('id')
    expect(VAULT_STORES.sync_rows).toBe('id')
    expect(VAULT_STORES.attendance).toContain('&[student_id+date+kind]')
  })
  it('vault and plain DB expose the same tables', async () => {
    const v = new AppDB('v-t3', { vault: true }); const p = new AppDB('p-t3') // 평문 DB(시험 스위치와 무관하게)
    dbs.push(v, p)
    await v.open(); await p.open()
    expect(v.isVault).toBe(true); expect(p.isVault).toBe(false)
    expect(v.tables.map(t => t.name).sort()).toEqual(p.tables.map(t => t.name).sort())
    expect(v.tables.map(t => t.name)).toEqual(expect.arrayContaining(['note_blobs', 'meta', 'sync_rows']))
    expect(v.verno).toBe(1)
    expect(v.table('notes').schema.indexes.map(i => i.name)).not.toContain('updated_at')
    expect(v.table('hwpx_templates').schema.indexes.map(i => i.name)).not.toContain('name')
    await p.sync_rows.put({ id: 'a' }); expect(await p.sync_rows.count()).toBe(1)
  })
  it('lists unencrypted tables', () => {
    expect(UNENCRYPTED_TABLES).toEqual(['neis_cache', 'meta', 'sync_rows', 'note_blobs'])
  })
})

describe('upgrade of existing plain DB', () => {
  it('keeps rows and adds empty note_blobs when opened with AppDB', async () => {
    const name = 'upgrade-test'
    const old = new Dexie(name)
    old.version(1).stores({
      classes: 'id, [school_year+grade+class_no]', students: 'id, class_id',
      attendance: 'id, student_id, date, &[student_id+date+kind]', absence_reports: 'id, student_id, start_date',
      report_attendance: 'id, report_id, attendance_id', counseling_logs: 'id, student_id, date',
      seating_charts: 'id, class_id', cleaning_charts: 'id, class_id', school_calendar: 'id, date',
      neis_cache: 'id, [kind+range_key]', teacher_timetable: 'id, [weekday+period]', ai_prompts: 'id, kind',
      notices: 'id, target_date', briefings: 'id, [target_date+slot]', hwpx_templates: 'id, name',
      app_settings: 'id', device_local: 'id',
    })
    old.version(2).stores({ google_events: 'id, date' })
    old.version(3).stores({
      notice_items: 'id, start_date, end_date', notes: 'id, updated_at', note_files: 'id, note_id',
      todos: 'id, order', local_events: 'id, date', chat_log: 'id, at, school_year',
      reflections: 'id, student_id, date', reflection_phrases: 'id',
    })
    await old.open()
    await old.table('notes').put({ id: 'n1', updated_at: 1, text: 'hello' })
    await old.table('students').put({ id: 's1', class_id: 'c1', name: 'Kim' })
    old.close()

    const db = new AppDB(name); dbs.push(db)
    await db.open()
    expect(await db.notes.get('n1')).toMatchObject({ id: 'n1', text: 'hello' })
    expect(await db.students.get('s1')).toMatchObject({ id: 's1', name: 'Kim' })
    expect(db.tables.map(t => t.name)).toContain('note_blobs')
    expect(await db.note_blobs.count()).toBe(0)
  })
})
