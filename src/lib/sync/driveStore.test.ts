// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { createDriveStore, type KeyFile } from './driveStore'
import { fakeDrive } from './fakeDrive'
import { GoogleApiError } from '../google/google'

const require = createRequire(import.meta.url)
/* eslint-disable @typescript-eslint/no-explicit-any */
const G = require('../../../electron/googleApi.cjs') as any

const kf: KeyFile = { v: 1, keyId: 'k1', salt: 's', iter: 600000, iv: 'iv', ct: 'ct', check: 'chk', updatedAt: '2026-01-01T00:00:00Z' }
const B = (...n: number[]) => new Uint8Array(n)

describe('driveStore', () => {
  test('루트가 없으면 null', async () => {
    expect(await createDriveStore(fakeDrive()).findRoot()).toBeNull()
  })
  test('만들기 → 찾기', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 })
    const { id, created } = await s.createRoot()
    expect(created).toBe(true)
    const r = await s.findRoot()
    expect(r?.id).toBe(id)
    expect(r?.createdTime).toMatch(/^2026/)
    expect(d.files.get(id)?.appProperties).toEqual({ watson: 'root' })
    expect(d.files.get(id)?.mimeType).toBe('application/vnd.google-apps.folder')
  })
  test('둘 이상이면 가장 오래된 루트', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 })
    const a = (await s.createRoot()).id
    d.files.set('zzzzzzzzzzzz', { id: 'zzzzzzzzzzzz', parents: [], appProperties: { watson: 'root' }, createdTime: '2027-01-01T00:00:00Z', modifiedTime: '2027-01-01T00:00:00Z', trashed: false })
    expect((await s.findRoot())?.id).toBe(a)
  })
  test('두 PC가 동시에 만들면 같은 루트, 남은 루트는 하나', async () => {
    const d = fakeDrive()
    const [ra, rb] = await Promise.all([createDriveStore(d, { recheckDelayMs: 0 }).createRoot(), createDriveStore(d, { recheckDelayMs: 0 }).createRoot()])
    const a = ra.id
    expect(a).toBe(rb.id)
    expect([ra.created, rb.created].sort()).toEqual([false, true])
    const roots = [...d.files.values()].filter((f) => f.appProperties.watson === 'root')
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe(a)
  })
  test('열쇠 파일 왕복, 덮어쓰기는 한 파일', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    expect(await s.readKeyFile(root)).toBeNull()
    await s.writeKeyFile(root, kf)
    expect(await s.readKeyFile(root)).toEqual(kf)
    await expect(s.writeKeyFile(root, { ...kf, keyId: 'k2' })).rejects.toThrow('KEY_EXISTS')
    await s.writeKeyFile(root, { ...kf, keyId: 'k2' }, { expectKeyId: 'k1' })
    expect((await s.readKeyFile(root))?.keyId).toBe('k2')
    expect([...d.files.values()].filter((f) => f.appProperties.watson === 'key')).toHaveLength(1)
  })
  test('기기 목록과 modifiedTime, 고쳐 올리기', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    expect(await s.listDevices(root)).toEqual([])
    const f1 = await s.uploadDevice(root, 'dev-a', B(1, 2))
    await s.uploadDevice(root, 'dev-b', B(3))
    let l = await s.listDevices(root)
    expect(l.map((x) => x.deviceId)).toEqual(['dev-a', 'dev-b'])
    const before = l[0].modifiedTime
    expect(await s.uploadDevice(root, 'dev-a', B(9), f1)).toBe(f1)
    l = await s.listDevices(root)
    expect(l).toHaveLength(2)
    expect(l.find((x) => x.deviceId === 'dev-a')!.modifiedTime > before).toBe(true)
    expect(await s.downloadDevice(f1)).toEqual(B(9))
    await s.deleteDevice(f1)
    expect((await s.listDevices(root)).map((x) => x.deviceId)).toEqual(['dev-b'])
  })
  test('fileId 없이 두 번 올려도 기기 파일은 하나', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    await s.uploadDevice(root, 'dev-a', B(1)); await s.uploadDevice(root, 'dev-a', B(2))
    expect(await s.listDevices(root)).toHaveLength(1)
  })
  test('기기 목록은 쪽을 넘겨 모두 읽는다', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { pageSize: 2, recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    for (let i = 0; i < 5; i++) await s.uploadDevice(root, 'dev-' + i, B(i))
    expect(await s.listDevices(root)).toHaveLength(5)
    expect(d.calls.some((c) => c.includes('pageToken='))).toBe(true)
  })
  test('첨부 있음·없음', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    expect(await s.hasFile(root, 'blob1')).toBe(false)
    await s.uploadFile(root, 'blob1', B(7, 7))
    expect(await s.hasFile(root, 'blob1')).toBe(true)
    expect(await s.hasFile(root, 'blob2')).toBe(false)
    expect(await s.downloadFile(root, 'blob1')).toEqual(B(7, 7))
    await expect(s.downloadFile(root, 'blob2')).rejects.toBeInstanceOf(Error)
  })
  test('이상한 id는 거부(질의 주입 방지)', async () => {
    const s = createDriveStore(fakeDrive())
    await expect(s.hasFile('rootrootroot', "x' or 1=1")).rejects.toThrow()
  })
  test('403 storageQuotaExceeded가 GoogleApiError로', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    d.failNext({ status: 403, reason: 'storageQuotaExceeded' })
    const e = await s.uploadDevice(root, 'dev-a', B(1)).catch((x) => x)
    expect(e).toBeInstanceOf(GoogleApiError)
    expect(e.status).toBe(403); expect(e.reason).toBe('storageQuotaExceeded')
    d.failNext({ status: 403, reason: 'storageQuotaExceeded' })
    await expect(s.createRoot().then((r) => r.id)).rejects.toMatchObject({ status: 403, reason: 'storageQuotaExceeded' })
  })
  test('쓴 모든 api 주소가 exe 허용 목록을 통과한다', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { pageSize: 1, recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    await s.writeKeyFile(root, kf); await s.readKeyFile(root)
    const f = await s.uploadDevice(root, 'dev-a', B(1)); await s.uploadDevice(root, 'dev-b', B(1))
    await s.listDevices(root); await s.hasFile(root, 'b1'); await s.uploadFile(root, 'b1', B(1)); await s.deleteDevice(f)
    const urls = d.calls.filter((c) => /^(GET|POST|PATCH|DELETE) /.test(c)).map((c) => c.split(' ')[1])
    expect(urls.length).toBeGreaterThan(5)
    for (const u of urls) expect(G.normalizeApiUrl(u), u).toMatchObject({ ok: true })
    for (const c of d.calls) { const m = /^(?:UPDATE|DOWNLOAD) (.+)$/.exec(c); if (m) expect(m[1]).toMatch(/^[A-Za-z0-9_-]{10,200}$/) }
  })

  test('경쟁에서 진 PC는 created:false이고 이긴 PC의 열쇠 파일을 못 덮는다', async () => {
    const d = fakeDrive()
    const [a, b] = [createDriveStore(d, { recheckDelayMs: 0 }), createDriveStore(d, { recheckDelayMs: 0 })]
    const [ra, rb] = await Promise.all([a.createRoot(), b.createRoot()])
    const [win, lose] = ra.created ? [ra, rb] : [rb, ra]
    expect(lose.created).toBe(false)
    await (ra.created ? a : b).writeKeyFile(win.id, kf)
    await expect((ra.created ? b : a).writeKeyFile(win.id, { ...kf, keyId: 'other' }, { expectKeyId: null })).rejects.toThrow('KEY_EXISTS')
    expect((await a.readKeyFile(win.id))?.keyId).toBe('k1')
    await (ra.created ? b : a).writeKeyFile(win.id, { ...kf, keyId: 'forced' }, { force: true })
    expect((await a.readKeyFile(win.id))?.keyId).toBe('forced')
  })
  test('resolveRoot: 늦게 보이는 목록에서도 나중에 가장 오래된 루트로 모인다', async () => {
    const d = fakeDrive()
    const s = createDriveStore(d, { recheckDelayMs: 0 })
    d.lagLists(3)
    const x = await s.createRoot() // 목록이 늦어서 자기 것만 보이지 않음 → 일단 이김
    expect(x.created).toBe(true)
    const old = d.files.get(x.id)!
    // 더 오래된 루트(다른 PC)가 있었다고 친다
    d.files.set('olderolderolder', { id: 'olderolderolder', parents: [], appProperties: { watson: 'root' }, createdTime: '2000-01-01T00:00:00Z', modifiedTime: '2000-01-01T00:00:00Z', trashed: false })
    expect(old.createdTime > '2000').toBe(true)
    let r = await s.resolveRoot(x.id)
    for (let i = 0; i < 5 && !r.losers.length; i++) r = await s.resolveRoot(x.id)
    expect(r).toEqual({ rootId: 'olderolderolder', switched: true, losers: [x.id] })
    await s.deleteRoot(x.id)
    await s.deleteRoot(x.id) // 이미 없어도 성공
    expect(await s.resolveRoot('olderolderolder')).toEqual({ rootId: 'olderolderolder', switched: false, losers: [] })
  })
  test('createRoot가 늦은 목록 때문에 놓친 더 오래된 루트를 재확인에서 잡는다', async () => {
    const d = fakeDrive()
    const s = createDriveStore(d, { recheckDelayMs: 0 })
    const real = d.api.bind(d)
    let lists = 0
    d.api = async (m, u, b, o) => {
      if (m === 'GET' && u.startsWith('/drive/v3/files?') && ++lists === 2) d.files.set('olderolderolder', { id: 'olderolderolder', parents: [], appProperties: { watson: 'root' }, createdTime: '2000-01-01T00:00:00Z', modifiedTime: '2000-01-01T00:00:00Z', trashed: false })
      return real(m, u, b, o)
    }
    const r = await s.createRoot()
    expect(r).toEqual({ id: 'olderolderolder', created: false })
  })
  test('deleteDevice는 404를 성공으로 본다', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 })
    await s.deleteDevice('nonexistentfile1')
  })
  test('폴더를 지우면 안의 파일도 같이 지워진다(가짜 드라이브)', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    await s.uploadDevice(root, 'dev-a', B(1))
    await s.deleteRoot(root)
    expect(d.files.size).toBe(0)
  })
  test('listFileIds: 첨부 id 집합을 한 번에', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { pageSize: 2, recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    for (const b of ['b1', 'b2', 'b3']) await s.uploadFile(root, b, B(1))
    await s.uploadDevice(root, 'dev-a', B(1))
    expect(await s.listFileIds(root)).toEqual(new Set(['b1', 'b2', 'b3']))
  })
  test('쪽 넘김이 같은 토큰을 되풀이하면 던진다', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    d.api = async () => ({ status: 200, json: { files: [], nextPageToken: 'same' } })
    await expect(s.listDevices(root)).rejects.toThrow('PAGING_LOOP')
  })
  test('readKeyFile은 모양을 검사하고 새 객체로 돌려준다', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { recheckDelayMs: 0 }); const root = (await s.createRoot()).id
    const put = async (text: string) => { await s.writeKeyFile(root, kf, { force: true }); const id = [...d.files.values()].find((f) => f.appProperties.watson === 'key')!.id; d.files.get(id)!.bytes = new TextEncoder().encode(text) }
    await put(JSON.stringify({ ...kf, extra: 1 }))
    expect(await s.readKeyFile(root)).toEqual(kf)
    await put('{"__proto__":{"x":1},"v":1,"keyId":"k","salt":"s","iter":600000,"iv":"i","ct":"c","check":"h","updatedAt":"u"}')
    const r = (await s.readKeyFile(root)) as object
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
    expect((r as Record<string, unknown>).x).toBeUndefined()
    for (const bad of [{ ...kf, v: 2 }, { ...kf, iter: 5 }, { ...kf, iter: 1.5 }, { ...kf, iter: 1e9 }, { ...kf, ct: 3 }, { ...kf, check: undefined }, [], 'x', null])
      { await put(JSON.stringify(bad)); await expect(s.readKeyFile(root), JSON.stringify(bad)).rejects.toThrow('BAD_KEY_FILE') }
    await put('not json'); await expect(s.readKeyFile(root)).rejects.toThrow('BAD_KEY_FILE')
  })
})
