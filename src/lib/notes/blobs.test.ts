import { openTestVaultDb } from '../vault/testing'
import { readRaw } from '../vault/middleware'
import { attachFile, cleanupOrphanFiles, createNote, readFile, MAX_TOTAL } from './notes'
import { exportSnapshot, exportSnapshotReport, importSnapshot } from '../backup/snapshot'
import { runBackupReport, setupPassphrase } from '../backup/service'
import { createMemoryFolder } from '../fs/memory'
import { b64ToBytes, b64ToBytesYielding, bytesToB64, bytesToB64Yielding, openBlobRows, blobIds } from './blobs'
import { blobCrypto } from '../vault/vaultDb'
import { AppDB } from '../db/schema'

const bytesOf = (n: number) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 31 + 7) & 0xff; return u }
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

test('blobCrypto: 암호화 DB만 열쇠를 갖고, 열거되지 않는다', () => {
  const v = openTestVaultDb()
  expect(blobCrypto(v)).not.toBeNull()
  expect(blobCrypto(new AppDB('p-' + crypto.randomUUID()))).toBeNull()
  expect(Object.keys(v).join()).not.toMatch(/dek/i)
})

test('첨부 저장 → readFile 같음, note_files 행에 data 칸 없음', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  const bytes = bytesOf(1000)
  const f = await attachFile(db, n.id, { name: 'a.bin', mime: 'x/y', bytes })
  expect((await readFile(db, f.id)).bytes).toEqual(bytes)
  const row = await db.note_files.get(f.id)
  expect('data' in row!).toBe(false)
  expect((await readRaw(db, 'note_blobs')).map((r) => r.id)).toEqual([f.id])
})

test('exportSnapshot data가 원본 base64, importSnapshot 왕복', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  const bytes = bytesOf(5000)
  const f = await attachFile(db, n.id, { name: 'a.bin', mime: '', bytes })
  const snap = await exportSnapshot(db)
  expect((snap.tables.note_files[0] as { data: string }).data).toBe(b64(bytes))
  expect(snap.tables).not.toHaveProperty('note_blobs')
  const db2 = openTestVaultDb()
  await importSnapshot(db2, snap)
  expect((await readFile(db2, f.id)).bytes).toEqual(bytes)
  expect('data' in (await db2.note_files.get(f.id))!).toBe(false)
  // 평문 DB로도 들여올 수 있다
  const p = new AppDB('p-' + crypto.randomUUID())
  await importSnapshot(p, snap)
  expect((await readFile(p, f.id)).bytes).toEqual(bytes)
})

test('cleanupOrphanFiles가 note_blobs도 비운다(조각 포함)', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  await attachFile(db, n.id, { name: 'small', mime: '', bytes: bytesOf(100) })
  await attachFile(db, n.id, { name: 'big', mime: '', bytes: bytesOf(8 * 1024 * 1024 + 1) })
  expect((await readRaw(db, 'note_blobs')).length).toBe(1 + 9)
  expect(await cleanupOrphanFiles(db, Date.now() + 2 * 86_400_000)).toBe(2)
  expect(await readRaw(db, 'note_blobs')).toEqual([])
})

test('9MB 파일 → note_blobs 9행, 같음, 원본 앞 64바이트가 어디에도 없음, 조각 손상은 오류', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  const bytes = bytesOf(9 * 1024 * 1024)
  const f = await attachFile(db, n.id, { name: 'big', mime: '', bytes })
  expect((await db.note_files.get(f.id))!.chunks).toBe(9)
  const raw = await readRaw(db, 'note_blobs')
  expect(raw.length).toBe(9)
  expect(raw.map((r) => r.id).sort()).toEqual(Array.from({ length: 9 }, (_, i) => `${f.id}#${i}`).sort())
  const head = Buffer.from(bytes.subarray(0, 64))
  for (const r of raw) expect(Buffer.from(r._enc as Uint8Array).includes(head)).toBe(false)
  expect(Buffer.from((await readFile(db, f.id)).bytes).equals(Buffer.from(bytes))).toBe(true)
  const r3 = raw.find((r) => r.id === `${f.id}#3`)!
  const bad = (r3._enc as Uint8Array).slice(); bad[bad.length - 1] ^= 1
  await db.note_blobs.put({ id: r3.id as string, _enc: bad })
  await expect(readFile(db, f.id)).rejects.toThrow('첨부가 손상되었습니다')
  // spec §5.4: 내보내기는 손상된 첨부(조각 하나라도)를 행째 빼고 계속한다
  const rep = await exportSnapshotReport(db)
  expect(rep.skipped).toBe(1)
  expect((rep.snapshot.tables.note_files as { id: string }[]).map((x) => x.id)).not.toContain(f.id)
  await db.note_blobs.delete(`${f.id}#5`)
  await expect(readFile(db, f.id)).rejects.toThrow('첨부가 손상되었습니다')
}, 60000)

test('150MB 한도는 note_files size 합으로 센다', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  await db.note_files.add({ id: 'x', note_id: n.id, name: 'x', mime: '', size: MAX_TOTAL - 10, created_at: '', updated_at: '', deleted: false } as never)
  await expect(attachFile(db, n.id, { name: 'y', mime: '', bytes: bytesOf(11) })).rejects.toThrow('150MB')
  await attachFile(db, n.id, { name: 'y', mime: '', bytes: bytesOf(10) })
})

