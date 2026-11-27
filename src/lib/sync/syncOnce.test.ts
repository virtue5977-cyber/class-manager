// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { AppDB } from '../db/schema'
import { TEST_KEY, openTestVaultDb } from '../vault/testing'
import { GoogleApiError } from '../google/google'
import { mergeWrite, readRaw } from '../vault/middleware'
import { createDriveStore, type DriveStore } from './driveStore'
import { fakeDrive, type FakeDrive } from './fakeDrive'
import { getSyncState, setSyncState, isDirty, syncErrorText } from './state'
import { buildWsync, openWsync } from './wsync'
import { SYNC_TABLES } from './tables'
import { syncOnce, tombstoneGc, isCollectable, syncWarningText, decideRow, type SyncResult } from './syncOnce'
import { syncKeyFrom, rowHash } from './hash'
import { createClass, saveStudent, emptyStudent } from '../roster/roster'
import { createNote, saveNoteContent, deleteNote, attachFile, readFile } from '../notes/notes'
import { saveAttendance, type AttendanceInput } from '../attendance/attendance'
import { reconcileStudent, listReportsByStudent, getReportAttendanceIds } from '../absenceReports/reconcile'
import { addTodo } from '../todos/todos'
import type { NoteRec } from '../db/types'
import type { SyncRow } from './merge'

const DEK = TEST_KEY
const KEY_ID = 'k-test'
const DAY = 86_400_000
const sleep = (ms = 5) => new Promise((r) => setTimeout(r, ms))

interface PC { name: string; db: AppDB; sync: (o?: Partial<Parameters<typeof syncOnce>[0]>) => Promise<SyncResult> }
interface World { d: FakeDrive; store: DriveStore; root: string; pc: (name: string) => Promise<PC> }

async function world(): Promise<World> {
  let last = 0
  // 드라이브 시계: 실제 시각을 따르되 호출마다 늘어난다(같은 ms에 두 번 올려도 modifiedTime이 바뀌게).
  const d = fakeDrive({ now: () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString() } })
  const store = createDriveStore(d, { recheckDelayMs: 0 })
  const root = (await store.createRoot()).id
  const pc = async (name: string): Promise<PC> => {
    const db = openTestVaultDb(`sync-${name}-${crypto.randomUUID()}`)
    await setSyncState(db, { enabled: true, rootId: root, deviceName: name, firstMergeDone: true })
    return { name, db, sync: (o = {}) => syncOnce({ db, dek: DEK, keyId: KEY_ID, store, now: () => new Date(), deviceName: name, appVersion: '1.0.2', ...o }) }
  }
  return { d, store, root, pc }
}

const alive = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)
const att = (student_id: string, date: string, over: Partial<AttendanceInput> = {}): AttendanceInput => ({
  student_id, date, kind: '결석', category: '질병', period: null, reason: '감기', evidence_type: null, memo: '', ...over,
})
async function dump(db: AppDB): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const t of [...SYNC_TABLES, 'sync_rows', 'note_blobs']) out[t] = (await readRaw(db, t)).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
  return out
}
async function syncedView(db: AppDB): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const t of SYNC_TABLES) {
    out[t] = (await db.table(t).toArray()).map((r: Record<string, unknown>) => { const { data: _d, chunks: _c, ...rest } = r; return rest })
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
  }
  return out
}
async function setupClass(a: PC) {
  const c = await createClass(a.db, { school_year: 2026, grade: 1, class_no: 3 })
  const s = await saveStudent(a.db, c.id, emptyStudent(1, '가상학생'))
  return { c, s }
}
function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

