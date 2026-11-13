import 'fake-indexeddb/auto'
import { liveQuery, type DBCore, type DBCoreCursor } from 'dexie'
import { describe, it, expect, afterEach } from 'vitest'
import type { AppDB } from '../db/schema'
import type { StudentRec, AttendanceRec } from '../db/types'
import { save } from '../db/records'
import { mergeWrite, rawWrite, onBrokenRow, readRaw, lastStamp } from './middleware'
import { openTestVaultDb } from './testing'
import { plainFieldsOf } from './plainFields'
import { UNENCRYPTED_TABLES } from './vaultDb'

const dbs: AppDB[] = []
afterEach(async () => { for (const d of dbs.splice(0)) { d.close(); await d.delete() } })
const vdb = () => { const d = openTestVaultDb(); dbs.push(d); return d }

const T0 = '2020-01-01T00:00:00.000Z'
function student(id: string, over: Partial<StudentRec> = {}): StudentRec {
  return {
    id, class_id: 'c1', number: 1, name: '가상학생', address: '', birth_date: '', prev_school: '',
    phone: '010-1111-2222', hobby: '', talent: '', commute: '', friends: '', memo: '', guardian_name: '',
    guardian_phone: '', active: true, created_at: T0, updated_at: T0, deleted: false, ...over,
  }
}
function att(id: string, over: Partial<AttendanceRec> = {}): AttendanceRec {
  return {
    id, student_id: 's1', date: '2026-03-02', kind: '결석', category: '질병', period: null, reason: '감기',
    evidence_type: null, memo: '', created_at: T0, updated_at: T0, deleted: false, ...over,
  }
}
const dec = new TextDecoder()
const rawText = (rows: Record<string, unknown>[]) =>
  rows.map(r => JSON.stringify({ ...r, _enc: undefined }) + (ArrayBuffer.isView(r._enc) ? dec.decode(r._enc as Uint8Array) : '')).join('\n')

/** 한 행의 _enc 바이트 하나를 뒤집어 rawWrite로 다시 넣는다. */
async function breakRow(db: AppDB, id: string) {
  const raw = (await readRaw(db, 'students')).find(r => r.id === id)!
  const enc = (raw._enc as Uint8Array).slice()
  enc[enc.length - 1] ^= 0xff
  await rawWrite(db, [db.students], () => db.students.put({ ...raw, _enc: enc } as unknown as StudentRec))
}

