// @vitest-environment node
import Dexie from 'dexie'
import { AppDB } from '../db/schema'
import { listStudents } from '../roster/roster'
import { listAttendanceByStudent } from '../attendance/attendance'
import { listReportsForStudent } from '../absenceReports/list'
import { listNotes, readFile } from '../notes/notes'
import { noticesOn } from '../notices/notices'
import { listLogsByStudent } from '../counseling/counseling'
import { reportId } from '../absenceReports/ids'
import { getCachedKey, setupPassphrase, type DerivedPassKey } from '../backup/service'
import { passKeyRaw, newDek, PASS_ITER, type VaultPayload } from './keys'
import { rawWrite, readRaw } from './middleware'
import { openVaultDb } from './vaultDb'
import { fromBase64 } from '../backup/crypto'
import {
  cleanupOrphans, discardNewVault, createNewVaultDb, filterDeviceLocal, finishMigration, markComplete, migrate, planReports, planStorage, resumeOrReset,
  setupNewVault, verifyMigration, COPY_ORDER, finishRekey, REKEY_MARKER,
} from './migrate'

const ITER = 1000
const T = '2025-03-02T01:02:03.000Z'
const PASS = '가상시험암호구2026'
const base = (id: string, over: Record<string, unknown> = {}) => ({ id, created_at: T, updated_at: T, deleted: false, ...over })
const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const ATTACH = '가상 첨부 내용입니다 0123456789'

let oldName: string
beforeEach(() => { oldName = 'class-manager-t-' + crypto.randomUUID() })
afterEach(async () => {
  for (const n of await Dexie.getDatabaseNames()) await Dexie.delete(n)
})

async function derived(): Promise<DerivedPassKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { salt, iter: ITER, raw: await passKeyRaw(PASS, salt, ITER) }
}

/** 평문 시험 자료: 학급1·학생3·출결·신고서·노트+첨부·전달사항·누가기록 (가상 자료) */
async function seedOld(name = oldName): Promise<AppDB> {
  const db = new AppDB(name)
  await db.open()
  await db.classes.add(base('c1', { school_year: 2026, grade: 3, class_no: 5 }) as never)
  for (let i = 1; i <= 3; i++) {
    await db.students.add(base('s' + i, {
      class_id: 'c1', number: i, name: `가상학생${i}`, address: '가상시 가상구', birth_date: '', prev_school: '',
      phone: `010-0000-000${i}`, hobby: '', talent: '', commute: '', friends: '', memo: '가상 메모', guardian_name: '',
      guardian_phone: '', active: true,
    }) as never)
  }
  await db.attendance.add(base('a1', {
    student_id: 's1', date: '2026-03-04', kind: '결석', category: '질병', period: null, reason: '가상 감기', evidence_type: null, memo: '',
  }) as never)
  await db.absence_reports.add(base('r-old-1', {
    student_id: 's1', start_date: '2026-03-04', end_date: '2026-03-04', kind: '결석', category: '질병', period: null, school_days: 1,
    evidence_type: '2일 이내 질병', confirm_methods: [0], written_date: '2026-03-05', confirmed_date: '2026-03-05',
    diagnosis_required: false, diagnosis_received: false, submitted: false, submitted_at: null, detail: '가상 사유', overrides: [], stale: false,
  }) as never)
  await db.report_attendance.add(base('l-old-1', { report_id: 'r-old-1', attendance_id: 'a1' }) as never)
  await db.counseling_logs.add(base('g1', {
    student_id: 's2', date: '2026-03-06', place: '교실', content: '가상 상담 내용', nuga_text: '가상 누가기록', nuga_status: '미정리', nuga_entered_at: null,
  }) as never)
  await db.notice_items.add(base('ni1', { text: '가상 전달사항', start_date: '2026-03-04', end_date: '2026-03-04', done: false, pinned: false, order: 0 }) as never)
  await db.notes.add(base('n1', { title: '가상 노트', blocks: [{ id: 'b1', type: 'p', text: '가상 노트 본문' }], folder_id: null }) as never)
  await db.note_files.add(base('f1', { note_id: 'n1', name: '첨부.txt', mime: 'text/plain', size: new TextEncoder().encode(ATTACH).length, data: enc(ATTACH) }) as never)
  await db.device_local.bulkPut([
    { id: 'aiApiKey', value: 'sk-가상키' },
    { id: 'backupFolder', value: { kind: 'directory', name: '가상폴더' } },
    { id: 'deviceId', value: 'abcd1234-0000-4000-8000-000000000000' },
  ])
  return db
}

async function fullSetup(old: AppDB, extra: Partial<Parameters<typeof setupNewVault>[0]> = {}) {
  const passKey = await derived()
  let payload: VaultPayload | undefined
  const store = vi.fn(async (p: VaultPayload) => { payload = p })
  const reset = vi.fn(async () => true)
  const r = await setupNewVault({ passKey, store, reset, migrateFrom: old, ...extra })
  return { ...r, passKey, store, reset, payload: payload! }
}

