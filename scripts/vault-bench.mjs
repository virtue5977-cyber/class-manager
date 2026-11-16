#!/usr/bin/env node
// 실제 Chromium에서 암호화 DB 성능을 잰다(spec §11 '실제 Chromium'). 가상 자료만 쓴다.
//  A. 화면: `vite build --mode bench`로 만든 실제 앱을 `?vaultTest=1`(고정 시험 열쇠, src/lib/vault/benchHook.ts)로 열고
//     가상 자료(학급 1·학생 35·출결 1만·누가기록 2천·노트 300 등)를 넣은 뒤 홈·출결·누가기록 첫 화면에 자료가 뜨기까지 잰다.
//  B. 첨부: 10MB × 5 = 50MB 넣기·읽기, 백업 파일 만들기(buildBackupFile), 새 암호화 DB로 복원(restoreIntoNewVault).
//     각 단계의 가장 긴 main-thread long task(PerformanceObserver 'longtask')를 함께 적는다.
// 사용: NODE_PATH=$(npm root -g) node scripts/vault-bench.mjs [--runs 5] [--files 5 --mb 10] [--json out.json]
// 기준(목표): 화면 < 1000ms, 넣기·읽기 중 long task < 500ms. 기준을 넘으면 종료 코드 1(백업·복원은 기록만).
import { build as esbuild } from 'esbuild'
import { build as viteBuild } from 'vite'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const RUNS = Number(arg('--runs', 5))
const JSON_OUT = arg('--json')

let chromium
try {
  ;({ chromium } = createRequire(import.meta.url)('playwright'))
} catch {
  console.error('playwright가 없습니다: npm i -g playwright && npx playwright install chromium')
  process.exit(2)
}

// ── 빌드: 실제 앱(bench 모드: 배포와 같은 최적화, 시험 열쇠 주입만 켜짐) + 첨부 시험 묶음 ──
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watson-bench-'))
await viteBuild({ root, mode: 'bench', logLevel: 'error', build: { outDir, emptyOutDir: true, reportCompressedSize: false } })

