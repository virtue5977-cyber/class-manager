import { describe, it, expect } from 'vitest'
import { buildWsync, openWsync, sealFile, openFile, gzip, gunzip } from './wsync'
import { encryptBytes } from '../vault/rowCrypto'
import { canonicalJson } from '../vault/canon'

const dek = new Uint8Array(32).fill(7)
const base = { dek, app: '1.0.1', deviceId: 'dev-A', deviceName: 'PC A', keyId: 'k1', at: '2026-01-05T00:00:00.000Z' }
const row = (id: string, updated_at: string, x: Record<string, unknown> = {}) => ({ id, updated_at, ...x })
async function sealJson(obj: unknown, deviceId = 'dev-A'): Promise<Uint8Array> {
  return encryptBytes(dek, await gzip(new TextEncoder().encode(canonicalJson(obj))), 'watson-sync:v1:' + deviceId)
}

describe('wsync', () => {
  it('round-trips and computes maxUpdated', async () => {
    const tables = { students: [row('s1', '2026-01-01T00:00:00.000Z', { name: 'a', unknown_col: { z: 1 } }), row('s2', '2026-01-03T00:00:00.000Z', { bin: new Uint8Array([1, 2]) })] }
    const bytes = await buildWsync({ ...base, tables, extra: {} })
    expect(bytes[0]).toBe(1)
    const snap = await openWsync(bytes, dek, 'dev-A')
    expect(snap).toMatchObject({ fmt: 1, app: '1.0.1', deviceId: 'dev-A', deviceName: 'PC A', keyId: 'k1', at: base.at, maxUpdated: '2026-01-03T00:00:00.000Z', extra: {} })
    expect(snap.tables.students).toEqual(tables.students)
  })
  it('maxUpdated is empty with no rows and ignores extra tables', async () => {
    const snap = await openWsync(await buildWsync({ ...base, tables: {}, extra: { future_table: [row('f', '2999-01-01T00:00:00.000Z')] } }), dek, 'dev-A')
    expect(snap.maxUpdated).toBe('')
  })
  it('fails with BAD_SNAPSHOT on other deviceId, wrong key, garbage', async () => {
    const bytes = await buildWsync({ ...base, tables: {}, extra: {} })
    await expect(openWsync(bytes, dek, 'dev-B')).rejects.toThrow('BAD_SNAPSHOT')
    await expect(openWsync(bytes, new Uint8Array(32).fill(9), 'dev-A')).rejects.toThrow('BAD_SNAPSHOT')
    await expect(openWsync(new Uint8Array([1, 2, 3]), dek, 'dev-A')).rejects.toThrow('BAD_SNAPSHOT')
  })
  it('fmt 2 gives NEWER_FORMAT', async () => {
    const bytes = await sealJson({ fmt: 2, whatever: true })
    await expect(openWsync(bytes, dek, 'dev-A')).rejects.toThrow('NEWER_FORMAT')
  })
  it('bad shape gives BAD_SNAPSHOT without leaking contents', async () => {
    for (const o of [{ fmt: 1 }, { ...{ fmt: 1, app: 'a', deviceId: 'd', deviceName: 'n', at: 't', keyId: 'k', maxUpdated: '' }, tables: [] }, 5]) {
      const err = await openWsync(await sealJson(o), dek, 'dev-A').catch((e) => e)
      expect(err.message).toBe('BAD_SNAPSHOT')
    }
  })
  it('preserves unknown tables: opened into extra, rewritten under tables', async () => {
    const future = [row('f1', '2026-02-01T00:00:00.000Z', { v: 1 })]
    const first = await buildWsync({ ...base, tables: { students: [row('s', '2026-01-01T00:00:00.000Z')] }, extra: { future_table: future } })
    // raw check: unknown table sits among top-level tables keys
    const raw = JSON.parse(new TextDecoder().decode(await gunzip(
      (await import('../vault/rowCrypto')).decryptBytes(dek, first, 'watson-sync:v1:dev-A'))))
    expect(Object.keys(raw.tables).sort()).toEqual(['future_table', 'students'])
    const snap = await openWsync(first, dek, 'dev-A')
    expect(snap.extra).toEqual({ future_table: future })
    expect(snap.tables.future_table).toBeUndefined()
    const second = await openWsync(await buildWsync({ ...base, tables: snap.tables, extra: snap.extra }), dek, 'dev-A')
    expect(second.extra).toEqual({ future_table: future })
    expect(second.tables).toEqual(snap.tables)
  })
  it('rejects extra that collides with a known table', async () => {
    await expect(buildWsync({ ...base, tables: {}, extra: { students: [] } })).rejects.toThrow()
  })
  it('gzip shrinks a 1MB row batch', async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => row('id' + i, '2026-01-01T00:00:00.000Z', { name: 'student name ' + i, memo: 'x'.repeat(200) }))
    expect(canonicalJson({ rows }).length).toBeGreaterThan(1_000_000)
    const bytes = await buildWsync({ ...base, tables: { students: rows }, extra: {} })
    expect(bytes.length).toBeLessThan(canonicalJson({ rows }).length / 4)
    expect((await openWsync(bytes, dek, 'dev-A')).tables.students).toHaveLength(4000)
  })
})