test('평문 시험 자료 옮긴 뒤 화면 함수 결과가 같다(updated_at 유지)', async () => {
  const old = await seedOld()
  const progress: string[] = []
  const { db, counts } = await fullSetup(old, { onProgress: (p) => { progress.push(p.table) } })
  expect(db.isVault).toBe(true)
  expect(await listStudents(db, 'c1')).toEqual(await listStudents(old, 'c1'))
  expect((await listStudents(db, 'c1'))[0].updated_at).toBe(T)
  expect(await listAttendanceByStudent(db, 's1')).toEqual(await listAttendanceByStudent(old, 's1'))
  expect(await listLogsByStudent(db, 's2')).toEqual(await listLogsByStudent(old, 's2'))
  expect(await noticesOn(db, '2026-03-04')).toEqual(await noticesOn(old, '2026-03-04'))
  expect(await listNotes(db, '2026-03-04')).toEqual(await listNotes(old, '2026-03-04'))
  expect(new TextDecoder().decode((await readFile(db, 'f1')).bytes)).toBe(ATTACH)
  const [nr] = await listReportsForStudent(db, 's1')
  const [or] = await listReportsForStudent(old, 's1')
  expect(nr.report.id).toBe(reportId(or.report))
  expect({ ...nr.report, id: 'x' }).toEqual({ ...or.report, id: 'x' })
  const links = await db.report_attendance.toArray()
  expect(links.map((l) => [l.report_id, l.attendance_id])).toEqual([[nr.report.id, 'a1']])
  expect(counts.students).toBe(3)
  expect(progress).toContain('students')
  // device_local: 안전한 키만, backupKeyRaw는 같은 passKey
  expect((await db.device_local.get('aiApiKey'))?.value).toBe('sk-가상키')
  expect(await db.device_local.get('backupFolder')).toBeUndefined()
  expect(await db.device_local.get('backupKey')).toBeUndefined()
  const cached = await getCachedKey(db)
  expect(cached?.iterations).toBe(ITER)
  // 완료 행, 옮기기 표시는 아직 남아 있음(옛 DB를 지우기 전)
  expect((await db.meta.get('vault'))?.complete).toBe(true)
  expect(await db.meta.get('migration')).toBeTruthy()
  // 옛 DB는 그대로
  expect(await Dexie.exists(oldName)).toBe(true)
  expect(await old.students.count()).toBe(3)
  db.close()
})

test('pass wrap과 backupKeyRaw가 같은 passKey(같은 salt·iter)', async () => {
  const old = await seedOld()
  const { db, payload, passKey } = await fullSetup(old)
  expect(fromBase64(payload.pass.salt)).toEqual(passKey.salt)
  const raw = (await db.device_local.get('backupKeyRaw'))?.value as { salt: string; raw: string; iter: number }
  expect(fromBase64(raw.salt)).toEqual(passKey.salt)
  expect(fromBase64(raw.raw)).toEqual(passKey.raw)
  db.close()
})

test('순서: DB를 만든 뒤 vault.store, 그 뒤 복사, 마지막에 완료 행', async () => {
  const old = await seedOld()
  const seen: string[] = []
  const passKey = await derived()
  const r = await setupNewVault({
    passKey, migrateFrom: old, reset: async () => true,
    store: async (p) => {
      seen.push('store:' + (await Dexie.exists(p.dbName)))
      const probe = new AppDB(p.dbName, { vault: true })
      seen.push('vault-row:' + !!(await probe.meta.get('vault')))
      seen.push('students:' + (await probe.students.count()))
      probe.close()
    },
  })
  expect(seen).toEqual(['store:true', 'vault-row:false', 'students:0'])
  r.db.close()
})

test('중단(3번째 표에서 throw) → resumeOrReset 뒤 옛 DB 그대로, 새 DB 없음', async () => {
  const old = await seedOld()
  const { dek, keyId } = newDek()
  const db = await createNewVaultDb(dek, keyId, { migration: true })
  const tables: string[] = []
  await expect(migrate({
    oldDb: old, newDb: db, passKey: await derived(),
    onProgress: (p) => {
      if (!tables.includes(p.table)) tables.push(p.table)
      if (tables.length === 3) throw new Error('가상 중단')
    },
  })).rejects.toThrow('가상 중단')
  db.close() // 꺼진 셈
  const reset = vi.fn(async () => true)
  const r = await resumeOrReset({ dbName: db.name, reset, oldName })
  expect(r).toEqual({ action: 'reset', restart: 'migrate' })
  expect(reset).toHaveBeenCalledTimes(1)
  expect(await Dexie.exists(db.name)).toBe(false)
  expect(await old.students.count()).toBe(3)
  expect((await old.note_files.get('f1'))?.data).toBe(enc(ATTACH))
})

