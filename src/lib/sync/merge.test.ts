import { describe, it, expect } from 'vitest'
import { SYNC_TABLES, syncableRow } from './tables'
import { SYNCED_TABLES } from '../db/schema'
import { syncKeyFrom, rowHash } from './hash'
import { canonicalJson } from '../vault/canon'
import { winner, decide, dedupe, type SyncRow } from './merge'

const dekA = new Uint8Array(32).fill(1)
const dekB = new Uint8Array(32).fill(2)
const key = syncKeyFrom(dekA)
const T1 = '2026-01-01T00:00:00.000Z', T2 = '2026-01-02T00:00:00.000Z', T3 = '2026-01-03T00:00:00.000Z'
const r = (id: string, updated_at: string, extra: Record<string, unknown> = {}): SyncRow => ({ id, updated_at, ...extra })

function shuffles<T>(arr: T[], n = 25): T[][] {
  let s = 12345
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  return Array.from({ length: n }, () => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
    return a
  })
}

describe('tables', () => {
  it('SYNC_TABLES excludes derived tables only', () => {
    expect(SYNC_TABLES).not.toContain('neis_cache')
    expect(SYNC_TABLES).not.toContain('school_calendar')
    expect(SYNC_TABLES).toContain('note_files')
    expect(SYNC_TABLES.length).toBe(SYNCED_TABLES.length - 2)
    for (const x of ['google_events', 'device_local', 'meta', 'sync_rows', 'note_blobs']) expect(SYNC_TABLES as readonly string[]).not.toContain(x)
  })
  it('filters estimated timetable rows', () => {
    expect(syncableRow('teacher_timetable', { source: 'estimated' })).toBe(false)
    expect(syncableRow('teacher_timetable', { source: 'manual' })).toBe(true)
    expect(syncableRow('notes', { source: 'estimated' })).toBe(true)
  })
})

describe('rowHash', () => {
  it('differs per key, stable for same row+key, key-order independent', () => {
    const row = { id: 'a', updated_at: 't', x: 1, y: 'z' }
    expect(rowHash(key, row)).toBe(rowHash(key, { y: 'z', x: 1, updated_at: 't', id: 'a' }))
    expect(rowHash(key, row)).not.toBe(rowHash(syncKeyFrom(dekB), row))
    expect(rowHash(key, row)).toMatch(/^[0-9a-f]{64}$/)
    expect(syncKeyFrom(dekA)).toEqual(key)
    expect(key.length).toBe(32)
  })
})

describe('winner', () => {
  it('alive beats deleted even if older', () => {
    const alive = r('a', '2020'); const dead = r('a', '2030', { deleted: true })
    expect(winner(alive, dead)).toBe(alive); expect(winner(dead, alive)).toBe(alive)
  })
  it('later updated_at, then larger id', () => {
    const a = r('a', '2'); const b = r('b', '1')
    expect(winner(a, b)).toBe(a); expect(winner(b, a)).toBe(a)
    const c = r('a', '1'); const d = r('b', '1')
    expect(winner(c, d)).toBe(d); expect(winner(d, c)).toBe(d)
  })
  it('equal returns a', () => {
    const a = r('a', '1'); const b = { ...a }
    expect(winner(a, b)).toBe(a)
  })
  it('is symmetric for equal id/time but different content', () => {
    const a = r('a', '1', { v: 1 }); const b = r('a', '1', { v: 2 })
    expect(winner(a, b)).toEqual(winner(b, a))
  })
})

describe('decide', () => {
  const base = r('n1', '1', { t: 'base' })
  const bh = rowHash(key, base)
  const call = (local: SyncRow | undefined, remote: SyncRow | undefined, b: string | undefined, table = 'todos') =>
    decide({ local, remote, base: b, key, table })

  it('local unchanged, remote changed -> take', () => {
    const remote = r('n1', '2', { t: 'r' })
    const d = call(base, remote, bh)
    expect(d.action).toBe('take'); expect(d.value).toBe(remote)
  })
  it('remote == base -> keep', () => {
    const local = r('n1', '2', { t: 'l' })
    const d = call(local, base, bh)
    expect(d.action).toBe('keep'); expect(d.value).toBe(local)
  })
  it('identical both -> keep', () => {
    expect(call({ ...base }, { ...base }, undefined).action).toBe('keep')
  })
  it('both changed, differ -> conflict; non-note uses winner, no copy', () => {
    const l = r('n1', '2', { t: 'l' }); const rr = r('n1', '3', { t: 'r' })
    const d = call(l, rr, bh)
    expect(d.action).toBe('conflict'); expect(d.value).toBe(rr); expect(d.conflictCopy).toBeUndefined()
  })
  it('only one side present', () => {
    expect(call(base, undefined, bh).action).toBe('keep')
    const d = call(undefined, base, undefined)
    expect(d.action).toBe('take'); expect(d.value).toBe(base)
  })
  it('no base, both present, differ -> conflict', () => {
    expect(call(r('n1', '2', { t: 'l' }), r('n1', '3', { t: 'r' }), undefined).action).toBe('conflict')
  })
  for (const table of ['notes', 'counseling_logs']) {
    it(`${table}: conflict copy of loser, deterministic id, same on both PCs`, () => {
      const l = r('n1', '2', { t: 'l' }); const rr = r('n1', '3', { t: 'r' })
      const d1 = call(l, rr, bh, table)
      const d2 = call(rr, l, bh, table) // other PC: roles swapped
      expect(d1.value).toBe(rr)
      expect(d1.conflictCopy).toMatchObject({ t: 'l', updated_at: '2', conflict_of: 'n1' })
      expect(d1.conflictCopy!.id).toBe(`conflict:n1:${rowHash(key, l).slice(0, 12)}`)
      expect(d2.conflictCopy).toEqual(d1.conflictCopy)
      expect(d2.value).toEqual(d1.value)
    })
  }
})

