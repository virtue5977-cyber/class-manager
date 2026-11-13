import 'fake-indexeddb/auto'
import { describe, it, expect, afterEach } from 'vitest'
import { AppDB, createDb } from '../db/schema'
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
    const v = new AppDB('v-t3', { vault: true }); const p = createDb('p-t3')
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