test('setupNewVault 도중 실패 → 새 DB 지우고 vault.reset, 옛 DB 그대로', async () => {
  const old = await seedOld()
  const reset = vi.fn(async () => true)
  let name = ''
  await expect(setupNewVault({
    passKey: await derived(), migrateFrom: old, reset,
    store: async (p) => { name = p.dbName },
    onProgress: (p) => { if (p.table === 'notes') throw new Error('가상 실패') },
  })).rejects.toThrow('가상 실패')
  expect(reset).toHaveBeenCalledTimes(1)
  expect(await Dexie.exists(name)).toBe(false)
  expect(await old.students.count()).toBe(3)
})

test('resumeOrReset: 옛 DB 없고 새 DB에 자료가 있으면 지우지 않는다', async () => {
  const { dek, keyId } = newDek()
  const db = await createNewVaultDb(dek, keyId, { migration: true })
  await db.students.add(base('s1', { class_id: 'c1', number: 1, name: '가상학생' }) as never)
  db.close()
  const reset = vi.fn(async () => true)
  const r = await resumeOrReset({ dbName: db.name, reset, oldName })
  expect(r.action).toBe('blocked')
  expect(reset).not.toHaveBeenCalled()
  expect(await Dexie.exists(db.name)).toBe(true)
})

test('resumeOrReset: 옛 DB 없고 새 DB가 비었으면(meta·device_local만) 지우고 첫 설치', async () => {
  const { dek, keyId } = newDek()
  const db = await createNewVaultDb(dek, keyId)
  await db.device_local.put({ id: 'aiApiKey', value: 'x' })
  db.close()
  const reset = vi.fn(async () => true)
  expect(await resumeOrReset({ dbName: db.name, reset, oldName })).toEqual({ action: 'reset', restart: 'first-install' })
  expect(reset).toHaveBeenCalled()
  expect(await Dexie.exists(db.name)).toBe(false)
})

test('resumeOrReset: 옛 DB 지우는 중 꺼졌으면(완료 행 + delete-old 표시) 마저 끝낸다', async () => {
  const { dek, keyId } = newDek()
  const db = await createNewVaultDb(dek, keyId, { migration: true })
  await db.students.add(base('s1', { class_id: 'c1', number: 1, name: '가상학생' }) as never)
  await markComplete(db, dek, keyId)
  await db.meta.put({ id: 'migration', from: oldName, stage: 'delete-old' })
  db.close()
  const reset = vi.fn(async () => true)
  expect(await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek, keyId } })).toEqual({ action: 'resumed', bitlocker: true })
  expect(reset).not.toHaveBeenCalled()
  const again = openVaultDb(db.name, dek)
  expect(await again.meta.get('migration')).toBeUndefined()
  expect((await again.meta.get('migratedFrom'))?.name).toBe(oldName)
  expect(await again.students.count()).toBe(1)
  again.close()
})

test('저장 공간 부족 → ok:false (사용량 × 1.3)', async () => {
  expect(await planStorage(async () => ({ usage: 100, quota: 200 }))).toEqual({ ok: false, need: 130, free: 100 })
  expect(await planStorage(async () => ({ usage: 100, quota: 300 }))).toEqual({ ok: true, need: 130, free: 200 })
})

describe('finishMigration 조건', () => {
  async function ready() {
    const old = await seedOld()
    const r = await fullSetup(old)
    return { old, ...r, verify: r.verify! }
  }

  test('pass 없음 → 거절, 옛 DB 남음', async () => {
    const { old, db, payload, verify } = await ready()
    const { pass: _p, ...noPass } = payload
    await expect(finishMigration(old, db, { vault: noPass as never, verify, backup: { kind: 'folder', name: '백업_x.enc', skipped: 0 } })).rejects.toThrow()
    expect(await Dexie.exists(oldName)).toBe(true)
    db.close()
  })

  test('새 백업 없음 → 거절', async () => {
    const { old, db, payload, verify } = await ready()
    await expect(finishMigration(old, db, { vault: payload, verify, backup: undefined as never })).rejects.toThrow()
    await expect(finishMigration(old, db, { vault: payload, verify, backup: { kind: 'folder', name: '', skipped: 0 } })).rejects.toThrow()
    expect(await Dexie.exists(oldName)).toBe(true)
    db.close()
  })

  test('검증 결과를 흉내 낸 객체 → 거절', async () => {
    const { old, db, payload } = await ready()
    await expect(finishMigration(old, db, { vault: payload, verify: { ok: true, problems: [] }, backup: { kind: 'download', name: 'a.enc', skipped: 0 } })).rejects.toThrow()
    expect(await Dexie.exists(oldName)).toBe(true)
    db.close()
  })

  test('백업에서 빠진 첨부가 있으면(skipped > 0) 또는 skipped를 모르면 → 거절, 옛 DB 남음', async () => {
    const { old, db, payload, verify } = await ready()
    await expect(finishMigration(old, db, { vault: payload, verify, backup: { kind: 'folder', name: '백업_x.enc', skipped: 1 } })).rejects.toThrow(/첨부 1개/)
    await expect(finishMigration(old, db, { vault: payload, verify, backup: { kind: 'folder', name: '백업_x.enc' } as never })).rejects.toThrow()
    expect(await Dexie.exists(oldName)).toBe(true)
    expect((await old.note_files.get('f1'))?.data).toBe(enc(ATTACH))
    db.close()
  })

  test('모두 갖추면 옛 DB를 지우고 migratedFrom을 남긴다', async () => {
    const { old, db, payload, verify } = await ready()
    await finishMigration(old, db, { vault: payload, verify, backup: { kind: 'download', name: '백업_x.enc', skipped: 0 } })
    expect(await Dexie.exists(oldName)).toBe(false)
    expect((await db.meta.get('migratedFrom'))?.name).toBe(oldName)
    expect(await db.meta.get('migration')).toBeUndefined()
    expect(await db.students.count()).toBe(3)
    db.close()
  })
})

