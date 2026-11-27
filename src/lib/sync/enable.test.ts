// @vitest-environment node
import Dexie from 'dexie'
import { describe, expect, test } from 'vitest'
import type { AppDB } from '../db/schema'
import { openVaultDb } from '../vault/vaultDb'
import { markComplete } from '../vault/migrate'
import { buildVaultPayload, dbNameFor, newDek, passKeyRaw, unwrapDek, verifyMetaCheck, type VaultPayload } from '../vault/keys'
import { fromBase64 } from '../backup/crypto'
import { getCachedKey, runBackup, storeBackupKey, restoreFromBytes } from '../backup/service'
import { createMemoryFolder } from '../fs/memory'
import type { PublicVault } from '../desktop/bridge'
import { createDriveStore, type DriveStore } from './driveStore'
import { fakeDrive, type FakeDrive } from './fakeDrive'
import { getSyncState, isDirty, setSyncState } from './state'
import { syncOnce } from './syncOnce'
import { createClass, saveStudent, emptyStudent } from '../roster/roster'
import { createNote, attachFile, readFile } from '../notes/notes'
import { saveAttendance } from '../attendance/attendance'
import {
  applyNewPass, checkKeyChange, disconnect, enableSync, firstMerge, recreateKeyFile, removeDevice, replaceWithDrive, rewrapKeyFile,
  ENABLE_ERROR_TEXT, NO_ROOT_TEXT, OLD_BACKUP_NOTICE, type EnableResult, type VaultAccess,
} from './enable'

const ITER = 100_000
const PASS_A = '가상교사암호구A-2026'
const PASS_B = '가상교사암호구B-2026'
const PASS_NEW = '새로정한가상암호구-2026'

interface PC {
  name: string
  db: AppDB
  dek: Uint8Array
  keyId: string
  pass: string
  stored: VaultPayload[]
  vault: VaultAccess & { now(): PublicVault }
  store: DriveStore
}

const publicOf = (p: VaultPayload): PublicVault => {
  const { dekB64: _d, ...rest } = p
  void _d
  return rest as PublicVault
}

function world() {
  let last = 0
  const d: FakeDrive = fakeDrive({ now: () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString() } })
  const store = createDriveStore(d, { recheckDelayMs: 0 })
  const pc = async (name: string, pass: string, over: { storeFails?: 'before' | 'after'; statusFails?: boolean } = {}): Promise<PC> => {
    const { dek, keyId } = newDek()
    const db = openVaultDb(`pc-${name}-${crypto.randomUUID()}`, dek)
    await db.open()
    await markComplete(db, dek, keyId)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const raw = await passKeyRaw(pass, salt, ITER)
    await storeBackupKey(db, { salt, iter: ITER, raw })
    let cur = publicOf(buildVaultPayload({ keyId, dek, passRaw: raw, passSalt: salt, passIter: ITER }))
    const stored: VaultPayload[] = []
    const vault = {
      now: () => cur,
      current: () => cur,
      store: async (p: VaultPayload) => {
        if (over.storeFails === 'before') throw new Error('저장 실패(가상)')
        stored.push(p)
        cur = publicOf(p)
        if (over.storeFails === 'after') throw new Error('저장 응답 실패(가상)')
        return true
      },
      status: async () => {
        if (over.statusFails) throw new Error('상태 실패(가상)')
        return { state: 'ok' as const, vault: cur }
      },
    }
    return { name, db, dek, keyId, pass, stored, vault, store }
  }
  return { d, store, pc }
}

const enable = (p: PC, o: Partial<Parameters<typeof enableSync>[0]> = {}) =>
  enableSync({ db: p.db, dek: p.dek, keyId: p.keyId, vault: p.vault, store: p.store, deviceName: p.name, passphrase: p.pass, appVersion: '1.0.2', ...o })

async function seed(p: PC, label: string) {
  const c = await createClass(p.db, { school_year: 2026, grade: 1, class_no: label === 'A' ? 1 : 2 })
  const s = await saveStudent(p.db, c.id, emptyStudent(1, `가상학생${label}`))
  return { c, s }
}

const exists = (name: string) => Dexie.exists(name)
const kindOf = (r: EnableResult) => r.kind