describe('syncOnce', () => {
  test('켜지 않았으면 SYNC_NOT_ENABLED', async () => {
    const w = await world()
    const db = openTestVaultDb('sync-off-' + crypto.randomUUID())
    await expect(syncOnce({ db, dek: DEK, keyId: KEY_ID, store: w.store, now: () => new Date(), deviceName: 'x', appVersion: '1.0.2' })).rejects.toThrow('SYNC_NOT_ENABLED')
  })

  test('two-pc basic', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, 'A의 노트')
    const ra = await A.sync()
    expect(ra).toMatchObject({ ok: true, uploaded: 1 })
    const rb = await B.sync()
    expect(rb.ok).toBe(true)
    expect(rb.pulled).toBe(1)
    expect((await B.db.notes.get(n.id))?.title).toBe('A의 노트')
    // 반대 방향
    const t = await addTodo(B.db, ['B의 할 일'])
    expect((await B.sync()).uploaded).toBe(1)
    await A.sync()
    expect((await A.db.todos.get(t.id))?.parts).toEqual(['B의 할 일'])
    expect(await syncedView(A.db)).toEqual(await syncedView(B.db))
  })

  test('same-key attendance', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const { s } = await setupClass(A)
    await A.sync(); await B.sync()
    await saveAttendance(A.db, att(s.id, '2026-11-09', { reason: 'A가 씀' }))
    await sleep()
    await saveAttendance(B.db, att(s.id, '2026-11-09', { reason: 'B가 씀' }))
    for (let i = 0; i < 2; i++) { expect((await A.sync()).ok).toBe(true); expect((await B.sync()).ok).toBe(true) }
    const ra = await A.db.attendance.toArray(), rb = await B.db.attendance.toArray()
    expect(ra).toHaveLength(1)
    expect(rb).toEqual(ra)
    expect(ra[0].reason).toBe('B가 씀')
    expect(await syncedView(A.db)).toEqual(await syncedView(B.db))
  })

  test('same-key attendance: 신고서 연결은 이긴 출결로 다시 잇는다', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const { s } = await setupClass(A)
    await A.sync(); await B.sync()
    const a1 = await saveAttendance(A.db, att(s.id, '2026-11-09'))
    await reconcileStudent(A.db, s.id)
    await sleep()
    const b1 = await saveAttendance(B.db, att(s.id, '2026-11-09', { reason: '독감' }))
    await reconcileStudent(B.db, s.id)
    for (let i = 0; i < 3; i++) { await A.sync(); await B.sync() }
    for (const P of [A, B]) {
      expect((await P.db.attendance.toArray()).map((r) => r.id)).toEqual([b1.id])
      const reps = await listReportsByStudent(P.db, s.id)
      expect(reps).toHaveLength(1)
      expect(await getReportAttendanceIds(P.db, reps[0].id)).toEqual([b1.id])
      // 진 출결을 가리키는 살아 있는 연결이 없다
      expect(alive(await P.db.report_attendance.toArray()).some((l) => l.attendance_id === a1.id)).toBe(false)
    }
    expect(await syncedView(A.db)).toEqual(await syncedView(B.db))
  })

  test('note conflict copy', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '원래')
    await A.sync(); await B.sync()
    await saveNoteContent(A.db, n.id, { title: 'A가 고침', blocks: n.blocks })
    await sleep()
    await saveNoteContent(B.db, n.id, { title: 'B가 고침', blocks: n.blocks })
    for (let i = 0; i < 2; i++) { await A.sync(); await B.sync() }
    for (const P of [A, B]) {
      const notes = alive(await P.db.notes.toArray()) as NoteRec[]
      expect(notes).toHaveLength(2)
      expect((await P.db.notes.get(n.id))?.title).toBe('B가 고침')
      const copies = notes.filter((x) => x.id.startsWith('conflict:'))
      expect(copies).toHaveLength(1)
      expect(copies[0].title).toBe('A가 고침')
    }
    const ca = (await A.db.notes.toArray()).find((x) => x.id.startsWith('conflict:'))!.id
    const cb = (await B.db.notes.toArray()).find((x) => x.id.startsWith('conflict:'))!.id
    expect(ca).toBe(cb)
    expect(await syncedView(A.db)).toEqual(await syncedView(B.db))
  })

  test('tombstone', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '지울 노트')
    await A.sync(); await B.sync()
    const bId = (await getSyncState(B.db)).deviceId
    const bEntry = (await w.store.listDevices(w.root)).find((x) => x.deviceId === bId)!
    const oldB = w.d.bytesOf(bEntry.fileId)!.slice() // B의 옛 스냅숏(노트 살아 있음)
    await deleteNote(A.db, n.id)
    await A.sync()
    await B.sync()
    expect((await B.db.notes.get(n.id))?.deleted).toBe(true)
    // B의 옛 스냅숏이 다시 올라온다
    await w.store.uploadDevice(w.root, bId, oldB, bEntry.fileId)
    const r = await A.sync()
    expect(r.pulled).toBe(1)
    expect((await A.db.notes.get(n.id))?.deleted).toBe(true)
    await B.sync()
    expect((await B.db.notes.get(n.id))?.deleted).toBe(true)
  })

  test('지움과 고침이 엇갈리면 살아 있는 쪽으로 두 PC가 모인다(어느 쪽이 늦어도)', async () => {
    for (const deleteLater of [false, true]) {
      const w = await world()
      const A = await w.pc('A'), B = await w.pc('B')
      const n = await createNote(A.db, '원래')
      await A.sync(); await B.sync(); await A.sync()
      if (deleteLater) { await saveNoteContent(B.db, n.id, { title: 'B 고침', blocks: n.blocks }); await sleep(); await deleteNote(A.db, n.id) }
      else { await deleteNote(A.db, n.id); await sleep(); await saveNoteContent(B.db, n.id, { title: 'B 고침', blocks: n.blocks }) }
      for (let i = 0; i < 3; i++) { await A.sync(); await B.sync() }
      expect((await A.db.notes.get(n.id))?.title).toBe('B 고침')
      expect(await syncedView(A.db)).toEqual(await syncedView(B.db))
      expect(await A.sync()).toMatchObject({ uploaded: 0, merged: 0 })
      expect(await B.sync()).toMatchObject({ uploaded: 0, merged: 0 })
    }
  })

  test('늦게 올라온 세 번째 PC의 옛 스냅숏이 고침을 되돌리지 않는다', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B'), C = await w.pc('C')
    const n = await createNote(A.db, '처음')
    await A.sync(); await B.sync(); await C.sync(); await A.sync()
    await saveNoteContent(B.db, n.id, { title: 'B 고침', blocks: n.blocks })
    await B.sync()
    await A.sync()
    expect((await A.db.notes.get(n.id))?.title).toBe('B 고침')
    // C는 B의 고침을 보기 전에(목록 지연) 다른 것을 고쳐 올린다: C 스냅숏의 노트는 옛 값
    const cId = (await getSyncState(C.db)).deviceId
    const seenBefore = (await getSyncState(C.db)).seen
    await addTodo(C.db, ['C 할 일'])
    const bId = (await getSyncState(B.db)).deviceId
    await setSyncState(C.db, { seen: { ...seenBefore, [bId]: (await w.store.listDevices(w.root)).find((x) => x.deviceId === bId)!.modifiedTime } })
    await C.sync()
    expect((await C.db.notes.get(n.id))?.title).toBe('처음')
    void cId
    await A.sync()
    expect((await A.db.notes.get(n.id))?.title).toBe('B 고침')
    expect((await A.db.notes.toArray()).some((x) => x.id.startsWith('conflict:'))).toBe(false)
    // C가 나중에 B를 받으면 모두 같다
    await setSyncState(C.db, { seen: {} })
    for (let i = 0; i < 2; i++) { await C.sync(); await A.sync(); await B.sync() }
    expect(await syncedView(C.db)).toEqual(await syncedView(A.db))
    expect(await syncedView(B.db)).toEqual(await syncedView(A.db))
  })

  test('다른 PC에서 지운 첨부는 이 PC 내용도 비운다', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '첨부')
    const f = await attachFile(A.db, n.id, { name: 'a.bin', mime: 'application/octet-stream', bytes: new Uint8Array([9, 8, 7]) })
    await A.sync(); await B.sync()
    expect((await readFile(B.db, f.id)).bytes).toEqual(new Uint8Array([9, 8, 7]))
    await deleteNote(A.db, n.id)
    await A.sync(); await B.sync()
    expect((await B.db.note_files.get(f.id))?.deleted).toBe(true)
    expect(await readRaw(B.db, 'note_blobs')).toEqual([])
    const raw = (await readRaw(B.db, 'note_files'))[0]
    expect(raw.data ?? '').toBe('')
  })

  test('평문 DB는 SYNC_NEEDS_VAULT', async () => {
    const w = await world()
    const db = new AppDB('sync-plain-' + crypto.randomUUID())
    await setSyncState(db, { enabled: true, rootId: w.root })
    await expect(syncOnce({ db, dek: DEK, keyId: KEY_ID, store: w.store, now: () => new Date(), deviceName: 'x', appVersion: '1.0.2' })).rejects.toThrow('SYNC_NEEDS_VAULT')
  })

  test('C1 오래 쉰 PC가 돌아오면 합치지 않고 stale-self (지움 표시 정리 뒤 되살림 방지)', async () => {
    const w = await world()
    const X = await w.pc('X'), S = await w.pc('S')
    const n = await createNote(X.db, '지울 노트')
    await X.sync(); await S.sync(); await X.sync()
    await deleteNote(X.db, n.id)
    await X.sync()
    // 181일 뒤: S는 그동안 동기화하지 않았다(오래된 기기). X는 지움 표시를 정리한다.
    const later = () => new Date(Date.now() + 181 * DAY)
    const xId = (await getSyncState(X.db)).deviceId
    w.d.files.get((await w.store.listDevices(w.root)).find((x) => x.deviceId === xId)!.fileId)!.modifiedTime = new Date(Date.now() + 180 * DAY).toISOString()
    await setSyncState(X.db, { lastGc: undefined })
    await X.sync({ now: later })
    expect(await X.db.notes.get(n.id)).toBeUndefined()
    // S가 돌아온다: S에는 노트가 살아 있다
    const sId = (await getSyncState(S.db)).deviceId
    const sFile = (await w.store.listDevices(w.root)).find((x) => x.deviceId === sId)!
    const before = w.d.files.get(sFile.fileId)!.modifiedTime
    await createNote(S.db, 'S의 새 노트')
    const r = await S.sync({ now: later })
    expect(r).toMatchObject({ ok: false, error: 'stale-self', uploaded: 0, merged: 0 })
    expect((await getSyncState(S.db)).lastError?.code).toBe('stale-self')
    expect(syncErrorText('stale-self')).toContain('드라이브 자료로 바꾸기')
    expect(w.d.files.get(sFile.fileId)!.modifiedTime).toBe(before)
    await X.sync({ now: later })
    expect(await X.db.notes.get(n.id)).toBeUndefined()
  })

  test('C1 내 파일이 없어도 최근에 성공했으면 stale-self가 아니다(빠진 기기는 다시 올린다)', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    await A.sync(); await B.sync()
    const bId = (await getSyncState(B.db)).deviceId
    await w.store.deleteDevice((await w.store.listDevices(w.root)).find((x) => x.deviceId === bId)!.fileId)
    expect(await B.sync()).toMatchObject({ ok: true, uploaded: 1 })
    // 파일은 있고 lastOk가 없어도(옛 상태) 파일이 최근이면 된다
    await setSyncState(B.db, { lastOk: undefined })
    expect((await B.sync()).ok).toBe(true)
  })

  test('C2 합친 결과가 업로드 전에 실패해도 다음 번에 올린다', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '원래')
    await A.sync(); await B.sync(); await A.sync()
    await saveNoteContent(B.db, n.id, { title: 'B', blocks: n.blocks })
    await attachFile(B.db, n.id, { name: 'b.bin', mime: 'application/octet-stream', bytes: new Uint8Array([1]) })
    await B.sync()
    await sleep()
    await saveNoteContent(A.db, n.id, { title: 'A 늦게', blocks: n.blocks }) // A가 이긴다
    const failing = { ...w.store, downloadFile: async () => { throw new GoogleApiError(429, undefined, 'x') } }
    expect(await A.sync({ store: failing })).toMatchObject({ ok: false, error: 'rate', uploaded: 0 })
    expect((await A.db.notes.get(n.id))?.title).toBe('A 늦게')
    expect((await A.sync()).uploaded).toBe(1)
    await B.sync()
    expect((await B.db.notes.get(n.id))?.title).toBe('A 늦게')
  })

  test('C4 두 PC가 서로 못 보고 같은 노트를 고쳐 올리면 둘 다 같은 승자와 사본 하나', async () => {
    for (const aFirst of [true, false]) {
      const w = await world()
      const A = await w.pc('A'), B = await w.pc('B')
      const n = await createNote(A.db, 'W')
      await A.sync(); await B.sync(); await A.sync()
      await saveNoteContent(A.db, n.id, { title: 'A 고침', blocks: n.blocks })
      await sleep()
      await saveNoteContent(B.db, n.id, { title: 'B 고침', blocks: n.blocks })
      await sleep()
      // 겹친 실행: B는 A가 올리기 전에 기기 목록을 받았다(그 목록으로 진행) → 둘 다 상대의 새 스냅숏을 보기 전에 올린다
      const listing = await w.store.listDevices(w.root)
      expect((await A.sync()).uploaded).toBe(1)
      expect((await B.sync({ store: { ...w.store, listDevices: async () => listing } })).uploaded).toBe(1)
      const order = aFirst ? [A, B, A, B] : [B, A, B, A]
      for (const P of order) await P.sync()
      for (const P of [A, B]) {
        expect((await P.db.notes.get(n.id))?.title).toBe('B 고침')
        const copies = alive(await P.db.notes.toArray()).filter((x) => x.id.startsWith('conflict:'))
        expect(copies.map((c) => (c as NoteRec).title)).toEqual(['A 고침'])
      }
      expect(await syncedView(A.db)).toEqual(await syncedView(B.db))
    }
  })

  test('C4 시계가 5분 늦은 PC와 보통 주고받기는 사본을 만들지 않는다(3번 왕복)', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, 'W')
    await A.sync(); await B.sync(); await A.sync()
    const realNow = Date.now.bind(Date)
    const behind = async <T>(fn: () => Promise<T>): Promise<T> => {
      const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() - 5 * 60_000)
      try { return await fn() } finally { spy.mockRestore() }
    }
    for (let i = 0; i < 3; i++) {
      await saveNoteContent(A.db, n.id, { title: `A ${i}`, blocks: n.blocks })
      expect((await A.sync()).uploaded).toBe(1)
      await behind(() => B.sync())
      expect((await B.db.notes.get(n.id))?.title).toBe(`A ${i}`)
      await behind(() => saveNoteContent(B.db, n.id, { title: `B ${i}`, blocks: n.blocks }))
      expect((await behind(() => B.sync())).uploaded).toBe(1)
      const ra = await A.sync()
      expect(ra.conflicts).toBe(0)
      expect((await A.db.notes.get(n.id))?.title).toBe(`B ${i}`)
    }
    for (const P of [A, B]) expect((await P.db.notes.toArray()).some((x) => x.id.startsWith('conflict:'))).toBe(false)
  })

  test('C4 seen이 없는 옛 스냅숏이면 겹친 실행이라도 사본 없이 받는다', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, 'W')
    await A.sync(); await B.sync(); await A.sync()
    await saveNoteContent(A.db, n.id, { title: 'A 고침', blocks: n.blocks })
    await sleep()
    await saveNoteContent(B.db, n.id, { title: 'B 고침', blocks: n.blocks })
    await sleep()
    const bId = (await getSyncState(B.db)).deviceId
    const listing = await w.store.listDevices(w.root)
    await A.sync()
    await B.sync({ store: { ...w.store, listDevices: async () => listing } })
    // B의 스냅숏을 seen 칸이 없는 옛 판 모양으로 다시 쓴다
    const bEntry = (await w.store.listDevices(w.root)).find((x) => x.deviceId === bId)!
    const snap = await openWsync(w.d.bytesOf(bEntry.fileId)!, DEK, bId, KEY_ID)
    expect(snap.seen).toBeDefined()
    const old = await buildWsync({ dek: DEK, app: '1.0.1', deviceId: bId, deviceName: 'B', keyId: KEY_ID, at: snap.at, tables: snap.tables, extra: {} })
    await w.store.uploadDevice(w.root, bId, old, bEntry.fileId)
    const ra = await A.sync()
    expect(ra.conflicts).toBe(0)
    expect((await A.db.notes.get(n.id))?.title).toBe('B 고침')
    expect((await A.db.notes.toArray()).some((x) => x.id.startsWith('conflict:'))).toBe(false)
  })

  test('C4 올린 파일 시각을 못 읽으면 표시해 두고 다음 번 목록에서 채운다', async () => {
    const w = await world()
    const A = await w.pc('A')
    await createNote(A.db, 'n')
    const failing = { ...w.store, fileModifiedTime: async () => { throw new GoogleApiError(0, undefined, 'x') } }
    expect(await A.sync({ store: failing })).toMatchObject({ ok: true, uploaded: 1 })
    const ups = (await readRaw(A.db, 'sync_rows')).filter((r) => r.src === 'up')
    expect(ups.length).toBeGreaterThan(0)
    expect(ups.every((r) => r.upAt === 'pending')).toBe(true)
    expect((await getSyncState(A.db)).upAtPending).toBe(true)
    await A.sync()
    const aId = (await getSyncState(A.db)).deviceId
    const mt = (await w.store.listDevices(w.root)).find((x) => x.deviceId === aId)!.modifiedTime
    const after = (await readRaw(A.db, 'sync_rows')).filter((r) => r.src === 'up')
    expect(after.every((r) => r.upAt === mt)).toBe(true)
    expect((await getSyncState(A.db)).upAtPending).toBeFalsy()
  })

  test('stale device', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(B.db, 'B의 오래된 노트')
    await B.sync()
    const bId = (await getSyncState(B.db)).deviceId
    const f = w.d.files.get((await w.store.listDevices(w.root)).find((x) => x.deviceId === bId)!.fileId)!
    f.modifiedTime = new Date(Date.now() - 91 * DAY).toISOString()
    const r = await A.sync()
    expect(r.pulled).toBe(0)
    expect(await A.db.notes.get(n.id)).toBeUndefined()
    expect(r.warnings.some((x) => x.startsWith('stale-device:'))).toBe(true)
    expect((await getSyncState(A.db)).devices?.find((x) => x.deviceId === bId)?.stale).toBe(true)
  })

  test('no ping-pong', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    await createNote(A.db, '하나')
    await A.sync(); await B.sync(); await A.sync()
    const before = [await dump(A.db), await dump(B.db)]
    const ra = await A.sync(), rb = await B.sync()
    expect([ra.uploaded, ra.merged, rb.uploaded, rb.merged]).toEqual([0, 0, 0, 0])
    expect(await dump(A.db)).toEqual(before[0])
    expect(await dump(B.db)).toEqual(before[1])
    expect(await isDirty(A.db)).toBe(false)
    expect(await isDirty(B.db)).toBe(false)
  })

  test('no ping-pong after take, 받은 뒤 고쳐도 가짜 사본 없음', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '처음')
    await A.sync(); await B.sync(); await A.sync()
    await saveNoteContent(A.db, n.id, { title: 'A 고침', blocks: n.blocks })
    expect((await A.sync()).uploaded).toBe(1)
    const rb = await B.sync()
    expect(rb).toMatchObject({ uploaded: 0, merged: 1, conflicts: 0 })
    expect(await isDirty(B.db)).toBe(false)
    expect(await B.sync()).toMatchObject({ uploaded: 0, merged: 0 })
    expect(await A.sync()).toMatchObject({ uploaded: 0, merged: 0 })
    // B가 받은 노트를 고친다 → A는 충돌 없이 받는다
    await sleep()
    await saveNoteContent(B.db, n.id, { title: 'B 고침', blocks: n.blocks })
    expect((await B.sync()).uploaded).toBe(1)
    const ra = await A.sync()
    expect(ra.conflicts).toBe(0)
    expect((await A.db.notes.get(n.id))?.title).toBe('B 고침')
    expect((await A.db.notes.toArray()).some((x) => x.id.startsWith('conflict:'))).toBe(false)
  })

  test('skewed clock: 앞선 시계의 도장 아래로 찍힌 내 고침도 올린다', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    await A.sync(); await B.sync()
    const future = new Date(Date.now() + 3 * DAY).toISOString()
    const n = await createNote(B.db, 'B 미래 시계')
    await mergeWrite(B.db, [B.db.notes], async () => { await B.db.notes.put({ ...(await B.db.notes.get(n.id))!, updated_at: future }) })
    expect((await B.sync()).uploaded).toBe(1)
    const r = await A.sync()
    expect(r.merged).toBe(1)
    expect(await isDirty(A.db)).toBe(false)
    expect(((await getSyncState(A.db)).lastUploadedMax ?? '') < future).toBe(true)
    const t = await addTodo(A.db, ['A 지금 시계'])
    expect(t.updated_at < future).toBe(true)
    expect(await isDirty(A.db)).toBe(true)
    expect((await A.sync()).uploaded).toBe(1)
    await B.sync()
    expect(await B.db.todos.get(t.id)).toBeDefined()
  })

  test('abort mid-merge', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const { s } = await setupClass(A)
    await createNote(A.db, 'A 노트')
    await A.sync()
    await createNote(B.db, 'B 노트')
    const before = await dump(B.db)
    const stateBefore = await getSyncState(B.db)
    const spy = vi.spyOn(B.db.table('notes'), 'bulkPut').mockImplementation(() => { throw new Error('주입한 오류') })
    await expect(B.sync()).rejects.toThrow('주입한 오류')
    spy.mockRestore()
    expect(await dump(B.db)).toEqual(before)
    const st = await getSyncState(B.db)
    expect(st.seen).toEqual(stateBefore.seen)
    expect(st.lastError?.code).toBe('unknown')
    // 다음 동기화가 이어서 맞춘다
    expect((await B.sync()).ok).toBe(true)
    expect(await B.db.students.get(s.id)).toBeDefined()
    expect(alive(await B.db.notes.toArray())).toHaveLength(2)
  })

  test('upload fail', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '올릴 노트')
    const orig = w.d.uploadResumable
    w.d.uploadResumable = async () => ({ ok: false, status: 403, reason: 'storageQuotaExceeded' })
    const r = await A.sync()
    w.d.uploadResumable = orig
    expect(r).toMatchObject({ ok: false, error: 'storage', uploaded: 0 })
    expect((await getSyncState(A.db)).lastError?.code).toBe('storage')
    expect((await A.db.notes.get(n.id))?.title).toBe('올릴 노트')
    expect(await isDirty(A.db)).toBe(true)
    const r2 = await A.sync()
    expect(r2).toMatchObject({ ok: true, uploaded: 1 })
    expect((await getSyncState(A.db)).lastError).toBeNull()
    await B.sync()
    expect((await B.db.notes.get(n.id))?.title).toBe('올릴 노트')
  })

  test('upload fail after merge-only change still retries (pendingUpload)', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '원래')
    await A.sync(); await B.sync(); await A.sync()
    await saveNoteContent(A.db, n.id, { title: 'A', blocks: n.blocks })
    await sleep()
    await saveNoteContent(B.db, n.id, { title: 'B', blocks: n.blocks })
    await A.sync()
    // B: 충돌 → 사본을 만들고 올려야 하는데 업로드 실패
    const orig = w.d.uploadResumable
    w.d.uploadResumable = async () => ({ ok: false, status: 0 })
    expect(await B.sync()).toMatchObject({ ok: false, error: 'offline' })
    w.d.uploadResumable = orig
    expect((await B.sync()).uploaded).toBe(1)
    await A.sync()
    expect((await A.db.notes.toArray()).filter((x) => x.id.startsWith('conflict:'))).toHaveLength(1)
  })

  test('attachments', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '첨부 노트')
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31 + 7) & 0xff)
    const f = await attachFile(A.db, n.id, { name: '가상.pdf', mime: 'application/pdf', bytes })
    const ra = await A.sync()
    expect(ra.files.up).toBe(1)
    for (const b of w.d.allBytes()) expect(contains(b, bytes.subarray(0, 64))).toBe(false)
    const rb = await B.sync()
    expect(rb.files.down).toBe(1)
    expect((await readFile(B.db, f.id)).bytes).toEqual(bytes)
    // 다시 해도 또 받지 않는다
    expect((await B.sync()).files.down).toBe(0)
    expect((await A.sync()).files.up).toBe(0)
  })

  test('attachments: 드라이브에 없는 첨부는 경고만', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '첨부 노트')
    await attachFile(A.db, n.id, { name: 'x.bin', mime: 'application/octet-stream', bytes: new Uint8Array([1, 2, 3]) })
    await A.sync()
    for (const [id, file] of w.d.files) if (file.appProperties.watson === 'file') w.d.files.delete(id)
    const rb = await B.sync()
    expect(rb.ok).toBe(true)
    expect(rb.warnings).toContain('attachment-missing')
  })

  test('unknown table preserved', async () => {
    const w = await world()
    const A = await w.pc('A')
    const future = [{ id: 'f1', updated_at: '2026-11-01T00:00:00.000Z', v: '새 판의 자료' }]
    const bytes = await buildWsync({ dek: DEK, app: '1.1.0', deviceId: 'dev-B', deviceName: 'B', keyId: KEY_ID, at: new Date().toISOString(), tables: {}, extra: { future_table: future } })
    await w.store.uploadDevice(w.root, 'dev-B', bytes)
    await createNote(A.db, 'A')
    expect((await A.sync()).uploaded).toBe(1)
    const aId = (await getSyncState(A.db)).deviceId
    const entry = (await w.store.listDevices(w.root)).find((x) => x.deviceId === aId)!
    const snap = await openWsync(w.d.bytesOf(entry.fileId)!, DEK, aId, KEY_ID)
    expect(snap.extra.future_table).toEqual(future)
    // 다음 업로드에도 남는다
    await createNote(A.db, 'A2')
    await A.sync()
    const snap2 = await openWsync(w.d.bytesOf(entry.fileId)!, DEK, aId, KEY_ID)
    expect(snap2.extra.future_table).toEqual(future)
  })

  test('reports', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const { s } = await setupClass(A)
    await saveAttendance(A.db, att(s.id, '2026-11-09'))
    await saveAttendance(A.db, att(s.id, '2026-11-10'))
    await A.sync()
    await B.sync()
    const rb = await listReportsByStudent(B.db, s.id)
    expect(rb).toHaveLength(1)
    for (let i = 0; i < 2; i++) { await A.sync(); await B.sync() }
    expect(await listReportsByStudent(A.db, s.id)).toHaveLength(1)
    expect(await listReportsByStudent(B.db, s.id)).toHaveLength(1)
    expect((await B.db.absence_reports.toArray())).toHaveLength(1)
    expect(await syncedView(A.db)).toEqual(await syncedView(B.db))
    // 두 PC가 따로 맞춰도 하나
    await reconcileStudent(A.db, s.id)
    await reconcileStudent(B.db, s.id)
    for (let i = 0; i < 2; i++) { await A.sync(); await B.sync() }
    expect((await A.db.absence_reports.toArray())).toHaveLength(1)
  })

  test('class duplicate', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    await createClass(A.db, { school_year: 2026, grade: 2, class_no: 4 })
    await createClass(B.db, { school_year: 2026, grade: 2, class_no: 4 })
    await A.sync()
    const rb = await B.sync()
    await A.sync()
    expect(alive(await A.db.classes.toArray())).toHaveLength(2)
    expect(alive(await B.db.classes.toArray())).toHaveLength(2)
    expect(rb.warnings).toContain('class-duplicate')
    expect(syncWarningText('class-duplicate')).toContain('학급이 둘 생겼습니다')
  })

  test('keyId가 다르면 건너뛰고 경고', async () => {
    const w = await world()
    const A = await w.pc('A')
    const bytes = await buildWsync({ dek: DEK, app: '1.0.2', deviceId: 'dev-K', deviceName: 'K', keyId: 'other-key', at: new Date().toISOString(), tables: { notes: [{ id: 'nk', updated_at: '2026-11-01T00:00:00.000Z', title: 'x', blocks: [], deleted: false }] }, extra: {} })
    await w.store.uploadDevice(w.root, 'dev-K', bytes)
    const r = await A.sync()
    expect(r.ok).toBe(true)
    expect(r.pulled).toBe(0)
    expect(r.warnings).toContain('key-mismatch:dev-K')
    expect(await A.db.notes.get('nk')).toBeUndefined()
  })

  test('clock-ahead 경고', async () => {
    const w = await world()
    const A = await w.pc('A')
    const bytes = await buildWsync({ dek: DEK, app: '1.0.2', deviceId: 'dev-C', deviceName: 'C', keyId: KEY_ID, at: new Date(Date.now() + 2 * DAY).toISOString(), tables: {}, extra: {} })
    await w.store.uploadDevice(w.root, 'dev-C', bytes)
    expect((await A.sync()).warnings).toContain('clock-ahead:C')
  })

  test('root switch: 가장 오래된 루트로 옮기고 내 스냅숏을 다시 올린다', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    // B만 늦게 만든 다른 루트를 쓰고 있었다(첫 PC 경쟁의 결과)
    const newer = 'laterroot01'
    w.d.files.set(newer, { id: newer, parents: [], appProperties: { watson: 'root' }, createdTime: new Date(Date.now() + 60_000).toISOString(), modifiedTime: new Date().toISOString(), trashed: false })
    await setSyncState(B.db, { rootId: newer })
    const n = await createNote(B.db, 'B 노트')
    const rb = await B.sync()
    expect(rb).toMatchObject({ ok: true, uploaded: 1, rootSwitched: true })
    expect((await getSyncState(B.db)).rootId).toBe(w.root)
    expect(w.d.files.has(newer)).toBe(false)
    await A.sync()
    expect((await A.db.notes.get(n.id))?.title).toBe('B 노트')
  })

  test('root switch under list lag: losers가 비면 아무것도 지우지 않는다', async () => {
    const w = await world()
    const B = await w.pc('B')
    await setSyncState(B.db, { rootId: 'oldrootid01' })
    const deleteRoot = vi.fn(async () => {})
    const store = { ...w.store, deleteRoot, resolveRoot: async () => ({ rootId: w.root, switched: true, losers: [] as string[] }) }
    const r = await syncOnce({ db: B.db, dek: DEK, keyId: KEY_ID, store, now: () => new Date(), deviceName: 'B', appVersion: '1.0.2' })
    expect(r).toMatchObject({ ok: true, rootSwitched: true, uploaded: 1 })
    expect(deleteRoot).not.toHaveBeenCalled()
    const store2 = { ...w.store, deleteRoot, resolveRoot: async () => ({ rootId: w.root, switched: false, losers: ['loser00001'] }) }
    await syncOnce({ db: B.db, dek: DEK, keyId: KEY_ID, store: store2, now: () => new Date(), deviceName: 'B', appVersion: '1.0.2' })
    expect(deleteRoot).toHaveBeenCalledWith('loser00001')
    expect(deleteRoot).not.toHaveBeenCalledWith(w.root)
  })

  test('합치기 전 안전 백업은 하루 한 번', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const safetyBackup = vi.fn(async () => {})
    await createNote(A.db, '1')
    await A.sync()
    await B.sync({ safetyBackup })
    expect(safetyBackup).toHaveBeenCalledTimes(1)
    await createNote(A.db, '2')
    await A.sync()
    await B.sync({ safetyBackup })
    expect(safetyBackup).toHaveBeenCalledTimes(1)
    await createNote(A.db, '3')
    await A.sync()
    await B.sync({ safetyBackup, now: () => new Date(Date.now() + DAY + 1000) })
    expect(safetyBackup).toHaveBeenCalledTimes(2)
  })

  test('tombstone GC: 180일 지나고 활성 기기 모두에서 지워졌으면 하드 삭제', async () => {
    const w = await world()
    const A = await w.pc('A'), B = await w.pc('B')
    const n = await createNote(A.db, '지울 것')
    await A.sync(); await B.sync()
    await deleteNote(A.db, n.id)
    await A.sync()
    await B.sync({ now: () => new Date() })
    expect((await B.db.notes.get(n.id))?.deleted).toBe(true)
    // B가 지움 표시를 올리도록 한 번 더 고친다
    await addTodo(B.db, ['x'])
    await B.sync()
    // 179일 뒤: 아직
    const later = (d: number) => () => new Date(Date.now() + d * DAY)
    const bId = (await getSyncState(B.db)).deviceId
    const bf = w.d.files.get((await w.store.listDevices(w.root)).find((x) => x.deviceId === bId)!.fileId)!
    bf.modifiedTime = new Date(Date.now() + 170 * DAY).toISOString() // B는 활성
    const aId = (await getSyncState(A.db)).deviceId
    w.d.files.get((await w.store.listDevices(w.root)).find((x) => x.deviceId === aId)!.fileId)!.modifiedTime = new Date(Date.now() + 170 * DAY).toISOString() // A도 활성
    await setSyncState(A.db, { lastGc: undefined })
    await A.sync({ now: later(179) })
    expect(await A.db.notes.get(n.id)).toBeDefined()
    await setSyncState(A.db, { lastGc: undefined })
    await A.sync({ now: later(181) })
    expect(await A.db.notes.get(n.id)).toBeUndefined()
    // B의 지움 표시가 다시 와도 되살아나지 않는다(지움 표시도 다시 만들지 않는다)
    await addTodo(B.db, ['y'])
    await B.sync()
    bf.modifiedTime = new Date(Date.now() + 171 * DAY).toISOString()
    const r = await A.sync({ now: later(181) })
    expect(r.merged).toBe(1)
    expect(await A.db.notes.get(n.id)).toBeUndefined()
  })
})