const src = (f) => JSON.stringify(path.join(root, 'src', f))
const attEntry = `
import { openTestVaultDb } from ${src('lib/vault/testing.ts')}
import { attachFile, readFile, createNote } from ${src('lib/notes/notes.ts')}
import { setupPassphrase, getCachedKey, buildBackupFile } from ${src('lib/backup/service.ts')}
import { restoreIntoNewVault } from ${src('lib/backup/restoreVault.ts')}
import { exportSnapshot, serializeSnapshot, serializeSnapshotYielding, parseSnapshot } from ${src('lib/backup/snapshot.ts')}
import { readRaw } from ${src('lib/vault/middleware.ts')}
import Dexie from 'dexie'

const lt = []
new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push({ s: e.startTime, d: e.duration }) }).observe({ type: 'longtask', buffered: true })
const settle = () => new Promise((r) => setTimeout(r, 150))
async function step(label, f) {
  await settle()
  const t0 = performance.now()
  const v = await f()
  const t1 = performance.now()
  await settle()
  const tasks = lt.filter((e) => e.s + e.d > t0 && e.s < t1)
  return { label, ms: Math.round(t1 - t0), longest: Math.round(Math.max(0, ...tasks.map((e) => e.d))), longTasks: tasks.length, v }
}

window.runAtt = async (opt) => {
  const N = opt.files, SIZE = opt.mb * 1024 * 1024
  const out = []
  const db = openTestVaultDb()
  await db.open()
  const pass = '가상벤치시험암호구2026'
  await setupPassphrase(db, pass, { iterations: 1000 })
  const note = await createNote(db, '첨부 시험')
  const files = []
  for (let k = 0; k < N; k++) {
    const bytes = new Uint8Array(SIZE)
    // 압축되지 않는 가상 바이트(64KB씩 getRandomValues)
    for (let i = 0; i < SIZE; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(SIZE, i + 65536)))
    files.push(bytes)
  }
  const ids = []
  for (let k = 0; k < N; k++) {
    const r = await step('attach ' + opt.mb + 'MB #' + (k + 1), async () => (await attachFile(db, note.id, { name: 'f' + k + '.bin', mime: '', bytes: files[k] })).id)
    ids.push(r.v); out.push(r)
  }
  for (let k = 0; k < N; k++) {
    const r = await step('readFile ' + opt.mb + 'MB #' + (k + 1), async () => {
      const b = (await readFile(db, ids[k])).bytes
      return b.length === files[k].length && b[12345] === files[k][12345] && b[b.length - 1] === files[k][files[k].length - 1]
    })
    if (!r.v) throw new Error('readFile 내용이 다릅니다')
    out.push(r)
  }
  out.push(await step('exportSnapshot only (decrypt+base64)', async () => { await exportSnapshot(db); return true }))
  const cached = await getCachedKey(db)
  out.push(await step('ref: export + old sync serializeSnapshot', async () => serializeSnapshot(await exportSnapshot(db)).length))
  let file
  out.push(await step('backup file (export+serialize+encrypt)', async () => { file = await buildBackupFile(db, cached, new Date()); return file.length }))
  let plainBytes
  out.push(await step('ref: export + serializeSnapshotYielding', async () => (plainBytes = await serializeSnapshotYielding(await exportSnapshot(db))).length))
  out.push(await step('ref: parseSnapshot only (decode+JSON.parse)', async () => !!parseSnapshot(plainBytes)))
  plainBytes = null
  let dbName
  out.push(await step('restore into new vault (parse+seal+import)', async () => {
    const r = await restoreIntoNewVault(file, pass, { store: async () => {} })
    dbName = r.dbName
    return r.dbName
  }))
  // 복원된 DB에서 같은 첨부가 나오는지(열쇠는 restore가 새로 만들므로 원시 행 수만 본다)
  const restoredBlobRows = await (async () => { const d = new Dexie(dbName); await d.open(); const n = await d.table('note_blobs').count(); d.close(); return n })()
  out.push({ label: 'restored note_blobs rows', ms: 0, longest: 0, longTasks: 0, v: restoredBlobRows })
  out.push({ label: 'source note_blobs rows', ms: 0, longest: 0, longTasks: 0, v: (await readRaw(db, 'note_blobs')).length })
  out.push({ label: 'backup file MB', ms: 0, longest: 0, longTasks: 0, v: Math.round(file.length / 1048576 * 10) / 10 })
  db.close(); await db.delete(); await Dexie.delete(dbName)
  return out
}
`
const att = await esbuild({
  stdin: { contents: attEntry, resolveDir: root, loader: 'js', sourcefile: 'bench-att.js' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  define: { 'import.meta.env.MODE': '"production"', 'import.meta.env.DEV': 'false' },
  logLevel: 'error',
})
const attJs = att.outputFiles[0].text

const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/att.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(attJs) }
  if (p === '/att.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><script src="att.js"></script>') }
  const f = path.join(outDir, p === '/' ? 'index.html' : p)
  if (!f.startsWith(outDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': (types[path.extname(f)] || 'application/octet-stream') + (f.endsWith('.html') || f.endsWith('.js') ? '; charset=utf-8' : '') })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

// ── 가상 자료 넣기(앱 페이지 안에서, 앱이 연 그 암호화 DB로) ──
async function seed({ students, attendance, logs, notes, reflections }) {
  const db = window.__watsonVaultTest.db
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }
  const T = new Date().toISOString()
  const meta = (id) => ({ id, created_at: T, updated_at: T, deleted: false })
  const text = (n, k) => Array.from({ length: n }, (_, i) => `가상 문장 ${k}-${i}: 수업 태도가 성실하고 친구들과 잘 어울림.`).join(' ')
  const t0 = performance.now()
  const year = new Date().getFullYear()
  await db.classes.put({ ...meta('bench-class'), school_year: year, grade: 2, class_no: 3 })
  await db.device_local.put({ id: 'currentClassId', value: 'bench-class' }) // 학급을 고른 상태(setCurrentClassId와 같음)
  const studs = Array.from({ length: students }, (_, i) => ({
    ...meta(`bench-s${i}`), class_id: 'bench-class', number: i + 1, name: `가상학생${i + 1}`, address: '가상시 가상구 1', birth_date: '2010-01-01',
    prev_school: '가상초', phone: '010-0000-0000', hobby: '독서', talent: '', commute: '도보', friends: '', memo: text(2, i),
    guardian_name: '가상보호자', guardian_phone: '010-0000-0001', active: true,
  }))
  await db.students.bulkPut(studs)
  const KINDS = ['결석', '지각', '조퇴', '결과'], CATS = ['질병', '미인정', '출석인정']
  const att = []
  for (let k = 0; k < attendance; k++) {
    const kind = KINDS[k % 4]
    att.push({ ...meta(`bench-a${k}`), student_id: `bench-s${k % students}`, date: daysAgo(Math.floor(k / students)), kind, category: CATS[k % 3],
      period: kind === '결석' ? null : String((k % 7) + 1), reason: `가상 사유 ${k}`, evidence_type: null, memo: '' })
  }
  for (let i = 0; i < att.length; i += 2000) await db.attendance.bulkPut(att.slice(i, i + 2000))
  const ST = ['미정리', '정리됨', '나이스 입력 완료']
  const lg = Array.from({ length: logs }, (_, k) => ({
    ...meta(`bench-l${k}`), student_id: `bench-s${k % students}`, date: daysAgo(k % 400), place: '교실', content: text(4, k),
    nuga_text: k % 3 ? text(2, k) : '', nuga_status: ST[k % 3], nuga_entered_at: null, kind: k % 2 ? '상담' : '관찰', topic: '학업', method: '대면', target: '학생',
  }))
  await db.counseling_logs.bulkPut(lg)
  const nt = Array.from({ length: notes }, (_, k) => ({
    ...meta(`bench-n${k}`), title: `가상 노트 ${k}`, pinned: k < 3,
    blocks: Array.from({ length: 12 }, (_, b) => ({ id: `b${b}`, type: b % 4 === 0 ? 'h2' : 'p', text: text(2, k * 100 + b) })),
  }))
  await db.notes.bulkPut(nt)
  await db.reflections.bulkPut(Array.from({ length: reflections }, (_, k) => ({
    ...meta(`bench-r${k}`), student_id: `bench-s${k % students}`, date: daysAgo(k), reason: '가상 사유', lines: Array.from({ length: 16 }, (_, i) => `가상 줄 ${i}`), t1: '', t2: '', mode: 'B4',
  })))
  await db.todos.bulkPut(Array.from({ length: 30 }, (_, k) => ({ ...meta(`bench-t${k}`), parts: [`가상 할 일 ${k}`], due: daysAgo(-k), done: k % 3 === 0, done_at: null, order: k })))
  await db.notice_items.bulkPut(Array.from({ length: 50 }, (_, k) => ({ ...meta(`bench-ni${k}`), text: `가상 전달 ${k}`, start_date: daysAgo(k), end_date: daysAgo(k - 2), done: false, pinned: false, order: k })))
  await db.school_calendar.bulkPut(Array.from({ length: 200 }, (_, k) => ({ ...meta(`bench-c${k}`), date: daysAgo(100 - k), title: `가상 행사 ${k}`, type: '행사', is_class_day: true, source: 'manual', grades: null })))
  return Math.round(performance.now() - t0)
}

// 화면별 '자료가 떴다' 조건. 값싼 선택자만 쓴다(조건 확인이 시간을 흐리지 않게).
const SCREENS = [
  { name: '홈', hash: '#/', cond: `(() => { const s = [...document.querySelectorAll('span')].some((e) => e.textContent === '출결 35명'); return s && document.body.textContent.includes('가상 노트') })()` },
  { name: '출결', hash: '#/attendance', cond: `document.querySelectorAll('button.student-cell').length === 35 && document.querySelectorAll('button.student-cell .marks').length === 35` },
  { name: '누가기록', hash: '#/counseling', cond: `document.querySelectorAll('.all-logs-table tbody tr').length === 2000` },
]

/** 페이지가 뜨기 전에: long task 관찰 + 조건이 처음 참이 된 시각(performance.now, 탐색 시작 기준) 기록 */
function watch(cond) {
  window.__lt = []
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }) }).observe({ type: 'longtask', buffered: true })
  const check = new Function(`return (${cond})`)
  const tick = () => {
    if (window.__done) return
    try { if (check()) { window.__done = performance.now(); mo.disconnect() } } catch { /* 아직 없음 */ }
  }
  const mo = new MutationObserver(tick)
  document.addEventListener('DOMContentLoaded', () => { mo.observe(document.body, { subtree: true, childList: true, characterData: true }); tick() })
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const result = { env: {}, seed: {}, queries: {}, screens: [], attachments: [] }
let failed = 0
const browser = await chromium.launch()
try {
  result.env = { chromium: browser.version(), node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), runs: RUNS }
  console.log('env:', JSON.stringify(result.env))
  // 암호화 DB(1)와 비교용 평문 DB(plain)에 같은 자료를 넣고 같은 화면을 잰다(--no-plain이면 암호화만)
  for (const mode of process.argv.includes('--no-plain') ? ['1'] : ['1', 'plain']) {
    const ctx = await browser.newContext()
    // 1) 빈 앱을 열어 DB를 만들고 가상 자료를 넣는다
    const p0 = await ctx.newPage()
    p0.on('pageerror', (e) => { console.log('pageerror:', e.message); failed++ })
    await p0.goto(`${base}/?vaultTest=${mode}#/`)
    await p0.waitForFunction(() => !!window.__watsonVaultTest)
    const sizes = { students: 35, attendance: 10000, logs: 2000, notes: 300, reflections: 100 }
    result.seed[mode] = { ...sizes, ms: await p0.evaluate(seed, sizes) }
    result.seed[mode].rows = await p0.evaluate(async () => {
      const db = window.__watsonVaultTest.db
      return { attendance: await db.attendance.count(), counseling_logs: await db.counseling_logs.count(), notes: await db.notes.count() }
    })
    console.log(`[${mode}] seed:`, JSON.stringify(result.seed[mode]))
    // 참고: 화면이 부르는 조회만(풀기 포함, 그리기 제외). 새 연결에서 첫 조회(first)와 되풀이(again).
    result.queries[mode] = await p0.evaluate(async () => {
      const db = window.__watsonVaultTest.reopen() // 새 연결: 첫 조회는 캐시 없이
      const ids = (await db.students.where('class_id').equals('bench-class').toArray()).map((s) => s.id)
      // first: 이 연결에서 처음 읽기(푼 글 캐시 없음), again: 같은 조회를 다시(캐시가 있으면 데워진 상태) 세 번 중 중앙값
      const t = async (f) => { const r = []; for (let i = 0; i < 4; i++) { const t0 = performance.now(); const n = (await f()).length; r.push([performance.now() - t0, n]) } const again = r.slice(1).map((x) => x[0]).sort((a, b) => a - b); return { first: Math.round(r[0][0]), again: Math.round(again[1]), rows: r[0][1] } }
      const out = {
        'students(class)': await t(() => db.students.where('class_id').equals('bench-class').toArray()),
        'attendance(student_id anyOf, all dates)': await t(() => db.attendance.where('student_id').anyOf(ids).toArray()),
        'attendance(date = today)': await t(() => db.attendance.where('date').equals(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)).toArray()),
        'counseling_logs(student_id anyOf)': await t(() => db.counseling_logs.where('student_id').anyOf(ids).toArray()),
        'notes(all)': await t(() => db.notes.toArray()),
      }
      db.close()
      return out
    })
    console.log(`[${mode}] queries:`, JSON.stringify(result.queries[mode]))
    await p0.close()

    // 2) 화면마다 새로 불러와(전체 다시 읽기) 잰다. 첫 번은 따로(같은 브라우저라 코드 캐시는 데워져 있을 수 있음).
    for (const s of SCREENS) {
      const runs = []
      for (let i = 0; i < RUNS; i++) {
        const p = await ctx.newPage()
        p.on('pageerror', (e) => { console.log('pageerror:', e.message); failed++ })
        await p.addInitScript(watch, s.cond)
        await p.goto(`${base}/?vaultTest=${mode}&r=${i}${s.hash}`)
        await p.waitForFunction(() => !!window.__done, null, { timeout: 30000 }).catch(async (e) => {
          console.log(`${s.name}: 조건을 기다리다 멈춤. 화면 글:\n` + (await p.innerText('body')).slice(0, 1500))
          throw e
        })
        await p.waitForTimeout(300) // 늦게 오는 long task 항목
        runs.push(await p.evaluate(() => {
          const open = performance.getEntriesByName('vault-test-db')[0]?.startTime ?? 0
          const done = window.__done
          return { fromNav: Math.round(done), fromDbOpen: Math.round(done - open), longest: Math.round(Math.max(0, ...window.__lt.filter((e) => e.s < done).map((e) => e.d))) }
        }))
        await p.close()
      }
      const row = {
        mode, screen: s.name, first: runs[0].fromNav, medianFromNav: median(runs.map((r) => r.fromNav)), maxFromNav: Math.max(...runs.map((r) => r.fromNav)),
        medianFromDbOpen: median(runs.map((r) => r.fromDbOpen)), longestTask: Math.max(...runs.map((r) => r.longest)),
      }
      row.ok = row.maxFromNav < 1000
      if (!row.ok && mode === '1') failed++ // 기준은 암호화 DB에만(평문은 비교용)
      result.screens.push(row)
      console.log(`${mode === 'plain' ? 'INFO' : row.ok ? 'PASS' : 'FAIL'}  [${mode}] ${s.name}: 첫 ${row.first}ms, 중앙 ${row.medianFromNav}ms(탐색 시작부터), 최대 ${row.maxFromNav}ms, DB 열기부터 중앙 ${row.medianFromDbOpen}ms, 가장 긴 task ${row.longestTask}ms`)
    }
  await ctx.close()
  }

  // 3) 첨부 50MB
  const pa = await browser.newPage()
  pa.on('pageerror', (e) => { console.log('pageerror:', e.message); failed++ })
  await pa.goto(`${base}/att.html`)
  const steps = await pa.evaluate((o) => window.runAtt(o), { files: Number(arg('--files', 5)), mb: Number(arg('--mb', 10)) })
  for (const r of steps) {
    const gated = /^(attach|readFile)/.test(r.label)
    r.ok = gated ? r.longest < 500 : undefined
    if (gated && !r.ok) failed++
    result.attachments.push(r)
    const tag = r.ok === undefined ? 'INFO' : r.ok ? 'PASS' : 'FAIL'
    console.log(`${tag}  ${r.label}: ${r.ms}ms, 가장 긴 task ${r.longest}ms (${r.longTasks}개)${typeof r.v === 'number' || typeof r.v === 'boolean' ? ` v=${r.v}` : ''}`)
  }
  await pa.close()
} finally {
  await browser.close()
  server.close()
  fs.rmSync(outDir, { recursive: true, force: true })
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 2))
console.log(failed ? `\n${failed} over target` : '\nall within target')
process.exit(failed ? 1 : 0)
