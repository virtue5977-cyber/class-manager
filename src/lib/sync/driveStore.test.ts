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
    const d = fakeDrive(); const s = createDriveStore(d)
    const id = await s.createRoot()
    const r = await s.findRoot()
    expect(r?.id).toBe(id)
    expect(r?.createdTime).toMatch(/^2026/)
    expect(d.files.get(id)?.appProperties).toEqual({ watson: 'root' })
    expect(d.files.get(id)?.mimeType).toBe('application/vnd.google-apps.folder')
  })
  test('둘 이상이면 가장 오래된 루트', async () => {
    const d = fakeDrive(); const s = createDriveStore(d)
    const a = await s.createRoot()
    d.files.set('zzzzzzzzzzzz', { id: 'zzzzzzzzzzzz', parents: [], appProperties: { watson: 'root' }, createdTime: '2027-01-01T00:00:00Z', modifiedTime: '2027-01-01T00:00:00Z', trashed: false })
    expect((await s.findRoot())?.id).toBe(a)
  })
  test('두 PC가 동시에 만들면 같은 루트, 남은 루트는 하나', async () => {
    const d = fakeDrive()
    const [a, b] = await Promise.all([createDriveStore(d).createRoot(), createDriveStore(d).createRoot()])
    expect(a).toBe(b)
    const roots = [...d.files.values()].filter((f) => f.appProperties.watson === 'root')
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe(a)
  })
  test('열쇠 파일 왕복, 덮어쓰기는 한 파일', async () => {
    const d = fakeDrive(); const s = createDriveStore(d); const root = await s.createRoot()
    expect(await s.readKeyFile(root)).toBeNull()
    await s.writeKeyFile(root, kf)
    expect(await s.readKeyFile(root)).toEqual(kf)
    await s.writeKeyFile(root, { ...kf, keyId: 'k2' })
    expect((await s.readKeyFile(root))?.keyId).toBe('k2')
    expect([...d.files.values()].filter((f) => f.appProperties.watson === 'key')).toHaveLength(1)
  })
  test('기기 목록과 modifiedTime, 고쳐 올리기', async () => {
    const d = fakeDrive(); const s = createDriveStore(d); const root = await s.createRoot()
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
    const d = fakeDrive(); const s = createDriveStore(d); const root = await s.createRoot()
    await s.uploadDevice(root, 'dev-a', B(1)); await s.uploadDevice(root, 'dev-a', B(2))
    expect(await s.listDevices(root)).toHaveLength(1)
  })
  test('기기 목록은 쪽을 넘겨 모두 읽는다', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { pageSize: 2 }); const root = await s.createRoot()
    for (let i = 0; i < 5; i++) await s.uploadDevice(root, 'dev-' + i, B(i))
    expect(await s.listDevices(root)).toHaveLength(5)
    expect(d.calls.some((c) => c.includes('pageToken='))).toBe(true)
  })
  test('첨부 있음·없음', async () => {
    const d = fakeDrive(); const s = createDriveStore(d); const root = await s.createRoot()
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
    const d = fakeDrive(); const s = createDriveStore(d); const root = await s.createRoot()
    d.failNext({ status: 403, reason: 'storageQuotaExceeded' })
    const e = await s.uploadDevice(root, 'dev-a', B(1)).catch((x) => x)
    expect(e).toBeInstanceOf(GoogleApiError)
    expect(e.status).toBe(403); expect(e.reason).toBe('storageQuotaExceeded')
    d.failNext({ status: 403, reason: 'storageQuotaExceeded' })
    await expect(s.createRoot()).rejects.toMatchObject({ status: 403, reason: 'storageQuotaExceeded' })
  })
  test('쓴 모든 api 주소가 exe 허용 목록을 통과한다', async () => {
    const d = fakeDrive(); const s = createDriveStore(d, { pageSize: 1 }); const root = await s.createRoot()
    await s.writeKeyFile(root, kf); await s.readKeyFile(root)
    const f = await s.uploadDevice(root, 'dev-a', B(1)); await s.uploadDevice(root, 'dev-b', B(1))
    await s.listDevices(root); await s.hasFile(root, 'b1'); await s.uploadFile(root, 'b1', B(1)); await s.deleteDevice(f)
    const urls = d.calls.filter((c) => /^(GET|POST|PATCH|DELETE) /.test(c)).map((c) => c.split(' ')[1])
    expect(urls.length).toBeGreaterThan(5)
    for (const u of urls) expect(G.normalizeApiUrl(u), u).toMatchObject({ ok: true })
    for (const c of d.calls) { const m = /^(?:UPDATE|DOWNLOAD) (.+)$/.exec(c); if (m) expect(m[1]).toMatch(/^[A-Za-z0-9_-]{10,200}$/) }
  })
})