describe('device_local 허용·거부', () => {
  test('backupKey·backupKeyRaw·backupFolder와 직렬화할 수 없는 값은 뺀다', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    const r = filterDeviceLocal([
      { id: 'backupKey', value: { key, salt: new Uint8Array(16), iterations: 1, check: 'x' } },
      { id: 'backupKeyRaw', value: { raw: 'x' } },
      { id: 'backupFolder', value: { name: 'x' } },
      { id: 'when', value: new Date(0) },
      { id: 'nested', value: { a: [1, { k: key }] } },
      { id: 'pin', value: { hash: 'h', salt: 's', iterations: 10 } },
      { id: 'bytes', value: new Uint8Array([1, 2]) },
      { id: 'aiApiKey', value: 'sk' },
      { id: 'lastBackupAt', value: T },
      { id: 'currentClassId', value: 'c1' },
    ])
    expect(r.keep.map((x) => x.id)).toEqual(['pin', 'bytes', 'aiApiKey', 'lastBackupAt', 'currentClassId'])
    expect(Object.fromEntries(r.dropped.map((d) => [d.id, d.reason]))).toEqual({
      backupKey: 'deny', backupKeyRaw: 'deny', backupFolder: 'deny', when: 'unserializable', nested: 'unserializable',
    })
  })
})

describe('verifyMigration', () => {
  test('바뀐 행을 잡는다', async () => {
    const old = await seedOld()
    const { db } = await fullSetup(old)
    await db.students.update('s2', { memo: '바뀜' })
    const v = await verifyMigration(old, db, 50)
    expect(v.ok).toBe(false)
    expect(v.problems.join('\n')).toMatch(/students/)
    db.close()
  })

  test('행 수가 다르면 잡는다', async () => {
    const old = await seedOld()
    const { db } = await fullSetup(old)
    await db.students.delete('s3')
    const v = await verifyMigration(old, db)
    expect(v.ok).toBe(false)
    db.close()
  })

  test('원시 행에 평문 이름이 보이면 잡는다', async () => {
    const old = await seedOld()
    const { db } = await fullSetup(old)
    const raw = (await readRaw(db, 'students')).find((r) => r.id === 's1')!
    await rawWrite(db, [db.students], () => db.students.put({ ...raw, name: '가상학생1' } as never))
    const v = await verifyMigration(old, db, 50)
    expect(v.ok).toBe(false)
    expect(v.problems.join('\n')).toMatch(/원시/)
    db.close()
  })

  test('암호문 자리에 평문 바이트가 있으면(전화번호) 잡는다', async () => {
    const old = await seedOld()
    const { db } = await fullSetup(old)
    const raw = (await readRaw(db, 'students')).find((r) => r.id === 's2')!
    const leak = new TextEncoder().encode(JSON.stringify({ phone: '010-0000-0002' }))
    await rawWrite(db, [db.students], () => db.students.put({ ...raw, _enc: leak } as never))
    const v = await verifyMigration(old, db, 50)
    expect(v.problems.join('\n')).toMatch(/students: 원시 행 s2에 평문이 보입니다/)
    db.close()
  })

  test('첨부 내용이 다르면 잡는다', async () => {
    const old = await seedOld()
    const { db } = await fullSetup(old)
    await db.note_blobs.delete('f1')
    expect((await verifyMigration(old, db, 50)).ok).toBe(false)
    db.close()
  })
})