describe('dedupe', () => {
  const att = (id: string, t: string, extra: Record<string, unknown> = {}) => r(id, t, { student_id: 's1', date: '2026-03-02', kind: 'late', ...extra })

  it('attendance same key x3 (one deleted) -> one kept, two hardDeleted', () => {
    const rows = [att('a', T1), att('b', T2, { deleted: true }), att('c', T1), att('z', T1, { student_id: 's2' })]
    const out = dedupe('attendance', rows)
    expect(out.keep.map((x) => x.id).sort()).toEqual(['c', 'z'])
    expect(out.hardDelete.sort()).toEqual(['a', 'b'])
  })
  it('attendance deleted-only duplicates still collapse', () => {
    const out = dedupe('attendance', [att('a', T1, { deleted: true }), att('b', T2, { deleted: true })])
    expect(out.keep.map((x) => x.id)).toEqual(['b']); expect(out.hardDelete).toEqual(['a'])
  })
  it('ai_prompts: only latest active per kind stays active, others changed with new updated_at', () => {
    const rows = [
      r('p1', '2025-01-01T00:00:00.000Z', { kind: 'k', active: true, version: 1 }),
      r('p2', '2025-02-01T00:00:00.000Z', { kind: 'k', active: true, version: 2 }),
      r('p3', '2026-06-01T00:00:00.000Z', { kind: 'k', active: true, version: 3 }),
      r('q1', '2025-01-01T00:00:00.000Z', { kind: 'other', active: true }),
      r('p0', '2024-01-01T00:00:00.000Z', { kind: 'k', active: false }),
    ]
    const out = dedupe('ai_prompts', rows)
    const by = Object.fromEntries(out.keep.map((x) => [x.id, x]))
    expect(by.p3.active).toBe(true); expect(by.p3.updated_at).toBe('2026-06-01T00:00:00.000Z')
    expect(by.q1.active).toBe(true); expect(by.q1.updated_at).toBe('2025-01-01T00:00:00.000Z')
    expect(by.p0.updated_at).toBe('2024-01-01T00:00:00.000Z')
    expect(by.p1.active).toBe(false); expect(by.p1.updated_at).toBe('2026-06-01T00:00:00.001Z')
    expect(by.p2.active).toBe(false); expect(by.p2.updated_at).toBe('2026-06-01T00:00:00.001Z')
    expect(out.hardDelete).toEqual([])
  })
  it('changed rows get max(row, winner)+1ms', () => {
    const future = '2027-01-01T00:00:00.000Z'
    const out = dedupe('ai_prompts', [r('a', future, { kind: 'k', active: true }), r('b', '2020-01-01T00:00:00.000Z', { kind: 'k', active: true })])
    expect(out.keep.find((x) => x.id === 'b')!.updated_at).toBe('2027-01-01T00:00:00.001Z')
    const out2 = dedupe('ai_prompts', [r('a', future, { kind: 'k', active: true }), r('b', future, { kind: 'k', active: true })])
    const ch = out2.keep.find((x) => x.active === false)!
    expect(ch.updated_at).toBe('2027-01-01T00:00:00.001Z')
  })
  it('notes: notice_date pair keeps latest, others cleared with new updated_at', () => {
    const rows = [
      r('n1', '2026-01-01T00:00:00.000Z', { notice_date: '2026-03-02', title: 'a' }),
      r('n2', '2026-01-02T00:00:00.000Z', { notice_date: '2026-03-02', title: 'b' }),
      r('n3', '2026-01-03T00:00:00.000Z', { notice_date: '2026-03-03', title: 'c' }),
      r('n4', '2026-01-04T00:00:00.000Z', { title: 'plain' }),
    ]
    const out = dedupe('notes', rows)
    const by = Object.fromEntries(out.keep.map((x) => [x.id, x]))
    expect(by.n2.notice_date).toBe('2026-03-02')
    expect('notice_date' in by.n1).toBe(false); expect(by.n1.updated_at).toBe('2026-01-02T00:00:00.001Z'); expect(by.n1.title).toBe('a')
    expect(by.n3.notice_date).toBe('2026-03-03'); expect(by.n3.updated_at).toBe('2026-01-03T00:00:00.000Z')
    expect(by.n4.updated_at).toBe('2026-01-04T00:00:00.000Z')
  })
  it('notes: deleted notes are not pair candidates', () => {
    const rows = [r('n1', T2, { notice_date: 'd', deleted: true }), r('n2', T1, { notice_date: 'd' })]
    const out = dedupe('notes', rows)
    expect(out.keep.find((x) => x.id === 'n2')!.notice_date).toBe('d')
  })
  it('classes and other tables untouched', () => {
    const rows = [r('c1', T1, { school_year: 2026, grade: 1, class_no: 1 }), r('c2', T1, { school_year: 2026, grade: 1, class_no: 1 })]
    const out = dedupe('classes', rows)
    expect(out.keep.length).toBe(2); expect(out.hardDelete).toEqual([])
  })

  it('property: input order never changes the result', () => {
    const cases: [string, SyncRow[]][] = [
      ['attendance', [att('a', T1), att('b', T2), att('c', T2, { deleted: true }), att('d', T2), att('e', T3, { deleted: true })]],
      ['ai_prompts', [r('p1', T2, { kind: 'k', active: true }), r('p2', T2, { kind: 'k', active: true }), r('p3', T1, { kind: 'k', active: true }), r('p4', T3, { kind: 'j', active: true })]],
      ['notes', [r('n1', T2, { notice_date: 'd' }), r('n2', T2, { notice_date: 'd' }), r('n3', T1, { notice_date: 'd' }), r('n4', T1, {})]],
    ]
    for (const [table, rows] of cases) {
      const norm = (o: { keep: SyncRow[]; hardDelete: string[] }) => JSON.stringify({ keep: o.keep, hardDelete: [...o.hardDelete].sort() })
      const ref = norm(dedupe(table, rows))
      for (const sh of shuffles(rows)) expect(norm(dedupe(table, sh))).toBe(ref)
    }
  })
  it('property: winner is order independent over many rows (tournament)', () => {
    const rows = [r('a', '1'), r('b', '1'), r('c', '2', { deleted: true }), r('d', '1', { v: 1 }), r('d', '1', { v: 2 })]
    const fold = (xs: SyncRow[]) => JSON.stringify(xs.reduce((a, b) => winner(a, b)))
    const ref = fold(rows)
    for (const sh of shuffles(rows)) expect(fold(sh)).toBe(ref)
  })
  it('property: decide conflict value/copy identical regardless of which side is local', () => {
    const base = rowHash(key, r('n', '0'))
    const xs = [r('n', '2', { t: 1 }), r('n', '2', { t: 2 }), r('n', '3', { deleted: true })]
    for (const l of xs) for (const rm of xs) {
      if (l === rm) continue
      const d1 = decide({ local: l, remote: rm, base, key, table: 'notes' })
      const d2 = decide({ local: rm, remote: l, base, key, table: 'notes' })
      expect(d1.value).toEqual(d2.value)
      expect(d1.conflictCopy).toEqual(d2.conflictCopy)
    }
  })
})

