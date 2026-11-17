#!/usr/bin/env node
// 실제 Chromium IndexedDB에서 암호화 미들웨어를 확인한다(fake-indexeddb가 놓치는 것: IDBCursor 브랜드 검사 등).
// 사용: node scripts/vault-browser-smoke.mjs   (playwright + chromium 필요, esbuild는 vite와 함께 설치됨)
// 실패가 하나라도 있으면 종료 코드 1. Task 20이 성능 확인으로 넓힌다.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vault = (f) => JSON.stringify(path.join(root, 'src/lib/vault', f))

const entry = `
import { liveQuery } from 'dexie'
import { openTestVaultDb } from ${vault('testing.ts')}
import { readRaw, rawWrite, onBrokenRow } from ${vault('middleware.ts')}
import { attachFile, readFile, createNote } from ${JSON.stringify(path.join(root, 'src/lib/notes/notes.ts'))}
import Dexie from 'dexie'
import { AppDB } from ${JSON.stringify(path.join(root, 'src/lib/db/schema.ts'))}
import { openVaultDb } from ${vault('vaultDb.ts')}
import { setupNewVault, finishMigration } from ${vault('migrate.ts')}
import { passKeyRaw } from ${vault('keys.ts')}
import { fromBase64 } from ${JSON.stringify(path.join(root, 'src/lib/backup/crypto.ts'))}
import { exportSnapshotReport } from ${JSON.stringify(path.join(root, 'src/lib/backup/snapshot.ts'))}

const T0 = '2020-01-01T00:00:00.000Z'
const st = (id, n, over = {}) => ({ id, class_id: 'c1', number: n, name: '가상학생', address: '', birth_date: '',
  prev_school: '', phone: '010-1111-2222', hobby: '', talent: '', commute: '', friends: '', memo: '',
  guardian_name: '', guardian_phone: '', active: true, created_at: T0, updated_at: T0, deleted: false, ...over })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** 키 순서와 상관없이 같은지(풀어 낸 행은 정규 JSON 순서로 온다) */
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v
const sameData = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))

window.run = async () => {
  const out = []
  const check = async (label, f, want) => {
    try {
      const got = await f()
      out.push({ label, ok: same(got, want), got, want })
    } catch (e) {
      out.push({ label, ok: false, got: String(e), want })
    }
  }
  const db = openTestVaultDb()
  await db.students.bulkPut([st('a', 1), st('b', 2), st('c', 3, { class_id: 'c2' })])

  await check('put/get', async () => (await db.students.get('a'))?.name, '가상학생')
  await check('where().equals', async () => (await db.students.where('class_id').equals('c2').toArray()).map(s => s.id), ['c'])
  await check('orderBy().each', async () => {
    const ks = []
    await db.students.orderBy('class_id').each((v, c) => { ks.push([c.primaryKey, c.key, v.name]) })
    return ks
  }, [['a', 'c1', '가상학생'], ['b', 'c1', '가상학생'], ['c', 'c2', '가상학생']])
  await check('filter().primaryKeys()', () => db.students.filter(s => s.number === 1).primaryKeys(), ['a'])
  await check('rw filter().primaryKeys()', () =>
    db.transaction('rw', db.students, () => db.students.filter(s => s.number === 1).primaryKeys()), ['a'])
  await check('filter().modify()', async () => {
    const n = await db.students.filter(s => s.number === 1).modify({ memo: 'm' })
    return [n, (await db.students.get('a'))?.memo]
  }, [1, 'm'])
  await check('where().anyOf().modify()', async () => {
    const n = await db.students.where('class_id').anyOf(['c1', 'c2']).modify({ hobby: 'h' })
    return [n, (await db.students.toArray()).map(s => s.hobby)]
  }, [3, ['h', 'h', 'h']])
  await check('update()', async () => [await db.students.update('b', { memo: 'u' }), (await db.students.get('b'))?.memo], [1, 'u'])
  await check('count()', () => db.students.count(), 3)
  await check('raw rows contain no 가상학생/전화', async () => {
    const dec = new TextDecoder()
    const text = (await readRaw(db, 'students')).map(r => JSON.stringify({ ...r, _enc: undefined }) + dec.decode(r._enc)).join('')
    return [text.includes('가상학생'), text.includes('010-1111-2222'), text.includes('class_id')]
  }, [false, false, true])
  await check('liveQuery fires after put', () => new Promise((resolve, reject) => {
    const seen = []
    const sub = liveQuery(() => db.students.where('class_id').equals('c2').toArray()).subscribe({
      next: (v) => {
        seen.push(v.map(s => s.id))
        if (seen.length === 1) db.students.put(st('d', 4, { class_id: 'c2' })).catch(reject)
        else { sub.unsubscribe(); resolve(seen) }
      },
      error: reject,
    })
    setTimeout(() => { sub.unsubscribe(); resolve(seen) }, 3000)
  }), [['c'], ['c', 'd']])

  // 손상 행 하나(b): 읽기·커서·modify에서 빠지고 원시 행은 남는다
  const raw = (await readRaw(db, 'students')).find(r => r.id === 'b')
  const enc = raw._enc.slice(); enc[enc.length - 1] ^= 0xff
  await rawWrite(db, [db.students], () => db.students.put({ ...raw, _enc: enc }))
  const broken = []
  const off = onBrokenRow(e => broken.push(e.id))
  await check('broken: toArray skips', async () => (await db.students.toArray()).map(s => s.id), ['a', 'c', 'd'])
  await check('broken: orderBy().each skips', async () => {
    const ks = []; await db.students.orderBy('class_id').each((_v, c) => { ks.push(c.primaryKey) }); return ks
  }, ['a', 'c', 'd'])
  await check('broken: filter().modify skips', () => db.students.filter(() => true).modify({ memo: 'z' }), 3)
  await check('broken: raw row unchanged', async () =>
    Array.from((await readRaw(db, 'students')).find(r => r.id === 'b')._enc).join(','), Array.from(enc).join(','))
  await check('broken: notified', async () => broken.includes('b'), true)
  off()
  await check('Collection.delete() (index range)', async () =>
    [await db.students.where('class_id').equals('c2').delete(), (await db.students.toArray()).map(s => s.id)], [2, ['a']])
  await check('Collection.delete() (full range)', async () => {
    await db.students.toCollection().delete()
    return (await readRaw(db, 'students')).length
  }, 0)
  await check('9MB attachment round-trip (chunked)', async () => {
    const n = await createNote(db)
    const bytes = new Uint8Array(9 * 1024 * 1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff
    const f = await attachFile(db, n.id, { name: 'big.bin', mime: '', bytes })
    const back = (await readFile(db, f.id)).bytes
    let eq = back.length === bytes.length
    for (let i = 0; eq && i < bytes.length; i++) if (back[i] !== bytes[i]) eq = false
    const raw = await readRaw(db, 'note_blobs')
    return [eq, raw.length, (await db.note_files.get(f.id)).chunks]
  }, [true, 9, 9])
  db.close()
  await db.delete()

  // 옮기기: 작은 평문 DB(학생·출결·노트+첨부) → 암호화 vault, 같은 자료로 열리고 옛 DB는 없어진다
  await check('migrate plaintext → vault', async () => {
    const oldName = 'class-manager-smoke'
    await Dexie.delete(oldName)
    const old = new AppDB(oldName)
    await old.students.bulkAdd([st('s1', 1, { updated_at: T0 }), st('s2', 2)])
    await old.attendance.add({ id: 'a1', student_id: 's1', date: '2026-03-04', kind: '결석', category: '질병', period: null,
      reason: '가상 사유', evidence_type: null, memo: '', created_at: T0, updated_at: T0, deleted: false })
    const n = await createNote(old, '가상 노트')
    const bytes = new TextEncoder().encode('가상 첨부 내용 0123456789')
    const f = await attachFile(old, n.id, { name: 'a.txt', mime: 'text/plain', bytes })
    const before = { students: await old.students.toArray(), attendance: await old.attendance.toArray(), notes: await old.notes.toArray() }
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const passKey = { salt, iter: 1000, raw: await passKeyRaw('가상시험암호구', salt, 1000) }
    let payload
    const r = await setupNewVault({ passKey, migrateFrom: old, store: async (p) => { payload = p }, reset: async () => true })
    // 새 백업이 모든 첨부를 담는지(빠진 수) 실제 브라우저에서 센다: 0일 때만 옛 DB를 지울 수 있다
    const { skipped } = await exportSnapshotReport(r.db)
    await finishMigration(old, r.db, { vault: payload, verify: r.verify, backup: { kind: 'download', name: 'smoke.enc', skipped } })
    r.db.close()
    const v = openVaultDb(payload.dbName, fromBase64(payload.dekB64))
    const after = { students: await v.students.toArray(), attendance: await v.attendance.toArray(), notes: await v.notes.toArray() }
    const back = (await readFile(v, f.id)).bytes
    const raw = (await readRaw(v, 'students')).map(r => JSON.stringify({ ...r, _enc: undefined }) + new TextDecoder().decode(r._enc)).join('')
    const res = [
      sameData(after, before), new TextDecoder().decode(back), (await Dexie.getDatabaseNames()).includes(oldName),
      (await v.meta.get('vault'))?.complete, raw.includes('가상학생'), raw.includes('010-1111-2222'), r.verify.ok,
    ]
    v.close()
    await Dexie.delete(payload.dbName)
    return res
  }, [true, '가상 첨부 내용 0123456789', false, true, false, false, true])
  return out
}
`

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'js', sourcefile: 'smoke-entry.js' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  define: { 'import.meta.env.MODE': '"production"' },
  logLevel: 'error',
})
const js = bundle.outputFiles[0].text
const html = '<!doctype html><meta charset="utf-8"><script src="b.js"></script>'

const server = createServer((req, res) => {
  if (req.url === '/b.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(js) }
  else { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html) }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

let failed = 0
// playwright는 package.json에 없다(전역 설치를 NODE_PATH로 찾는다). require는 NODE_PATH를 따른다.
let chromium
try {
  ;({ chromium } = createRequire(import.meta.url)('playwright'))
} catch {
  console.error('playwright가 없습니다: npm i -g playwright && npx playwright install chromium')
  process.exit(2)
}
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => { console.log('pageerror:', e.message); failed++ })
  await page.goto(`http://127.0.0.1:${port}/`)
  console.log('browser:', browser.version())
  const results = await page.evaluate(() => window.run())
  for (const r of results) {
    if (!r.ok) failed++
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.ok ? '' : `  got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`}`)
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`)
} finally {
  await browser.close()
  server.close()
}
process.exit(failed ? 1 : 0)