describe('enableSync — 첫 PC', () => {
  test('첫 PC → 열쇠 파일과 기기 파일이 생긴다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    const r = await enable(a)
    expect(r.kind).toBe('first-done')
    const root = (await w.store.findRoot())!.id
    const kf = (await w.store.readKeyFile(root))!
    expect(kf.keyId).toBe(a.keyId)
    // 열쇠 파일은 vault pass와 같은 감싸기(같은 salt·iter)이고 암호구로 풀린다
    expect(kf.salt).toBe(a.vault.now().pass.salt)
    expect(kf.iter).toBe(a.vault.now().pass.iter)
    const dek = unwrapDek(kf, await passKeyRaw(PASS_A, fromBase64(kf.salt), kf.iter), kf.keyId, 'pass')
    expect(dek).toEqual(a.dek)
    const st = await getSyncState(a.db)
    expect(st).toMatchObject({ enabled: true, rootId: root, firstMergeDone: true, keyUpdatedAt: kf.updatedAt })
    const devs = await w.store.listDevices(root)
    expect(devs.map((x) => x.deviceId)).toEqual([st.deviceId])
  })

  test('첫 PC, 틀린 암호구 → 드라이브에 아무것도 만들지 않는다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    const r = await enable(a, { passphrase: '틀린가상암호구입니다' })
    expect(r).toEqual({ kind: 'error', code: 'wrong-pass' })
    expect(w.d.files.size).toBe(0)
    expect((await getSyncState(a.db)).enabled).toBe(false)
  })

  test('first-PC race: 루트를 만들었는데 더 오래된 루트가 있으면 두 번째 PC 길', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    const b = await w.pc('B', PASS_B)
    // B의 첫 목록에는 A의 루트가 안 보인다(목록 지연)
    const lagged: DriveStore = { ...w.store, findRoot: async () => null }
    const r = await enable(b, { store: lagged })
    expect(r.kind).toBe('need-drive-pass')
    const roots = [...w.d.files.values()].filter((f) => f.appProperties.watson === 'root' && !f.trashed)
    expect(roots).toHaveLength(1)
  })

  test('루트가 안 보이는데 이 PC가 동기화한 적이 있다 → no-root-visible(구글 연결 설정 안내)', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await setSyncState(a.db, { rootId: 'someOldRootId123' })
    const r = await enable(a)
    expect(r).toEqual({ kind: 'error', code: 'no-root-visible' })
    expect(w.d.files.size).toBe(0)
    expect(NO_ROOT_TEXT).toBe('다른 PC와 같은 구글 연결 설정(google-client.json)을 써야 드라이브 자료가 보입니다')
    expect(ENABLE_ERROR_TEXT['no-root-visible']).toContain('google-client.json')
    // 확인을 받으면 새로 만든다
    expect((await enable(a, { confirmNewRoot: true })).kind).toBe('first-done')
  })
})