describe('암호화 미들웨어', () => {
  it('put/get 왕복, readRaw에 가상학생·전화 문자열 없음', async () => {
    const db = vdb()
    const s = student('s1')
    await db.students.put(s)
    const got = await db.students.get('s1')
    expect(got).toMatchObject({ ...s, updated_at: expect.any(String) })
    expect('_enc' in got!).toBe(false)
    const raw = await readRaw(db, 'students')
    expect(raw).toHaveLength(1)
    expect(Object.prototype.toString.call(raw[0]._enc)).toBe('[object Uint8Array]')
    expect(raw[0].name).toBeUndefined()
    const text = rawText(raw)
    expect(text).not.toContain('가상학생')
    expect(text).not.toContain('010-1111-2222')
    expect(raw[0].class_id).toBe('c1')
  })

  it('받은 객체를 바꾸지 않는다', async () => {
    const db = vdb()
    const s = student('s1')
    await db.students.put(s)
    expect(s).toEqual(student('s1'))
  })

  it('미들웨어 평문 칸 = plainFieldsOf', async () => {
    const db = vdb()
    await db.open()
    for (const t of db.tables) {
      if ((UNENCRYPTED_TABLES as readonly string[]).includes(t.name)) continue
      const row: Record<string, unknown> = { id: 'x', zz_secret: 'q' }
      for (const f of plainFieldsOf(db, t.name)) if (f !== 'id') row[f] = f === 'deleted' ? false : 'v'
      await mergeWrite(db, [t], () => t.put(row))
      const raw = (await readRaw(db, t.name))[0]
      expect(Object.keys(raw).filter(k => k !== '_enc').sort(), t.name).toEqual([...plainFieldsOf(db, t.name)].sort())
    }
  })

  it('암호화하지 않는 표는 그대로 통과(봉인·도장 없음)', async () => {
    const db = vdb()
    const row = { id: 'n1', kind: 'meal', range_key: 'r', payload: { a: '가상학생' }, fetched_at: T0, created_at: T0, updated_at: T0, deleted: false }
    await db.neis_cache.put(row as never)
    const raw = await readRaw(db, 'neis_cache')
    expect(raw).toEqual([row])
    expect(await db.neis_cache.get('n1')).toEqual(row)
  })

  it("where('class_id').equals / anyOf / 복합 고유 색인 위반 ConstraintError", async () => {
    const db = vdb()
    await db.students.bulkPut([student('s1'), student('s2', { class_id: 'c2', name: '둘' }), student('s3', { class_id: 'c3' })])
    expect((await db.students.where('class_id').equals('c2').toArray()).map(s => s.name)).toEqual(['둘'])
    expect((await db.students.where('class_id').anyOf(['c1', 'c3']).toArray()).map(s => s.id).sort()).toEqual(['s1', 's3'])
    await db.attendance.add(att('a1'))
    const err = await db.attendance.add(att('a2')).catch(e => e)
    expect(err?.name).toBe('ConstraintError')
    // (fake-indexeddb 6.0.0은 고유 색인 위반 행도 남긴다 — 미들웨어 없는 DB에서도 같아 행 수는 보지 않는다)
  })

  it('modify()·update()·bulkPut 1000행 뒤 내용 정상, 도장은 모두 now 이상', async () => {
    const db = vdb()
    const now = new Date().toISOString()
    const rows = Array.from({ length: 1000 }, (_, i) => student('s' + i, { number: i }))
    await db.students.bulkPut(rows)
    await db.students.where('class_id').equals('c1').modify({ memo: '메모' })
    await db.students.update('s5', { name: '바뀐이름' })
    await db.students.filter(s => s.number % 2 === 1).modify(s => { s.hobby = '홀' })
    const all = await db.students.toArray()
    expect(all).toHaveLength(1000)
    for (const s of all) {
      expect(s.memo).toBe('메모')
      expect(s.hobby).toBe(s.number % 2 === 1 ? '홀' : '')
      expect(s.phone).toBe('010-1111-2222')
      expect(s.updated_at >= now).toBe(true)
    }
    expect((await db.students.get('s5'))?.name).toBe('바뀐이름')
    expect(rawText(await readRaw(db, 'students'))).not.toContain('메모')
  })

  it('bulkUpdate·bulkGet·delete 경로', async () => {
    const db = vdb()
    await db.students.bulkPut([student('s1'), student('s2')])
    expect(await db.students.bulkUpdate([{ key: 's1', changes: { memo: '하나' } }, { key: 's2', changes: { memo: '둘' } }])).toBe(2)
    expect((await db.students.bulkGet(['s1', 's2'])).map(s => s?.memo)).toEqual(['하나', '둘'])
    await db.students.delete('s1')
    await db.students.where('class_id').equals('c1').delete()
    expect(await db.students.count()).toBe(0)
  })

  it("시계 앞선 행: 기존 updated_at 2099 → put 뒤 2099-01-01T00:00:00.001Z", async () => {
    const db = vdb()
    await mergeWrite(db, [db.students], () => db.students.put(student('s1', { updated_at: '2099-01-01T00:00:00.000Z' })))
    await db.students.put(student('s1', { name: '다시' }))
    expect((await db.students.get('s1'))?.updated_at).toBe('2099-01-01T00:00:00.001Z')
    await db.students.update('s1', { memo: 'm' })
    expect((await db.students.get('s1'))?.updated_at).toBe('2099-01-01T00:00:00.002Z')
  })

  it('save()는 실제 찍힌 도장을 돌려준다', async () => {
    const db = vdb()
    await mergeWrite(db, [db.students], () => db.students.put(student('s1', { updated_at: '2099-01-01T00:00:00.000Z' })))
    const back = await save(db.students, student('s1', { name: '저장' }))
    expect(back.updated_at).toBe('2099-01-01T00:00:00.001Z')
    expect(lastStamp(db.students, 's1')).toBe('2099-01-01T00:00:00.001Z')
    expect((await db.students.get('s1'))?.updated_at).toBe(back.updated_at)
  })

  it('mergeWrite 안 put은 updated_at 그대로', async () => {
    const db = vdb()
    const r = await mergeWrite(db, [db.students], async () => {
      await db.students.put(student('s1'))
      await db.students.bulkPut([student('s2', { updated_at: '2001-01-01T00:00:00.000Z' })])
      return 7
    })
    expect(r).toBe(7)
    expect((await db.students.get('s1'))?.updated_at).toBe(T0)
    expect((await db.students.get('s2'))?.updated_at).toBe('2001-01-01T00:00:00.000Z')
  })

  it('자동 묶음(db.students.put)은 병합 표가 없다', async () => {
    const db = vdb()
    const now = new Date().toISOString()
    await mergeWrite(db, [db.students], () => db.students.put(student('s0')))
    await db.students.put(student('s1'))
    expect((await db.students.get('s1'))!.updated_at >= now).toBe(true)
    await db.transaction('rw', db.students, () => db.students.put(student('s2')))
    expect((await db.students.get('s2'))!.updated_at >= now).toBe(true)
    // 바깥 보통 묶음 안의 mergeWrite: 안쪽만 병합
    await db.transaction('rw', db.students, async () => {
      await mergeWrite(db, [db.students], () => db.students.put(student('s3')))
      await db.students.put(student('s4'))
    })
    expect((await db.students.get('s3'))!.updated_at).toBe(T0)
    expect((await db.students.get('s4'))!.updated_at >= now).toBe(true)
    expect((await db.students.get('s0'))!.updated_at).toBe(T0)
  })

  it('raw 묶음이 아닌데 _enc 있는 값 → reject, _broken 값 put → reject', async () => {
    const db = vdb()
    await db.students.put(student('s1'))
    const raw = (await readRaw(db, 'students'))[0]
    await expect(db.students.put(raw as unknown as StudentRec)).rejects.toThrow()
    await expect(mergeWrite(db, [db.students], () => db.students.put(raw as unknown as StudentRec))).rejects.toThrow()
    await expect(db.students.put({ id: 's1', _broken: true } as unknown as StudentRec)).rejects.toThrow('손상된 기록은 저장할 수 없습니다')
    await expect(rawWrite(db, [db.students], () => db.students.put({ id: 's1', _broken: true } as unknown as StudentRec)))
      .rejects.toThrow('손상된 기록은 저장할 수 없습니다')
    expect((await db.students.get('s1'))?.name).toBe('가상학생')
  })

  it('손상 행: toArray에서 빠지고 onBrokenRow 1회, readRaw에는 남음', async () => {
    const db = vdb()
    await db.students.bulkPut([student('s1'), student('s2', { name: '둘' }), student('s3', { name: '셋' })])
    await breakRow(db, 's2')
    const seen: { table: string; id: unknown }[] = []
    const off = onBrokenRow(e => seen.push(e))
    try {
      expect((await db.students.toArray()).map(s => s.id)).toEqual(['s1', 's3'])
      expect(seen).toEqual([{ table: 'students', id: 's2' }])
      expect((await readRaw(db, 'students')).map(r => r.id)).toEqual(['s1', 's2', 's3'])
      expect(await db.students.get('s2')).toBeUndefined()
      expect((await db.students.bulkGet(['s1', 's2', 's3'])).map(s => s?.id)).toEqual(['s1', undefined, 's3'])
      expect((await db.students.where('class_id').equals('c1').toArray()).map(s => s.id)).toEqual(['s1', 's3'])
      expect((await db.students.filter(() => true).toArray()).map(s => s.id)).toEqual(['s1', 's3'])
      const each: string[] = []
      await db.students.orderBy('class_id').each(s => { each.push(s.id) })
      expect(each).toEqual(['s1', 's3'])
    } finally { off() }
  })

  it('손상 행은 modify·update가 건너뛰고 덮어쓰지 않는다', async () => {
    const db = vdb()
    await db.students.bulkPut([student('s1'), student('s2')])
    await breakRow(db, 's2')
    const before = (await readRaw(db, 'students')).find(r => r.id === 's2')!
    expect(await db.students.where('class_id').equals('c1').modify({ memo: 'm' })).toBe(1)
    expect(await db.students.toCollection().modify(s => { s.hobby = 'h' })).toBe(1)
    expect(await db.students.update('s2', { memo: 'x' })).toBe(0)
    const after = (await readRaw(db, 'students')).find(r => r.id === 's2')!
    expect(after).toEqual(before)
    expect((await db.students.get('s1'))?.memo).toBe('m')
  })

  it('first()·limit은 손상 행을 건너뛰고 다음 행을 낸다', async () => {
    const db = vdb()
    await db.students.bulkPut([student('s1'), student('s2'), student('s3')])
    await breakRow(db, 's1')
    expect((await db.students.orderBy('id').first())?.id).toBe('s2')
    expect((await db.students.orderBy('id').limit(2).toArray()).map(s => s.id)).toEqual(['s2', 's3'])
  })

  it('liveQuery가 put 뒤 다시 낸다', async () => {
    const db = vdb()
    await db.students.put(student('s1'))
    const got: string[][] = []
    await new Promise<void>((resolve, reject) => {
      const sub = liveQuery(() => db.students.where('class_id').equals('c1').toArray()).subscribe({
        next: v => {
          got.push(v.map(s => s.name))
          if (got.length === 1) db.students.put(student('s2', { name: '새학생' })).catch(reject)
          if (got.length === 2) { sub.unsubscribe(); resolve() }
        },
        error: reject,
      })
    })
    expect(got[0]).toEqual(['가상학생'])
    expect(got[1].sort()).toEqual(['가상학생', '새학생'].sort())
  })

  it("Collection.filter(s => s.name === '가상학생')가 찾는다", async () => {
    const db = vdb()
    await db.students.bulkPut([student('s1'), student('s2', { name: '다른' })])
    expect((await db.students.filter(s => s.name === '가상학생').toArray()).map(s => s.id)).toEqual(['s1'])
  })

  it('커서 감싸개는 원본 커서의 getter를 상속하지 않는다(실제 브라우저 IDBCursor 브랜드 검사)', async () => {
    // 실제 Chromium의 IDBCursor.key/primaryKey getter는 플랫폼 객체가 아니면 TypeError(Illegal invocation).
    // fake-indexeddb는 검사하지 않으므로, 아래 층에서 사설 필드로 같은 검사를 하는 커서로 감싼다.
    class BrandedCursor {
      #c: DBCoreCursor
      constructor(c: DBCoreCursor) { this.#c = c }
      get trans() { return this.#c.trans }
      get key() { return this.#c.key }
      get primaryKey() { return this.#c.primaryKey }
      get value() { return this.#c.value }
      get done() { return this.#c.done }
      continue(k?: unknown) { return k === undefined ? this.#c.continue() : this.#c.continue(k) }
      continuePrimaryKey(k: unknown, pk: unknown) { return this.#c.continuePrimaryKey(k, pk) }
      advance(n: number) { return this.#c.advance(n) }
      start(cb: () => void) { return this.#c.start(cb) }
      stop(v?: unknown) { return this.#c.stop(v) }
      next() { return this.#c.next().then(() => this) }
      fail(e: Error) { return this.#c.fail(e) }
    }
    const db = openTestVaultDb(); dbs.push(db)
    db.use({
      stack: 'dbcore', name: 'test-brand', level: 2.5,
      create: (down: DBCore) => ({
        ...down,
        table: (n: string) => {
          const t = down.table(n)
          return { ...t, openCursor: (req) => t.openCursor(req).then(c => c && (new BrandedCursor(c) as unknown as DBCoreCursor)) }
        },
      }),
    })
    await db.students.bulkPut([student('s1', { number: 1 }), student('s2', { number: 2, class_id: 'c2' }), student('s3', { number: 3 })])
    await breakRow(db, 's3')
    const pks: unknown[] = []
    await db.students.orderBy('class_id').each((_v, c) => { pks.push(c.primaryKey) })
    expect(pks).toEqual(['s1', 's2'])
    expect(await db.students.filter(s => s.number === 1).primaryKeys()).toEqual(['s1'])
    expect(await db.transaction('rw', db.students, () => db.students.filter(s => s.number === 1).primaryKeys())).toEqual(['s1'])
    expect(await db.students.filter(s => s.number === 1).modify({ memo: 'm' })).toBe(1)
    expect((await db.students.get('s1'))?.memo).toBe('m')
    expect(await db.students.where('class_id').anyOf(['c1', 'c2']).modify({ hobby: 'h' })).toBe(2)
    expect((await db.students.toArray()).map(s => s.hobby)).toEqual(['h', 'h'])
    expect(await db.students.orderBy('class_id').keys()).toEqual(['c1', 'c1', 'c2'])
  })

  it('손상 행과 count·delete 경로(문서화한 동작)', async () => {
    const db = vdb()
    await db.students.bulkPut([student('s1'), student('s2'), student('s3', { class_id: 'c2' })])
    await breakRow(db, 's2')
    expect(await db.students.count()).toBe(3) // count는 통과: 손상 행도 셈
    expect(await db.students.where('class_id').equals('c1').delete()).toBe(1) // 색인 범위: 손상 행 남김
    expect((await readRaw(db, 'students')).map(r => r.id)).toEqual(['s2', 's3'])
    await db.students.toCollection().delete() // 전체 범위: deleteRange라 손상 행도 지움
    expect(await readRaw(db, 'students')).toEqual([])
  })
})