describe('decideRow (순수)', () => {
  const key = syncKeyFrom(DEK)
  test('C4 내가 올린 base 위의 받기: 상대가 내 업로드를 봤는지(seen)로만 사본을 정한다', () => {
    const W = { id: 'n', updated_at: '2026-04-01T00:00:00.000Z', deleted: false, title: 'W' }
    const L = { ...W, title: 'L', updated_at: '2026-04-02T00:00:00.000Z' }
    const R = { ...W, title: 'R', updated_at: '2026-04-03T00:00:00.000Z' }
    const base = { hash: rowHash(key, L), at: L.updated_at, src: 'up' as const, upAt: '2026-04-02T00:01:00.000Z' }
    expect(decideRow(L, R, base, key, 'notes', '2026-04-02T00:01:00.000Z').kind).toBe('take') // 봤다
    expect(decideRow(L, R, base, key, 'notes', '2026-04-02T00:00:30.000Z').kind).toBe('conflict') // 내 업로드 전 것만 봤다
    expect(decideRow(L, R, base, key, 'notes', null).kind).toBe('conflict') // 나를 본 적 없다
    expect(decideRow(L, R, base, key, 'notes', undefined).kind).toBe('take') // 옛 스냅숏: 모름
    expect(decideRow(L, R, { ...base, upAt: 'pending' }, key, 'notes', null).kind).toBe('take')
    expect(decideRow(L, R, { ...base, src: 'merge' }, key, 'notes', null).kind).toBe('take')
    expect(decideRow(L, R, base, key, 'todos', null).kind).toBe('take')
    // 상대 시계가 늦어 R이 내 업로드 시각보다 이른 도장이어도, 봤으면 받기
    expect(decideRow(L, { ...R, updated_at: '2026-04-02T00:00:00.001Z' }, base, key, 'notes', '2026-04-02T00:01:00.000Z').kind).toBe('take')
  })
  test('C1b 로컬에 없고 base가 있으면 base.at 이하로 온 값은 받지 않는다(지움 표시 정리·진 행)', () => {
    const R = { id: 'n', updated_at: '2026-04-01T00:00:00.000Z', deleted: false, title: '옛 값' }
    const base = { hash: rowHash(key, { other: 1 }), at: '2026-05-01T00:00:00.000Z' }
    expect(decideRow(undefined, R, base, key, 'notes').kind).toBe('absent')
    expect(decideRow(undefined, { ...R, updated_at: base.at }, base, key, 'notes').kind).toBe('absent')
    expect(decideRow(undefined, { ...R, updated_at: '2026-06-01T00:00:00.000Z' }, base, key, 'notes').kind).toBe('take')
    expect(decideRow(undefined, R, undefined, key, 'notes').kind).toBe('take')
  })
  test('같은 도장이면 받지 않는다(stale)', () => {
    const W = { id: 'n', updated_at: '2026-04-01T00:00:00.000Z', deleted: false, title: 'W' }
    const L = { ...W, title: 'L', updated_at: '2026-04-02T00:00:00.000Z' }
    const R = { ...W, title: 'R', updated_at: L.updated_at }
    expect(decideRow(L, R, { hash: rowHash(key, L) }, key, 'todos').kind).toBe('stale')
  })
})