describe('enableSync — 두 번째 PC', () => {
  test('두 번째 PC, 같은 keyId → 바로 합친다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    await enable(a)
    // B: 같은 열쇠(같은 DEK·keyId)를 가진 PC(예: 연결을 끊었다가 다시 켬)
    const b0 = await w.pc('B', PASS_A)
    const db = openVaultDb(`pc-B2-${crypto.randomUUID()}`, a.dek)
    await db.open()
    await markComplete(db, a.dek, a.keyId)
    await storeBackupKey(db, { salt: fromBase64(a.vault.now().pass.salt), iter: ITER, raw: await passKeyRaw(PASS_A, fromBase64(a.vault.now().pass.salt), ITER) })
    const b: PC = { ...b0, db, dek: a.dek, keyId: a.keyId, vault: { ...b0.vault, now: () => a.vault.now(), current: () => a.vault.now() } }
    await seed(b, 'B')
    const r = await enable(b)
    expect(r.kind).toBe('second-same-key')
    if (r.kind !== 'second-same-key') return
    expect(r.counts).toEqual({ local: { classes: 1, students: 1, records: 0, notes: 0 }, drive: { classes: 1, students: 1, records: 0, notes: 0 } })
    expect(r.passChanged).toBe(false)
    expect(b.stored).toHaveLength(0)
    const st = await getSyncState(b.db)
    expect(st).toMatchObject({ enabled: true, firstMergeDone: false })
    const res = await firstMerge({ db: b.db, dek: b.dek, keyId: b.keyId, store: w.store, deviceName: 'B', appVersion: '1.0.2', choice: 'merge' })
    expect(res.ok).toBe(true)
    expect((await b.db.classes.toArray()).filter((c) => !c.deleted)).toHaveLength(2)
    expect((await getSyncState(b.db)).firstMergeDone).toBe(true)
  })

  test('두 번째 PC, 다른 keyId → 새 DB로 다시 암호화, 자료가 같다, vault가 새 keyId', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    await enable(a)
    const b = await w.pc('B', PASS_B)
    const { s } = await seed(b, 'B')
    const n = await createNote(b.db, '가상 노트')
    await attachFile(b.db, n.id, { name: '가상.txt', mime: 'text/plain', bytes: new TextEncoder().encode('가상 첨부 내용 0123456789') })
    await saveAttendance(b.db, { student_id: s.id, date: '2026-03-04', kind: '결석', category: '질병', period: null, reason: '가상', evidence_type: null, memo: '' })
    const oldName = b.db.name
    const before = await b.db.students.toArray()

    expect(await enable(b)).toEqual({ kind: 'need-drive-pass' })
    expect(b.stored).toHaveLength(0)

    const r = await enable(b, { drivePass: PASS_A })
    expect(r.kind).toBe('second-rekeyed')
    if (r.kind !== 'second-rekeyed') return
    expect(r.dbName).toBe(dbNameFor(a.keyId))
    expect(r.keyId).toBe(a.keyId)
    expect(r.recoveryCode).toMatch(/^[2-9A-Z]{5}(-[2-9A-Z]{5}){4}$/)
    expect(r.oldDeleted).toBe(true)
    expect(r.notice).toBe(OLD_BACKUP_NOTICE)
    expect(r.counts.local).toEqual({ classes: 1, students: 1, records: 0, notes: 1 })
    expect(r.counts.drive!.classes).toBe(1)
    // vault는 새 keyId·새 DB, pass는 드라이브 암호구로 풀린다
    expect(b.stored).toHaveLength(1)
    const v = b.stored[0]
    expect(v.keyId).toBe(a.keyId)
    expect(v.dbName).toBe(dbNameFor(a.keyId))
    expect(unwrapDek(v.pass, await passKeyRaw(PASS_A, fromBase64(v.pass.salt), v.pass.iter), a.keyId, 'pass')).toEqual(a.dek)
    expect(v.recovery).toBeTruthy()
    // 옛 DB는 지워졌다
    expect(await exists(oldName)).toBe(false)
    // 새 DB: 자료가 같다, 완료 행, 백업 열쇠 = 드라이브 암호구
    const ndb = openVaultDb(r.dbName, a.dek)
    await ndb.open()
    expect(verifyMetaCheck(a.dek, a.keyId, await ndb.meta.get('vault'))).toBe(true)
    expect(await ndb.meta.get('rekey')).toBeUndefined()
    expect(await ndb.students.toArray()).toEqual(before)
    const f = (await ndb.note_files.toArray())[0]
    expect(new TextDecoder().decode((await readFile(ndb, f.id)).bytes)).toBe('가상 첨부 내용 0123456789')
    expect((await getCachedKey(ndb))!.salt).toEqual(fromBase64(v.pass.salt))
    expect(await getSyncState(ndb)).toMatchObject({ enabled: true, firstMergeDone: false })
    // 처음 합치기(합치기) → 양쪽 자료
    const res = await firstMerge({ db: ndb, dek: a.dek, keyId: a.keyId, store: w.store, deviceName: 'B', appVersion: '1.0.2', choice: 'merge' })
    expect(res.ok).toBe(true)
    expect((await ndb.classes.toArray()).filter((c) => !c.deleted)).toHaveLength(2)
    ndb.close()
  })

  test('틀린 드라이브 암호구 → 아무것도 바뀌지 않는다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    const b = await w.pc('B', PASS_B)
    await seed(b, 'B')
    const filesBefore = w.d.files.size
    const r = await enable(b, { drivePass: '틀린드라이브암호구' })
    expect(r).toEqual({ kind: 'error', code: 'wrong-drive-pass' })
    expect(ENABLE_ERROR_TEXT['wrong-drive-pass']).toBe('드라이브 암호구가 맞지 않습니다')
    expect(b.stored).toHaveLength(0)
    expect(await exists(b.db.name)).toBe(true)
    expect(await exists(dbNameFor(a.keyId))).toBe(false)
    expect((await getSyncState(b.db)).enabled).toBe(false)
    expect(w.d.files.size).toBe(filesBefore)
  })

  test('rekey interrupted: 복사 도중 예외 → 옛 vault·옛 DB 그대로, 새 DB 지워짐', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    const b = await w.pc('B', PASS_B)
    await seed(b, 'B')
    const before = await b.db.students.toArray()
    const r = await enable(b, { drivePass: PASS_A, onProgress: (p) => { if (p.table === 'students') throw new Error('꺼짐(가상)') } })
    expect(r).toEqual({ kind: 'error', code: 'rekey-failed' })
    expect(b.stored).toHaveLength(0)
    expect(await exists(dbNameFor(a.keyId))).toBe(false)
    expect(b.db.isOpen()).toBe(true)
    expect(await b.db.students.toArray()).toEqual(before)
    expect((await getSyncState(b.db)).enabled).toBe(false)
    // 다시 하면 된다
    expect((await enable(b, { drivePass: PASS_A })).kind).toBe('second-rekeyed')
  })

  test('rekey interrupted: vault 저장이 실패했고 상태로 옛 열쇠가 확인되면 새 DB를 지운다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    const b = await w.pc('B', PASS_B, { storeFails: 'before' })
    await seed(b, 'B')
    const r = await enable(b, { drivePass: PASS_A })
    expect(r).toEqual({ kind: 'error', code: 'store-failed' })
    expect(await exists(dbNameFor(a.keyId))).toBe(false)
    expect(await exists(b.db.name)).toBe(true)
  })

  test('rekey interrupted: 저장 결과를 알 수 없으면 두 DB를 다 남기고, 다음 시도가 남은 새 DB를 치우고 이어 한다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    const b = await w.pc('B', PASS_B, { storeFails: 'before', statusFails: true })
    await seed(b, 'B')
    const r = await enable(b, { drivePass: PASS_A })
    expect(r).toEqual({ kind: 'error', code: 'store-uncertain' })
    expect(await exists(dbNameFor(a.keyId))).toBe(true) // 완료된 새 DB(vault가 가리킬 수도 있다)
    expect(await exists(b.db.name)).toBe(true)
    // vault는 여전히 옛 것(저장 안 됨) → 다시 켜기: 남은 새 DB(옛 DB에서 만든 표시)를 지우고 다시 복사
    const b2: PC = { ...b, vault: { ...b.vault, store: async (p) => { b.stored.push(p); return true }, status: async () => ({ state: 'ok' as const, vault: b.vault.now() }) } }
    expect((await enable(b2, { drivePass: PASS_A })).kind).toBe('second-rekeyed')
  })

  test('새 DB 이름에 표시 없는 다른 DB가 있으면 건드리지 않는다(target-exists)', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    const other = openVaultDb(dbNameFor(a.keyId), a.dek)
    await other.open()
    await other.classes.add({ id: 'cx', school_year: 2025, grade: 1, class_no: 1, created_at: '', updated_at: '', deleted: false } as never)
    other.close()
    const b = await w.pc('B', PASS_B)
    const r = await enable(b, { drivePass: PASS_A })
    expect(r).toEqual({ kind: 'error', code: 'target-exists' })
    const again = openVaultDb(dbNameFor(a.keyId), a.dek)
    expect(await again.classes.count()).toBe(1)
    again.close()
  })

  test('열쇠 파일이 없어짐 → recreate-key, 확인 뒤 recreateKeyFile', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    for (const [id, f] of w.d.files) if (f.appProperties.watson === 'key') w.d.files.delete(id)
    const b = await w.pc('B', PASS_B)
    expect(await enable(b)).toEqual({ kind: 'recreate-key' })
    expect(b.stored).toHaveLength(0)
    // A 쪽에서는 열쇠 파일이 없다고 알린다
    expect(await checkKeyChange({ db: a.db, store: w.store, keyId: a.keyId, vault: a.vault.now() })).toMatchObject({ needPass: false, missing: true })
    const r = await recreateKeyFile({ db: b.db, dek: b.dek, keyId: b.keyId, vault: b.vault, store: w.store, deviceName: 'B', passphrase: PASS_B, appVersion: '1.0.2' })
    expect(r.kind).toBe('second-same-key')
    const root = (await w.store.findRoot())!.id
    expect((await w.store.readKeyFile(root))!.keyId).toBe(b.keyId)
    // 다른 열쇠로 다시 만들어졌다 → A는 다시 켜야 한다
    expect(await checkKeyChange({ db: a.db, store: w.store, keyId: a.keyId, vault: a.vault.now() })).toMatchObject({ rekey: true })
  })
})