describe('신고서 id 바꾸기(아무것도 잃지 않음)', () => {
  const rep = (id: string, over: Record<string, unknown> = {}) =>
    base(id, { student_id: 's1', start_date: '2026-03-04', kind: '결석', category: '질병', detail: id, ...over }) as never
  test('같은 결정적 id로 겹치는 살아 있는 신고서 둘 다 남고 연결도 제 짝을 따라간다', () => {
    const p = planReports(
      [rep('ra', { updated_at: '2025-01-01T00:00:00.000Z' }), rep('rb', { updated_at: '2025-02-01T00:00:00.000Z' })],
      [base('la', { report_id: 'ra', attendance_id: 'a1' }) as never, base('lb', { report_id: 'rb', attendance_id: 'a2' }) as never],
    )
    expect(p.reports).toHaveLength(2)
    const ids = new Set(p.reports.map((r) => r.id))
    expect(ids.size).toBe(2)
    expect(ids.has(reportId(p.reports[0]))).toBe(true)
    for (const l of p.links) expect(p.reports.find((r) => r.id === l.report_id)?.detail).toBe(l.attendance_id === 'a1' ? 'ra' : 'rb')
  })
  test('이미 결정적 id인 신고서는 그대로, 짝 없는 연결도 그대로 남는다', () => {
    const p = planReports([rep('report:s1:2026-03-04:결석:질병:x1')], [base('lz', { report_id: 'gone', attendance_id: 'a9' }) as never])
    expect(p.reports[0].id).toBe('report:s1:2026-03-04:결석:질병:x1')
    expect(p.links).toEqual([base('lz', { report_id: 'gone', attendance_id: 'a9' })])
  })
})

test('첫 설치: 빈 새 DB + 완료 행 + backupKeyRaw', async () => {
  const passKey = await derived()
  let payload: VaultPayload | undefined
  const r = await setupNewVault({ passKey, store: async (p) => { payload = p }, reset: async () => true })
  expect(payload!.dbName).toBe(r.db.name)
  expect(payload!.recovery).toBeUndefined()
  expect((await r.db.meta.get('vault'))?.complete).toBe(true)
  expect(await r.db.meta.get('migration')).toBeUndefined()
  expect(await r.db.students.count()).toBe(0)
  expect(await getCachedKey(r.db)).toBeTruthy()
  r.db.close()
})

test('COPY_ORDER는 옛 DB의 모든 자료 표를 담는다(meta·sync_rows·note_blobs 제외)', () => {
  const db = new AppDB('x-' + crypto.randomUUID())
  const all = db.tables.map((t) => t.name).filter((n) => !['meta', 'sync_rows', 'note_blobs'].includes(n)).sort()
  expect([...COPY_ORDER].sort()).toEqual(all)
})

test('옛 백업 열쇠(legacy CryptoKey)가 있어도 새 DB에는 backupKeyRaw만', async () => {
  const old = await seedOld()
  await setupPassphrase(old, PASS, { iterations: ITER })
  expect((await old.device_local.get('backupKey'))).toBeTruthy()
  const { db } = await fullSetup(old)
  expect(await db.device_local.get('backupKey')).toBeUndefined()
  expect(await db.device_local.get('backupKeyRaw')).toBeTruthy()
  void PASS_ITER
  db.close()
})

// ---- fix round 1 ----
describe('resumeOrReset: 완료된 새 DB는 버리지 않는다', () => {
  async function completeNew(stage: 'copy' | 'delete-old') {
    const { dek, keyId } = newDek()
    const db = await createNewVaultDb(dek, keyId, { migration: true, from: oldName })
    await db.students.add(base('s1', { class_id: 'c1', number: 1, name: '가상학생' }) as never)
    await markComplete(db, dek, keyId)
    await db.meta.put({ id: 'migration', from: oldName, stage })
    db.close()
    return { db, dek, keyId }
  }

  test('delete-old 표시 뒤 꺼짐(옛 DB 아직 있음) → 옛 DB를 마저 지우고 이어 한다(vault 유지)', async () => {
    const old = await seedOld()
    old.close()
    const { db, dek, keyId } = await completeNew('delete-old')
    const reset = vi.fn(async () => true)
    expect(await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek, keyId } })).toEqual({ action: 'resumed', bitlocker: true })
    expect(reset).not.toHaveBeenCalled()
    expect(await Dexie.exists(oldName)).toBe(false)
    const again = openVaultDb(db.name, dek)
    expect(await again.meta.get('migration')).toBeUndefined()
    expect(await again.students.count()).toBe(1)
    again.close()
  })

  test('delete-old라도 확인값이 맞지 않으면(다른 열쇠) 이어 하지 않는다', async () => {
    const old = await seedOld()
    old.close()
    const { db, keyId } = await completeNew('delete-old')
    const reset = vi.fn(async () => true)
    const r = await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek: newDek().dek, keyId } })
    expect(r.action).not.toBe('resumed')
    expect(await Dexie.exists(oldName)).toBe(true)
  })

  test('비어 있는 다시 만든 옛 DB(기본 설정만) + 완료된 새 DB → vault 유지, 옛 DB는 새 백업 뒤에만(백업 단계)', async () => {
    const empty = new AppDB(oldName)
    await empty.open()
    await empty.device_local.put({ id: 'x', value: 1 })
    await empty.app_settings.put(base('app') as never)
    empty.close()
    const { db, dek, keyId } = await completeNew('copy')
    const reset = vi.fn(async () => true)
    const r = await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek, keyId } })
    expect(r.action).toBe('backup')
    expect(reset).not.toHaveBeenCalled()
    expect(await Dexie.exists(db.name)).toBe(true)
    expect(await Dexie.exists(oldName)).toBe(true)
    if (r.action === 'backup') { r.db.close(); r.oldDb.close() }
  })

  test('비어 있는 옛 DB + 열쇠 없이(확인 불가) 자료 있는 새 DB → 지우지 않음', async () => {
    const empty = new AppDB(oldName)
    await empty.open()
    empty.close()
    const { db } = await completeNew('copy')
    const reset = vi.fn(async () => true)
    expect((await resumeOrReset({ dbName: db.name, reset, oldName })).action).toBe('blocked')
    expect(reset).not.toHaveBeenCalled()
    expect(await Dexie.exists(db.name)).toBe(true)
  })
})