describe('tombstoneGc (순수)', () => {
  const now = new Date('2027-01-01T00:00:00.000Z')
  const old = '2026-06-01T00:00:00.000Z' // 214일 전
  const young = '2026-12-01T00:00:00.000Z'
  const r = (id: string, updated_at: string, deleted: boolean): SyncRow => ({ id, updated_at, deleted })
  test('isCollectable', () => {
    expect(isCollectable(r('a', old, true), now, [])).toBe(true)
    expect(isCollectable(r('a', old, false), now, [])).toBe(false)
    expect(isCollectable(r('a', young, true), now, [])).toBe(false)
    expect(isCollectable(r('a', old, true), now, [undefined, r('a', old, true)])).toBe(true)
    expect(isCollectable(r('a', old, true), now, [r('a', young, false)])).toBe(false)
    expect(isCollectable(r('a', 'garbage', true), now, [])).toBe(false)
    // C3 기본값 행은 지우면 다시 심어지므로 정리하지 않는다
    expect(isCollectable(r('phrase-default-3', old, true), now, [])).toBe(false)
    expect(isCollectable(r('goodtext-default-0', old, true), now, [])).toBe(false)
    expect(tombstoneGc({ reflection_phrases: [r('phrase-default-1', old, true), r('p-x', old, true)] }, [], now)).toEqual({ reflection_phrases: ['p-x'] })
  })
  test('지울 행 목록 고정', () => {
    const local = {
      notes: [r('n1', old, true), r('n2', old, true), r('n3', young, true), r('n4', old, false), r('n5', old, true)],
      attendance: [r('a1', old, true), r('a2', old, true)],
    }
    const peers = [
      { notes: [r('n2', old, false), r('n5', old, true)], attendance: [r('a1', old, true)] },
      { notes: [r('n1', old, true)] },
    ]
    expect(tombstoneGc(local, peers, now)).toEqual({ notes: ['n1', 'n5'], attendance: ['a1', 'a2'] })
  })
})