describe('열쇠 바뀜', () => {
  async function pair() {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    await enable(a)
    const b = await w.pc('B', PASS_B)
    const r = await enable(b, { drivePass: PASS_A })
    if (r.kind !== 'second-rekeyed') throw new Error('rekey expected')
    const ndb = openVaultDb(r.dbName, a.dek)
    await ndb.open()
    const bb: PC = { ...b, db: ndb, dek: a.dek, keyId: a.keyId }
    return { w, a, b: bb }
  }

  test('다른 PC가 암호구를 바꿈 → needPass, 새 암호구 입력 후 열쇠 파일과 vault pass가 같다', async () => {
    const { w, a, b } = await pair()
    expect(await checkKeyChange({ db: b.db, store: w.store, keyId: b.keyId, vault: b.vault.now() })).toMatchObject({ needPass: false })
    // A에서 암호구 바꾸기(VaultRewrapContext 길): 열쇠 파일을 먼저 바꾼다
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const k = { salt, iter: ITER, raw: await passKeyRaw(PASS_NEW, salt, ITER) }
    const at = await rewrapKeyFile({ db: a.db, store: w.store, dek: a.dek, keyId: a.keyId, k })
    expect(at).toBeTruthy()
    // 나머지 암호구 바꾸기(VaultGate rewrap의 vault.store → changePassphrase의 backupKeyRaw)
    await a.vault.store(buildVaultPayload({ keyId: a.keyId, dek: a.dek, passRaw: k.raw, passSalt: salt, passIter: ITER }))
    await storeBackupKey(a.db, k)
    // A 자신에게는 묻지 않고 keyUpdatedAt만 맞춘다
    expect(await checkKeyChange({ db: a.db, store: w.store, keyId: a.keyId, vault: a.vault.now() })).toMatchObject({ needPass: false })
    expect((await getSyncState(a.db)).keyUpdatedAt).toBe(at)

    expect(await checkKeyChange({ db: b.db, store: w.store, keyId: b.keyId, vault: b.vault.now() })).toMatchObject({ needPass: true })
    await expect(applyNewPass({ db: b.db, store: w.store, dek: b.dek, keyId: b.keyId, vault: b.vault, pass: '틀린새암호구입니다' })).rejects.toThrow('드라이브 암호구가 맞지 않습니다')
    const res = await applyNewPass({ db: b.db, store: w.store, dek: b.dek, keyId: b.keyId, vault: b.vault, pass: PASS_NEW })
    expect(res.notice).toBe(OLD_BACKUP_NOTICE)
    const root = (await getSyncState(b.db)).rootId!
    const kf = (await w.store.readKeyFile(root))!
    const vp = b.vault.now().pass
    expect({ salt: vp.salt, iter: vp.iter, iv: vp.iv, ct: vp.ct }).toEqual({ salt: kf.salt, iter: kf.iter, iv: kf.iv, ct: kf.ct })
    expect((await getCachedKey(b.db))!.salt).toEqual(fromBase64(kf.salt))
    expect(await checkKeyChange({ db: b.db, store: w.store, keyId: b.keyId, vault: b.vault.now() })).toMatchObject({ needPass: false })
    b.db.close()
  })

  test('동기화가 꺼져 있으면 rewrapKeyFile은 아무것도 하지 않는다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    expect(await rewrapKeyFile({ db: a.db, store: w.store, dek: a.dek, keyId: a.keyId, k: { salt, iter: ITER, raw: new Uint8Array(32) } })).toBeNull()
    expect(w.d.files.size).toBe(0)
  })
})

