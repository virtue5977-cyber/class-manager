import { openTestVaultDb } from '../vault/testing'
import { readRaw } from '../vault/middleware'
import { attachFile, cleanupOrphanFiles, createNote, readFile, MAX_TOTAL } from './notes'
import { exportSnapshot, importSnapshot } from '../backup/snapshot'
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
  await expect(exportSnapshot(db)).rejects.toThrow(/big/)
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