describe('cleanupOrphans', () => {
  test('완료 행이 없는 watson-* DB만 지운다', async () => {
    const a = newDek(); const b = newDek()
    const orphan = await createNewVaultDb(a.dek, a.keyId, { migration: true })
    await orphan.students.add(base('s1', { name: '가상' }) as never)
    orphan.close()
    const kept = await createNewVaultDb(b.dek, b.keyId)
    await markComplete(kept, b.dek, b.keyId)
    kept.close()
    const other = new Dexie('watson-test-other'); other.version(1).stores({ t: 'id' }); await other.open(); other.close()
    const removed = await cleanupOrphans()
    expect(removed).toEqual([orphan.name])
    expect(await Dexie.exists(orphan.name)).toBe(false)
    expect(await Dexie.exists(kept.name)).toBe(true)
    expect(await Dexie.exists('watson-test-other')).toBe(true)
  })
})

describe('discardNewVault', () => {
  test('DB를 먼저 지우고 그 뒤 vault.reset', async () => {
    const { dek, keyId } = newDek()
    const db = await createNewVaultDb(dek, keyId)
    db.close()
    const seen: boolean[] = []
    const r = await discardNewVault({ dbName: db.name, reset: async () => { seen.push(await Dexie.exists(db.name)) }, oldName })
    expect(r).toBe('done')
    expect(seen).toEqual([false])
  })
  test('reset 실패 → reset-failed(거짓말하지 않음)', async () => {
    const { dek, keyId } = newDek()
    const db = await createNewVaultDb(dek, keyId)
    db.close()
    expect(await discardNewVault({ dbName: db.name, reset: async () => { throw new Error('x') }, oldName })).toBe('reset-failed')
  })
  test('조건이 안 맞으면 refused', async () => {
    const { dek, keyId } = newDek()
    const db = await createNewVaultDb(dek, keyId)
    await db.students.add(base('s1', { name: '가상' }) as never)
    db.close()
    const reset = vi.fn(async () => true)
    expect(await discardNewVault({ dbName: db.name, reset, oldName })).toBe('refused')
    expect(reset).not.toHaveBeenCalled()
  })
  test('setupNewVault 실패는 정리 결과를 오류에 싣는다', async () => {
    const old = await seedOld()
    const err = await setupNewVault({
      passKey: await derived(), migrateFrom: old, store: async () => { throw new Error('가상 실패') },
      reset: async () => { throw new Error('reset 실패') },
    }).catch((e) => e)
    expect(err.message).toBe('가상 실패')
    expect(err.discard).toBe('reset-failed')
  })
})

test('note_files는 바이트 예산으로 나눠 읽는다(한 쪽에 적어도 한 행)', async () => {
  const old = await seedOld()
  await old.note_files.add(base('f2', { note_id: 'n1', name: 'b.txt', mime: 'text/plain', size: 3, data: enc('abc') }) as never)
  await old.note_files.add(base('f3', { note_id: 'n1', name: 'c.txt', mime: 'text/plain', size: 3, data: enc('def') }) as never)
  const { dek, keyId } = newDek()
  const db = await createNewVaultDb(dek, keyId, { migration: true })
  const steps: number[] = []
  await migrate({ oldDb: old, newDb: db, fileBudget: 1, onProgress: (p) => { if (p.table === 'note_files') steps.push(p.done) } })
  expect(steps).toEqual([0, 1, 2, 3])
  expect(new TextDecoder().decode((await readFile(db, 'f3')).bytes)).toBe('def')
  db.close()
})