describe('처음 합치기 — replace', () => {
  test('replace 선택 → 안전 백업 하나와 드라이브 자료만 남는다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    await enable(a)
    const b = await w.pc('B', PASS_B)
    await seed(b, 'B')
    const r = await enable(b, { drivePass: PASS_A })
    if (r.kind !== 'second-rekeyed') throw new Error('rekey expected')
    const ndb = openVaultDb(r.dbName, a.dek)
    await ndb.open()
    const folder = createMemoryFolder()
    const res = await firstMerge({ db: ndb, dek: a.dek, keyId: a.keyId, store: w.store, deviceName: 'B', appVersion: '1.0.2', choice: 'replace', safety: { folder } })
    expect(res.ok).toBe(true)
    expect([...folder.files.keys()]).toHaveLength(1)
    expect([...folder.files.keys()][0]).toMatch(/^복원전_/)
    const aClasses = (await a.db.classes.toArray()).map((c) => c.id).sort()
    expect((await ndb.classes.toArray()).map((c) => c.id).sort()).toEqual(aClasses)
    expect((await ndb.students.toArray()).map((s) => s.name)).toEqual(['가상학생A'])
    expect(await getSyncState(ndb)).toMatchObject({ firstMergeDone: true, pendingUpload: false })
    expect(res.uploaded).toBe(1)
    // 안전 백업은 B의 자료를 담는다(복원 가능)
    const back = openVaultDb(`restore-${crypto.randomUUID()}`, a.dek)
    await back.open()
    await storeBackupKey(back, { salt: fromBase64(b.vault.now().pass.salt), iter: ITER, raw: await passKeyRaw(PASS_A, fromBase64(b.vault.now().pass.salt), ITER) })
    await restoreFromBytes(back, [...folder.files.values()][0], PASS_A)
    expect((await back.students.toArray()).map((s) => s.name)).toEqual(['가상학생B'])
    back.close()
    ndb.close()
  })

  test('stale-self: 90일 넘게 쉰 PC는 syncOnce가 거절하고, replaceWithDrive로 드라이브 자료로 바꾼 뒤 다시 돈다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    await enable(a)
    const b = await w.pc('B', PASS_B)
    const r = await enable(b, { drivePass: PASS_A })
    if (r.kind !== 'second-rekeyed') throw new Error('rekey expected')
    const ndb = openVaultDb(r.dbName, a.dek)
    await ndb.open()
    const p = { db: ndb, dek: a.dek, keyId: a.keyId, store: w.store, deviceName: 'B', appVersion: '1.0.2' }
    await firstMerge({ ...p, choice: 'merge' })
    await createClass(ndb, { school_year: 2026, grade: 3, class_no: 9 }) // 쉬는 동안 남은 이 PC만의 고침
    // B가 100일 쉬었다
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString()
    const me = (await getSyncState(ndb)).deviceId
    for (const f of w.d.files.values()) if (f.appProperties.deviceId === me) f.modifiedTime = old
    await setSyncState(ndb, { lastOk: old })
    const res0 = await syncOnce({ ...p, now: () => new Date() })
    expect(res0.error).toBe('stale-self')
    const folder = createMemoryFolder()
    const res = await replaceWithDrive({ ...p, safety: { folder } })
    expect(res.ok).toBe(true)
    expect(res.uploaded).toBe(1)
    expect((await ndb.classes.toArray()).map((c) => c.id).sort()).toEqual((await a.db.classes.toArray()).map((c) => c.id).sort())
    expect((await syncOnce({ ...p, now: () => new Date() })).ok).toBe(true)
    ndb.close()
  })

  test('replace는 안전 백업할 곳이 없으면 아무것도 바꾸지 않는다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    await enable(a)
    const b = await w.pc('B', PASS_A)
    const db = openVaultDb(`pc-B3-${crypto.randomUUID()}`, a.dek)
    await db.open()
    await markComplete(db, a.dek, a.keyId)
    const salt = fromBase64(a.vault.now().pass.salt)
    await storeBackupKey(db, { salt, iter: ITER, raw: await passKeyRaw(PASS_A, salt, ITER) })
    const bb: PC = { ...b, db, dek: a.dek, keyId: a.keyId, vault: { ...b.vault, now: () => a.vault.now(), current: () => a.vault.now() } }
    await seed(bb, 'B')
    expect(kindOf(await enable(bb))).toBe('second-same-key')
    await expect(firstMerge({ db, dek: a.dek, keyId: a.keyId, store: w.store, deviceName: 'B', appVersion: '1.0.2', choice: 'replace' })).rejects.toThrow()
    expect((await db.students.toArray()).map((s) => s.name)).toEqual(['가상학생B'])
  })
})