describe('wsync fixes', () => {
  const hdr = { fmt: 1, app: 'a', deviceId: 'dev-A', deviceName: 'n', at: 't', keyId: 'k1', maxUpdated: '', tables: {} }
  it('rejects inner deviceId differing from argument', async () => {
    const bytes = await sealJson({ ...hdr, deviceId: 'dev-X' })
    await expect(openWsync(bytes, dek, 'dev-A')).rejects.toThrow('BAD_SNAPSHOT')
  })
  it('rejects empty keyId', async () => {
    await expect(openWsync(await sealJson({ ...hdr, keyId: '' }), dek, 'dev-A')).rejects.toThrow('BAD_SNAPSHOT')
  })
  it('KEY_MISMATCH only when expectedKeyId given and differs', async () => {
    const bytes = await sealJson(hdr)
    await expect(openWsync(bytes, dek, 'dev-A', 'k1')).resolves.toMatchObject({ keyId: 'k1' })
    await expect(openWsync(bytes, dek, 'dev-A')).resolves.toBeTruthy()
    await expect(openWsync(bytes, dek, 'dev-A', 'k2')).rejects.toThrow('KEY_MISMATCH')
  })
  it('valid AEAD around invalid gzip gives BAD_SNAPSHOT, no unhandled rejection', async () => {
    const un: unknown[] = []
    const h = (e: unknown) => un.push(e)
    process.on('unhandledRejection', h)
    const bytes = encryptBytes(dek, new TextEncoder().encode('not gzip at all'), 'watson-sync:v1:dev-A')
    await expect(openWsync(bytes, dek, 'dev-A')).rejects.toThrow('BAD_SNAPSHOT')
    await new Promise((r) => setTimeout(r, 50))
    process.off('unhandledRejection', h)
    expect(un).toEqual([])
  })
  it('__proto__ table round-trips via extra without polluting', async () => {
    const extra = Object.create(null) as Record<string, unknown>
    extra['__proto__'] = [{ id: 'p', updated_at: 'x' }]
    const snap = await openWsync(await buildWsync({ ...base, tables: {}, extra }), dek, 'dev-A')
    expect(Object.keys(snap.extra)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(snap.extra)).toBeNull()
    expect(Object.getPrototypeOf(snap.tables)).toBeNull()
    expect(({} as Record<string, unknown>).id).toBeUndefined()
    const again = await openWsync(await buildWsync({ ...base, tables: snap.tables, extra: snap.extra }), dek, 'dev-A')
    expect(Object.keys(again.extra)).toEqual(['__proto__'])
  })
  it('Uint8Array inside extra round-trips', async () => {
    const extra = { future: [{ id: 'f', updated_at: 'x', blob: new Uint8Array([9, 8, 7]) }] }
    const snap = await openWsync(await buildWsync({ ...base, tables: {}, extra }), dek, 'dev-A')
    expect((snap.extra.future as any)[0].blob).toEqual(new Uint8Array([9, 8, 7]))
  })
  it('fmt 1.5 / 0 is BAD_SNAPSHOT, fmt 2 NEWER_FORMAT', async () => {
    for (const f of [1.5, 0]) await expect(openWsync(await sealJson({ ...hdr, fmt: f }), dek, 'dev-A')).rejects.toThrow('BAD_SNAPSHOT')
    await expect(openWsync(await sealJson({ ...hdr, fmt: 2 }), dek, 'dev-A')).rejects.toThrow('NEWER_FORMAT')
  })
  it('wfile errors become BAD_FILE', () => {
    const sealed = sealFile(dek, 'b1', new Uint8Array([1]))
    expect(() => openFile(dek, 'b2', sealed)).toThrow('BAD_FILE')
    expect(() => openFile(dek, 'b1', new Uint8Array(3))).toThrow('BAD_FILE')
    expect(() => sealFile(new Uint8Array(5), 'b', new Uint8Array(1))).toThrow('BAD_FILE')
  })
})

describe('wfile', () => {
  it('round-trips, aad binds blobId', async () => {
    const data = new Uint8Array([0, 1, 2, 250, 255])
    const sealed = sealFile(dek, 'b1', data)
    expect(sealed[0]).toBe(1)
    expect(openFile(dek, 'b1', sealed)).toEqual(data)
    expect(() => openFile(dek, 'b2', sealed)).toThrow('BAD_FILE')
  })
})