// ---- final fix wave ----
/** 학생 자료 없이 설정·기본값만 있는 옛 DB(나이스 열쇠만 넣은 선생님, 가상 자료) */
async function seedSeededOnly(name = oldName): Promise<AppDB> {
  const db = new AppDB(name)
  await db.open()
  await db.app_settings.put(base('app', { neis_key: '가상나이스열쇠' }) as never)
  await db.reflection_phrases.put(base('rp1', { text: '가상 반성문 문장' }) as never)
  await db.device_local.put({ id: 'aiApiKey', value: 'sk-가상키' })
  return db
}

describe('resumeOrReset: 설정만 있는 옛 DB', () => {
  test('복사 중 꺼짐(완료 행 없음) → 새 DB·vault 지우고 옮기기부터, 옛 DB 그대로', async () => {
    const old = await seedSeededOnly()
    const { dek, keyId } = newDek()
    const db = await createNewVaultDb(dek, keyId, { migration: true, from: oldName })
    await expect(migrate({
      oldDb: old, newDb: db, passKey: await derived(),
      onProgress: (p) => { if (p.table === 'reflection_phrases') throw new Error('가상 중단') },
    })).rejects.toThrow('가상 중단')
    db.close()
    old.close()
    expect(await new AppDB(db.name, { vault: true }).app_settings.count()).toBe(1) // 설정은 이미 옮겨진 채 꺼짐
    const reset = vi.fn(async () => true)
    const r = await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek, keyId } })
    expect(r).toEqual({ action: 'reset', restart: 'migrate' })
    expect(reset).toHaveBeenCalledTimes(1)
    expect(await Dexie.exists(db.name)).toBe(false)
    const again = new AppDB(oldName)
    expect((await again.app_settings.get('app')) as unknown).toMatchObject({ neis_key: '가상나이스열쇠' })
    expect(await again.reflection_phrases.count()).toBe(1)
    expect((await again.device_local.get('aiApiKey'))?.value).toBe('sk-가상키')
    again.close()
  })

  test('완료 행 뒤 백업 전에 꺼짐 → 옛 DB를 지우지 않고 새 백업 단계로(증거 없이는 finishMigration 거절)', async () => {
    const old = await seedSeededOnly()
    const { db, dek, keyId, payload } = await fullSetup(old)
    db.close()
    old.close()
    const reset = vi.fn(async () => true)
    const r = await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek, keyId } })
    expect(r.action).toBe('backup')
    expect(reset).not.toHaveBeenCalled()
    expect(await Dexie.exists(oldName)).toBe(true)
    if (r.action !== 'backup') return
    await expect(finishMigration(r.oldDb, r.db, { vault: payload, verify: r.verify, backup: undefined as never })).rejects.toThrow()
    expect(await Dexie.exists(oldName)).toBe(true)
    await finishMigration(r.oldDb, r.db, { vault: payload, verify: r.verify, backup: { kind: 'download', name: '백업_x.enc', skipped: 0 } })
    expect(await Dexie.exists(oldName)).toBe(false)
    expect((await r.db.app_settings.get('app')) as unknown).toMatchObject({ neis_key: '가상나이스열쇠' })
    r.db.close()
  })

  test('옛 DB가 device_local 말고 비었으면 → 옛 DB를 지우고 이어 한다', async () => {
    const empty = new AppDB(oldName)
    await empty.open()
    await empty.device_local.put({ id: 'x', value: 1 })
    empty.close()
    const { dek, keyId } = newDek()
    const db = await createNewVaultDb(dek, keyId, { migration: true, from: oldName })
    await db.students.add(base('s1', { class_id: 'c1', number: 1, name: '가상학생' }) as never)
    await markComplete(db, dek, keyId)
    db.close()
    const reset = vi.fn(async () => true)
    expect(await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek, keyId } })).toMatchObject({ action: 'resumed' })
    expect(await Dexie.exists(oldName)).toBe(false)
    expect(reset).not.toHaveBeenCalled()
  })

  test('옛 DB에 자료가 있고 그 뒤 바뀌었으면(옛 exe) → 새 DB 버리고 옮기기부터', async () => {
    const old = await seedOld()
    const { db, dek, keyId } = await fullSetup(old)
    db.close()
    await old.students.update('s1', { memo: '옛 exe에서 고침' })
    old.close()
    const reset = vi.fn(async () => true)
    expect(await resumeOrReset({ dbName: db.name, reset, oldName, key: { dek, keyId } })).toEqual({ action: 'reset', restart: 'migrate' })
    expect(await Dexie.exists(db.name)).toBe(false)
    expect(await Dexie.exists(oldName)).toBe(true)
  })
})