describe('끊기와 기기 빼기', () => {
  test('disconnect: 내 기기 파일을 지우고 meta sync를 비운다(자료는 남음)', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await seed(a, 'A')
    await enable(a)
    const root = (await getSyncState(a.db)).rootId!
    const r = await disconnect({ db: a.db, store: w.store })
    expect(r.remoteDeleted).toBe(true)
    expect(await w.store.listDevices(root)).toHaveLength(0)
    expect(await a.db.meta.get('sync')).toBeUndefined()
    expect(await a.db.sync_rows.count()).toBe(0)
    expect(await a.db.classes.count()).toBe(1)
    // 다시 켤 때 루트가 안 보이면 경고(같은 구글 연결 설정)
    const gone = { ...w.store, findRoot: async () => null }
    expect(await enable(a, { store: gone })).toEqual({ kind: 'error', code: 'no-root-visible' })
  })

  test('removeDevice: 그 기기 파일만 지운다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    await enable(a)
    const b = await w.pc('B', PASS_B)
    const r = await enable(b, { drivePass: PASS_A })
    if (r.kind !== 'second-rekeyed') throw new Error('rekey expected')
    const ndb = openVaultDb(r.dbName, a.dek)
    await ndb.open()
    await firstMerge({ db: ndb, dek: a.dek, keyId: a.keyId, store: w.store, deviceName: 'B', appVersion: '1.0.2', choice: 'merge' })
    const root = (await getSyncState(a.db)).rootId!
    const bId = (await getSyncState(ndb)).deviceId
    expect(await w.store.listDevices(root)).toHaveLength(2)
    await expect(removeDevice({ db: a.db, store: w.store, deviceId: (await getSyncState(a.db)).deviceId })).rejects.toThrow()
    expect(await removeDevice({ db: a.db, store: w.store, deviceId: bId })).toBe(1)
    expect((await w.store.listDevices(root)).map((d) => d.deviceId)).toEqual([(await getSyncState(a.db)).deviceId])
    ndb.close()
  })
})

