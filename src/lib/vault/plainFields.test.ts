import 'fake-indexeddb/auto'
import { describe, it, expect, afterEach } from 'vitest'
import { AppDB } from '../db/schema'
import { UNENCRYPTED_TABLES } from './vaultDb'
import { plainFieldsOf } from './plainFields'

const FORBIDDEN = ['name', 'text', 'title', 'reason', 'memo', 'content', 'nuga_text', 'phone', 'guardian_name',
  'guardian_phone', 'address', 'lines', 'blocks', 'place', 'parts', 'instruction', 'data', 'note', 'bytes']

const dbs: AppDB[] = []
afterEach(async () => { for (const d of dbs.splice(0)) { d.close(); await d.delete() } })

describe('plainFieldsOf', () => {
  it('has no name/text fields in any encrypted table', async () => {
    const db = new AppDB('pf-forbidden', { vault: true }); dbs.push(db)
    await db.open()
    const skip = new Set<string>(UNENCRYPTED_TABLES)
    for (const t of db.tables) {
      if (skip.has(t.name)) continue
      const hit = [...plainFieldsOf(db, t.name)].filter(f => FORBIDDEN.includes(f))
      expect(hit, t.name).toEqual([])
    }
  })
  it('classes plain fields are exact', async () => {
    const db = new AppDB('pf-classes', { vault: true }); dbs.push(db)
    await db.open()
    expect([...plainFieldsOf(db, 'classes')].sort())
      .toEqual(['class_no', 'deleted', 'grade', 'id', 'school_year', 'updated_at'])
  })
  it('caches per table', async () => {
    const db = new AppDB('pf-cache', { vault: true }); dbs.push(db)
    await db.open()
    expect(plainFieldsOf(db, 'students')).toBe(plainFieldsOf(db, 'students'))
  })
})