test('0바이트 첨부: 내보내기 → 새 vault로 들여오기 → readFile 빈 바이트, 다시 내보내기 가능', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  const f = await attachFile(db, n.id, { name: 'empty', mime: '', bytes: new Uint8Array(0) })
  const snap = await exportSnapshot(db)
  expect((snap.tables.note_files[0] as { data: string }).data).toBe('')
  const db2 = openTestVaultDb()
  await importSnapshot(db2, snap)
  expect((await readFile(db2, f.id)).bytes).toEqual(new Uint8Array(0))
  await expect(exportSnapshot(db2)).resolves.toBeTruthy()
})

test('평문 백업의 0바이트 파일을 vault로 들여오기', async () => {
  const p = new AppDB('p-' + crypto.randomUUID())
  const n = await createNote(p)
  const f = await attachFile(p, n.id, { name: 'empty', mime: '', bytes: new Uint8Array(0) })
  const snap = await exportSnapshot(p)
  const v = openTestVaultDb()
  await importSnapshot(v, snap)
  expect((await readFile(v, f.id)).bytes.length).toBe(0)
  await expect(exportSnapshot(v)).resolves.toBeTruthy()
})

test('조각 base64(양보): 조각 경계 앞뒤 길이에서 한 번에 바꾼 것과 같다', async () => {
  for (const n of [0, 1, 2, 3, 11, 12, 13, 24, 25, 100]) {
    const u = bytesOf(n)
    expect(await bytesToB64Yielding(u, 12)).toBe(bytesToB64(u))
    const b = bytesToB64(u)
    expect(await b64ToBytesYielding(b, 12)).toEqual(b64ToBytes(b))
  }
  // 표준 base64가 아니면(줄바꿈 등) 한 번에 푼다
  const wrapped = bytesToB64(bytesOf(60)).replace(/(.{16})/g, '$1\n')
  expect(await b64ToBytesYielding(wrapped, 12)).toEqual(b64ToBytes(wrapped))
})

test('openBlobRows: 조각 사이 양보해도 같은 바이트, 행이 빠지면 손상 오류', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  const bytes = bytesOf(8 * 1024 * 1024 + 5)
  const f = await attachFile(db, n.id, { name: 'big', mime: '', bytes })
  const rec = (await db.note_files.get(f.id))!
  const rows = await db.note_blobs.bulkGet(blobIds(rec))
  expect(Buffer.from(await openBlobRows(db, rec, rows, { yieldBetween: true })).equals(Buffer.from(bytes))).toBe(true)
  await expect(openBlobRows(db, rec, rows.slice(1), { yieldBetween: true })).rejects.toThrow('첨부가 손상되었습니다')
  await expect(openBlobRows(db, rec, [undefined, ...rows.slice(1)])).rejects.toThrow('첨부가 손상되었습니다')
  // 백업: 묶음 안에서 행만 읽고 밖에서 푼다 → 조각 파일도 원본 base64
  const snap = await exportSnapshot(db)
  expect((snap.tables.note_files.find((x) => (x as { id: string }).id === f.id) as { data: string }).data).toBe(b64(bytes))
}, 60000)

test('exportSnapshot: 손상된 첨부 하나는 빼고(행째) 나머지는 그대로, 뺀 수를 알린다', async () => {
  const db = openTestVaultDb()
  const n = await createNote(db)
  const good1 = await attachFile(db, n.id, { name: 'a.bin', mime: 'x/y', bytes: bytesOf(100) })
  const bad = await attachFile(db, n.id, { name: 'b.bin', mime: 'x/y', bytes: bytesOf(200) })
  const good2 = await attachFile(db, n.id, { name: 'c.bin', mime: 'x/y', bytes: bytesOf(300) })
  const raw = (await readRaw(db, 'note_blobs')).find((r) => r.id === bad.id)!
  const broken = (raw._enc as Uint8Array).slice(); broken[broken.length - 1] ^= 1
  await db.note_blobs.put({ id: bad.id, _enc: broken })
  const { snapshot, skipped } = await exportSnapshotReport(db)
  expect(skipped).toBe(1)
  const files = snapshot.tables.note_files as { id: string; data: string }[]
  expect(files.map((f) => f.id).sort()).toEqual([good1.id, good2.id].sort())
  expect(files.find((f) => f.id === good1.id)!.data).toBe(b64(bytesOf(100)))
  expect(files.find((f) => f.id === good2.id)!.data).toBe(b64(bytesOf(300)))
  expect(Object.keys(files[0]).sort()).not.toContain('broken') // 백업 형식 2에 새 칸 없음
  await expect(exportSnapshot(db)).resolves.toBeTruthy() // 예전처럼 통째로 멈추지 않는다
})

test('runBackupReport: 손상된 첨부가 있어도 백업하고 안내 문구를 돌려준다', async () => {
  const db = openTestVaultDb()
  await setupPassphrase(db, '가상시험암호구2026', { iterations: 1000 })
  const n = await createNote(db)
  const bad = await attachFile(db, n.id, { name: 'b.bin', mime: 'x/y', bytes: bytesOf(200) })
  const raw = (await readRaw(db, 'note_blobs')).find((r) => r.id === bad.id)!
  await db.note_blobs.put({ id: bad.id, _enc: (raw._enc as Uint8Array).slice(0, 10) })
  const folder = createMemoryFolder()
  const r = await runBackupReport(db, folder)
  expect(r.skipped).toBe(1)
  expect(r.warning).toBe('첨부 1개가 손상되어 백업에서 빠졌습니다')
  expect(folder.files.has(r.name)).toBe(true)
})