describe('dedupe fixes (round 1)', () => {
  it('stamps derive from data only: any `now` and any order give byte-identical output', () => {
    const rows = [
      r('p1', '2025-01-01T00:00:00.000Z', { kind: 'k', active: true }),
      r('p2', '2025-02-01T00:00:00.000Z', { kind: 'k', active: true }),
      r('p3', '2025-03-01T00:00:00.000Z', { kind: 'k', active: true }),
    ]
    const ref = canonicalJson(dedupe('ai_prompts', rows))
    for (const sh of shuffles(rows)) expect(canonicalJson(dedupe('ai_prompts', sh))).toBe(ref)
    const out = dedupe('ai_prompts', rows).keep
    expect(out.find((x) => x.id === 'p1')!.updated_at).toBe('2025-03-01T00:00:00.001Z')
    expect(out.find((x) => x.id === 'p2')!.updated_at).toBe('2025-03-01T00:00:00.001Z')
    const notes = [
      r('n1', '2026-01-05T00:00:00.000Z', { notice_date: 'd' }),
      r('n2', '2026-01-02T00:00:00.000Z', { notice_date: 'd' }),
    ]
    const o = dedupe('notes', notes).keep.find((x) => x.id === 'n2')!
    expect(o.updated_at).toBe('2026-01-05T00:00:00.001Z'); expect('notice_date' in o).toBe(false)
  })
  it('conflict copy drops notice_date and pinned, keeps folder', () => {
    const base = rowHash(key, r('n', '0'))
    const l = r('n', '2', { notice_date: 'd', pinned: true, folder_id: 'f', t: 1 })
    const rm = r('n', '3', { notice_date: 'd', pinned: false, t: 2 })
    const c = decide({ local: l, remote: rm, base, key, table: 'notes' }).conflictCopy!
    expect('notice_date' in c).toBe(false); expect('pinned' in c).toBe(false); expect(c.folder_id).toBe('f')
    expect(c.id).toBe(`conflict:n:${rowHash(key, l).slice(0, 12)}`)
  })
  it('duplicate ids in input are rejected, not silently dropped', () => {
    expect(() => dedupe('attendance', [r('a', '1', { student_id: 's', date: 'd', kind: 'k' }), r('a', '2', { student_id: 's', date: 'd', kind: 'k' })])).toThrow()
  })
})