describe('resumeOrReset: 이어 끝낼 때 BitLocker 안내', () => {
  async function deleteOldState() {
    const { dek, keyId } = newDek()
    const db = await createNewVaultDb(dek, keyId, { migration: true })
    await markComplete(db, dek, keyId)
    await db.meta.put({ id: 'migration', from: oldName, stage: 'delete-old' })
    return { db, dek, keyId }
  }
  test('안내 표시가 없으면 bitlocker: true, 표시를 남긴다', async () => {
    const { db, dek, keyId } = await deleteOldState()
    db.close()
    expect(await resumeOrReset({ dbName: db.name, reset: async () => true, oldName, key: { dek, keyId } })).toEqual({ action: 'resumed', bitlocker: true })
    const again = openVaultDb(db.name, dek)
    expect(await again.device_local.get('bitlockerNoticeShown')).toBeTruthy()
    again.close()
  })
  test('이미 보였으면 bitlocker: false', async () => {
    const { db, dek, keyId } = await deleteOldState()
    await db.device_local.put({ id: 'bitlockerNoticeShown', value: T })
    db.close()
    expect(await resumeOrReset({ dbName: db.name, reset: async () => true, oldName, key: { dek, keyId } })).toEqual({ action: 'resumed', bitlocker: false })
  })
})

describe('vault → vault 복사(S6 다시 암호화)', () => {
  async function vaultSource() {
    const old = await seedOld()
    const { db, dek } = await fullSetup(old)
    return { src: db, srcDek: dek }
  }
  test('명시적 옵션 없이는 암호화 DB를 옛 DB로 받지 않는다', async () => {
    const { src } = await vaultSource()
    const { dek, keyId } = newDek()
    const dst = await createNewVaultDb(dek, keyId)
    await expect(migrate({ oldDb: src, newDb: dst })).rejects.toThrow('옛 DB가 평문 DB가 아닙니다.')
    src.close(); dst.close()
  })
  test('fromVault: 다른 열쇠의 새 DB로 그대로 복사(id·updated_at·첨부), 확인 통과, 원시 행은 새 열쇠로만 풀린다', async () => {
    const { src, srcDek } = await vaultSource()
    const { dek, keyId } = newDek()
    const dst = await createNewVaultDb(dek, keyId)
    const passKey = await derived()
    const r = await migrate({ oldDb: src, newDb: dst, passKey, fromVault: true })
    expect(r.counts.students).toBe(3)
    expect(await dst.students.toArray()).toEqual(await src.students.toArray())
    expect(await dst.absence_reports.toArray()).toEqual(await src.absence_reports.toArray())
    expect(await dst.report_attendance.toArray()).toEqual(await src.report_attendance.toArray())
    expect(new TextDecoder().decode((await readFile(dst, 'f1')).bytes)).toBe(ATTACH)
    expect((await getCachedKey(dst))!.salt).toEqual(passKey.salt)
    expect((await dst.device_local.get('deviceId'))?.value).toBe('abcd1234-0000-4000-8000-000000000000')
    const v = await verifyMigration(src, dst)
    expect(v).toEqual({ ok: true, problems: [] })
    // 옛 열쇠로는 새 DB가 풀리지 않는다
    const wrong = openVaultDb(dst.name, srcDek)
    expect(await wrong.students.toArray()).toEqual([])
    wrong.close()
    src.close(); dst.close()
  })
})

describe('finishRekey', () => {
  test('rekey 표시가 가리키는 옛 DB를 지우고 표시를 지운다', async () => {
    const { dek, keyId } = newDek()
    const oldDb = openVaultDb('watson-old-' + crypto.randomUUID().slice(0, 4), dek)
    await oldDb.open()
    oldDb.close()
    const k = newDek()
    const db = await createNewVaultDb(k.dek, k.keyId)
    await markComplete(db, k.dek, k.keyId)
    await db.meta.put({ id: REKEY_MARKER, from: oldDb.name, stage: 'copy' })
    expect(await finishRekey(db)).toBe(true)
    expect(await Dexie.exists(oldDb.name)).toBe(false)
    expect(await db.meta.get(REKEY_MARKER)).toBeUndefined()
    expect(await finishRekey(db)).toBe(false)
    void keyId
    db.close()
  })
  test('완료 행이 없으면 옛 DB를 지우지 않는다', async () => {
    const { dek } = newDek()
    const oldDb = openVaultDb('watson-old2-' + crypto.randomUUID().slice(0, 4), dek)
    await oldDb.open()
    oldDb.close()
    const k = newDek()
    const db = await createNewVaultDb(k.dek, k.keyId)
    await db.meta.put({ id: REKEY_MARKER, from: oldDb.name, stage: 'copy' })
    expect(await finishRekey(db)).toBe(false)
    expect(await Dexie.exists(oldDb.name)).toBe(true)
    db.close()
  })
})