describe('동기화 중 복원(§4.5)', () => {
  test('도장 찍는 쓰기 + 백업에 없는 행은 지움 표시 → 다음 동기화에 올라간다', async () => {
    const w = world()
    const a = await w.pc('A', PASS_A)
    const { c, s } = await seed(a, 'A')
    await saveAttendance(a.db, { student_id: s.id, date: '2026-03-04', kind: '결석', category: '질병', period: null, reason: '백업 때', evidence_type: null, memo: '' })
    await enable(a)
    const folder = createMemoryFolder()
    const name = await runBackup(a.db, folder)
    const cBefore = (await a.db.classes.get(c.id))!
    // 백업 뒤: 학급 하나 더, 같은 칸 출결을 지우고 새 id로 다시 넣음
    const c2 = await createClass(a.db, { school_year: 2026, grade: 2, class_no: 2 })
    const att0 = (await a.db.attendance.toArray())[0]
    await a.db.attendance.delete(att0.id)
    await saveAttendance(a.db, { student_id: s.id, date: '2026-03-04', kind: '결석', category: '질병', period: null, reason: '복원 전', evidence_type: null, memo: '' })
    const newAtt = (await a.db.attendance.toArray())[0]
    expect(newAtt.id).not.toBe(att0.id)
    await a.db.sync_rows.clear()
    await setSyncState(a.db, { lastUploadedMax: new Date().toISOString(), pendingUpload: false })
    await new Promise((r) => setTimeout(r, 5))

    await restoreFromBytes(a.db, await folder.readFile(name), PASS_A, { safety: { folder } })
    const c1 = (await a.db.classes.get(c.id))!
    expect(c1.deleted).toBe(false)
    expect(c1.updated_at > cBefore.updated_at).toBe(true) // 도장
    const gone = (await a.db.classes.get(c2.id))!
    expect(gone.deleted).toBe(true) // 하드 삭제가 아니라 지움 표시
    expect(gone.updated_at > c2.updated_at).toBe(true)
    const atts = await a.db.attendance.toArray()
    expect(atts.map((x) => x.id)).toEqual([att0.id]) // 같은 칸 다른 id는 고유 색인 때문에 하드 삭제
    expect(atts[0].reason).toBe('백업 때')
    expect((await getSyncState(a.db)).pendingUpload).toBe(true)
    expect(await isDirty(a.db)).toBe(true)
    const res = await syncOnce({ db: a.db, dek: a.dek, keyId: a.keyId, store: w.store, now: () => new Date(), deviceName: 'A', appVersion: '1.0.2' })
    expect(res.uploaded).toBe(1)
  })
})
