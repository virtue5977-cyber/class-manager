// @vitest-environment node
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
type Cur = Record<string, any>
const C = require('../../../electron/updateCore.cjs') as {
  canonicalUpdate: (u: any) => string
  verifySig2: (u: any, pem: string) => boolean
  verifyInstall: (info: any, sha: string, pem: string, now?: Date) => { ok: boolean; message?: string; warning?: string; needManifest: boolean }
  buildManifest: (dir: string) => Record<string, string>
  checkManifest: (dir: string, m: Record<string, string>, o?: { quick?: boolean; cache?: any }) => { ok: boolean; bad: string[]; cache: any }
  decideStart: (cur: Cur | null) => { use: 'current' | 'prev' | 'builtin'; skip?: string; next: Cur | null }
  markAlive: (cur: Cur) => Cur
  markClean: (cur: Cur) => Cur
  recordFailure: (cur: Cur) => Cur
  rollback: (cur: Cur) => { use: 'prev' | 'builtin'; skip: string; next: Cur }
  normalizeCurrent: (raw: any) => Cur | null
  readCurrent: (dir: string) => Cur | null
  writeCurrentAtomic: (dir: string, cur: Cur) => void
  pruneBundles: (dir: string, keep: string[], protect?: string | null) => string[]
  bundleVersion: (name: string) => string | null
  versionGte: (a: string, b: string) => boolean
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sign2 = (u: any) => crypto.sign(null, Buffer.from(C.canonicalUpdate(u)), privateKey).toString('base64')
const oldSig = (u: any) => crypto.sign(null, Buffer.from(`${u.version}\n${u.shell}\n${u.sha256}`), privateKey).toString('base64')
const base = () => ({ version: '1.0.0', shell: 7, bundle: 'bundle-1.0.0.zip', sha256: 'ab'.repeat(32), note: '고침', date: '2026-11-16', expires: '2027-03-16' })

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

test('canonicalUpdate: 일곱 키만 정렬 순서로(다른 키·키 순서 무시)', () => {
  const u = base()
  const s = C.canonicalUpdate({ sig: 'x', ...u, extra: 1 })
  expect(Object.keys(JSON.parse(s))).toEqual(['bundle', 'date', 'expires', 'note', 'sha256', 'shell', 'version'])
  const rev = Object.fromEntries(Object.entries(u).reverse())
  expect(C.canonicalUpdate(rev)).toBe(s)
})

test('sig2: 바른 서명 통과, note·bundle·expires 바꾸면 실패, 다른 열쇠·깨진 값 실패', () => {
  const u = { ...base(), sig2: '' }
  u.sig2 = sign2(u)
  expect(C.verifySig2(u, PUB)).toBe(true)
  expect(C.verifySig2({ ...u, note: '다른 설명' }, PUB)).toBe(false)
  expect(C.verifySig2({ ...u, bundle: 'https://evil.example/x.zip' }, PUB)).toBe(false)
  expect(C.verifySig2({ ...u, expires: '2099-01-01' }, PUB)).toBe(false)
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  expect(C.verifySig2(u, other)).toBe(false)
  expect(C.verifySig2({ ...u, sig2: 'not base64!!' }, PUB)).toBe(false)
  expect(C.verifySig2({ ...u, sig2: undefined }, PUB)).toBe(false)
})

test('verifyInstall: sha·옛 sig·sig2 모두 맞아야, 1.0 이상은 sig2 필수, 기한 지나면 경고만', () => {
  const u: any = base()
  u.sig = oldSig(u)
  u.sig2 = sign2(u)
  const now = new Date('2026-12-01T00:00:00Z')
  expect(C.verifyInstall(u, u.sha256, PUB, now)).toMatchObject({ ok: true, needManifest: true })
  expect(C.verifyInstall(u, u.sha256, PUB, now).warning).toBeUndefined()
  expect(C.verifyInstall(u, 'cd'.repeat(32), PUB, now).ok).toBe(false)
  expect(C.verifyInstall({ ...u, sig: oldSig({ ...u, shell: 6 }) }, u.sha256, PUB, now).ok).toBe(false)
  expect(C.verifyInstall({ ...u, note: '바꿈' }, u.sha256, PUB, now).ok).toBe(false)
  const { sig2: _s, ...noSig2 } = u
  expect(C.verifyInstall(noSig2, u.sha256, PUB, now).ok).toBe(false)
  // 1.0 미만은 sig2 없이도(옛 묶음), 있으면 맞아야
  const old: any = { ...base(), version: '0.18.2', shell: 6 }
  old.sig = oldSig(old)
  expect(C.verifyInstall(old, old.sha256, PUB, now)).toMatchObject({ ok: true, needManifest: false })
  expect(C.verifyInstall({ ...old, sig2: 'AAAA' }, old.sha256, PUB, now).ok).toBe(false)
  const late = C.verifyInstall(u, u.sha256, PUB, new Date('2027-04-01T00:00:00Z'))
  expect(late.ok).toBe(true)
  expect(late.warning).toBe('업데이트 서명 기한이 지났습니다')
})

const mkBundle = (root: string) => {
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'index.html'), '<html>')
  fs.writeFileSync(path.join(root, 'assets', 'index-abc.js'), 'entry')
  fs.writeFileSync(path.join(root, 'assets', 'chunk-1.js'), 'chunk')
  fs.writeFileSync(path.join(root, 'assets', 'style.css'), 'css')
}

test('buildManifest: 상대 경로(/)→sha256, manifest.json 자신은 빠짐', () => {
  mkBundle(dir)
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}')
  const m = C.buildManifest(dir)
  expect(Object.keys(m).sort()).toEqual(['assets/chunk-1.js', 'assets/index-abc.js', 'assets/style.css', 'index.html'])
  expect(m['index.html']).toBe(crypto.createHash('sha256').update('<html>').digest('hex'))
})

test('checkManifest(전체): 파일 하나 바꾸면 bad에 그 파일, 빠진 파일·목록에 없는 파일도 bad', () => {
  mkBundle(dir)
  const m = C.buildManifest(dir)
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m))
  expect(C.checkManifest(dir, m)).toMatchObject({ ok: true, bad: [] })
  fs.writeFileSync(path.join(dir, 'assets', 'chunk-1.js'), 'evil')
  expect(C.checkManifest(dir, m)).toMatchObject({ ok: false, bad: ['assets/chunk-1.js'] })
  fs.writeFileSync(path.join(dir, 'assets', 'chunk-1.js'), 'chunk')
  fs.writeFileSync(path.join(dir, 'assets', 'extra.js'), 'x')
  fs.rmSync(path.join(dir, 'assets', 'style.css'))
  expect(C.checkManifest(dir, m).bad.sort()).toEqual(['assets/extra.js', 'assets/style.css'])
  // 경로가 바깥을 가리키면 bad
  expect(C.checkManifest(dir, { '../x': 'aa' }).bad).toContain('../x')
})

test('checkManifest(quick): index.html·진입 파일은 늘 확인, 나머지는 크기·시각이 바뀐 것만', () => {
  mkBundle(dir)
  const m = C.buildManifest(dir)
  // 시각은 초 단위로 고정(파일 시스템 정밀도 차이로 흔들리지 않게)
  const T = new Date('2026-01-01T00:00:00Z')
  const chunk = path.join(dir, 'assets', 'chunk-1.js')
  fs.utimesSync(chunk, T, T)
  const full = C.checkManifest(dir, m)
  expect(full.ok).toBe(true)
  // 같은 크기·같은 시각으로 바꾼 조각은 quick이 못 본다(비용 줄임)
  fs.writeFileSync(chunk, 'CHUNK')
  fs.utimesSync(chunk, T, T)
  expect(C.checkManifest(dir, m, { quick: true, cache: full.cache }).ok).toBe(true)
  // 시각이 바뀌면 다시 해시해 잡는다
  fs.utimesSync(chunk, new Date(), new Date(Date.now() + 5000))
  expect(C.checkManifest(dir, m, { quick: true, cache: full.cache }).bad).toEqual(['assets/chunk-1.js'])
  fs.writeFileSync(chunk, 'chunk')
  // index.html·진입 파일은 캐시와 상관없이 늘 해시
  const entry = path.join(dir, 'assets', 'index-abc.js')
  fs.writeFileSync(entry, 'ENTRY')
  const fresh = C.checkManifest(dir, m, { quick: false })
  expect(fresh.bad).toEqual(['assets/index-abc.js'])
  fs.writeFileSync(entry, 'entry')
  fs.utimesSync(entry, T, T)
  const c2 = C.checkManifest(dir, m).cache
  expect(c2['assets/index-abc.js'].mtimeMs).toBe(T.getTime())
  fs.writeFileSync(entry, 'ENTRY')
  fs.utimesSync(entry, T, T)
  expect(C.checkManifest(dir, m, { quick: true, cache: c2 }).bad).toEqual(['assets/index-abc.js'])
})

const cur = (o: Cur = {}): Cur => ({
  version: '1.0.1', shell: 7, dir: 'v1.0.1-2', prev: { version: '1.0.0', shell: 7, dir: 'v1.0.0-1' }, failedStarts: 0, cleanExit: true, skip: [], ...o,
})

test('decideStart: 정상 종료였으면 current, 다음은 cleanExit=false(alive 기다림)', () => {
  const d = C.decideStart(cur())
  expect(d.use).toBe('current')
  expect(d.skip).toBeUndefined()
  expect(d.next).toMatchObject({ failedStarts: 0, cleanExit: false, dir: 'v1.0.1-2' })
})

test('decideStart: alive 없이 끝난 실행 1번이면 current 유지(failedStarts 1)', () => {
  const d = C.decideStart(cur({ cleanExit: false }))
  expect(d.use).toBe('current')
  expect(d.next).toMatchObject({ failedStarts: 1, cleanExit: false })
})

test('decideStart: 2번 연속이면 prev로 가고 그 판을 skip', () => {
  const d1 = C.decideStart(cur({ cleanExit: false }))
  const d2 = C.decideStart(d1.next)
  expect(d2.use).toBe('prev')
  expect(d2.skip).toBe('1.0.1')
  expect(d2.next).toMatchObject({ version: '1.0.0', dir: 'v1.0.0-1', prev: null, failedStarts: 0, skip: ['1.0.1'] })
  expect(d2.next!.notice).toBeTruthy()
  // 실행 중 기록된 실패(render-process-gone 등) 2번도 같다
  const r = C.recordFailure(C.recordFailure(cur()))
  expect(r).toMatchObject({ failedStarts: 2, cleanExit: true })
  expect(C.decideStart(r).use).toBe('prev')
})

test('decideStart: cleanExit(사용자가 닫음)이면 세지 않는다', () => {
  let c = cur()
  for (let i = 0; i < 5; i++) c = C.markClean(C.decideStart(c).next!)
  expect(c.failedStarts).toBe(0)
  expect(C.decideStart(c).use).toBe('current')
})

test('decideStart: alive가 오면 failedStarts가 0으로', () => {
  const d = C.decideStart(cur({ cleanExit: false, failedStarts: 0 }))
  expect(C.markAlive(d.next!)).toMatchObject({ failedStarts: 0, cleanExit: true })
  expect(C.decideStart({ ...cur({ cleanExit: false, failedStarts: 1 }), alive: true }).use).toBe('current')
})

test('decideStart: prev가 없으면 builtin, 다음 상태는 판 없음 + skip 유지', () => {
  const d = C.decideStart(cur({ prev: null, failedStarts: 1, cleanExit: false, skip: ['0.9.0'] }))
  expect(d.use).toBe('builtin')
  expect(d.skip).toBe('1.0.1')
  expect(d.next).toMatchObject({ version: null, dir: null, prev: null, skip: ['0.9.0', '1.0.1'] })
  expect(C.decideStart(d.next).use).toBe('builtin')
  expect(C.decideStart(null).use).toBe('builtin')
})

test('normalizeCurrent: 옛 {version,shell,dir}은 기본값을 채운다', () => {
  expect(C.normalizeCurrent({ version: '0.18.1', shell: 6, dir: 'v0.18.1-1' })).toEqual({
    version: '0.18.1', shell: 6, dir: 'v0.18.1-1', prev: null, failedStarts: 0, cleanExit: true, skip: [],
  })
  expect(C.normalizeCurrent('x')).toBeNull()
})

test('writeCurrentAtomic/readCurrent: 원자 쓰기, tmp 남지 않음, 깨지면 null', () => {
  C.writeCurrentAtomic(dir, cur())
  expect(C.readCurrent(dir)).toMatchObject({ version: '1.0.1' })
  expect(fs.readdirSync(dir)).toEqual(['current.json'])
  fs.writeFileSync(path.join(dir, 'current.json'), '{bad')
  expect(C.readCurrent(dir)).toBeNull()
})

test('pruneBundles: 0.18.0을 지우고 1.0.0을 남긴다(keep 밖도 지움, protect는 남김)', () => {
  for (const d of ['v0.18.0-1', 'v1.0.0-2', 'v1.0.1-3', 'v0.17.0-0']) fs.mkdirSync(path.join(dir, d))
  fs.writeFileSync(path.join(dir, 'current.json'), '{}')
  const removed = C.pruneBundles(dir, ['v1.0.0-2', 'v0.18.0-1'], 'v0.17.0-0')
  expect(removed.sort()).toEqual(['v0.18.0-1', 'v1.0.1-3'])
  expect(fs.readdirSync(dir).sort()).toEqual(['current.json', 'v0.17.0-0', 'v1.0.0-2'])
  expect(C.bundleVersion('v1.2.3-99')).toBe('1.2.3')
  expect(C.bundleVersion('current.json')).toBeNull()
  expect(C.versionGte('1.0.0', '1.0.0')).toBe(true)
  expect(C.versionGte('0.18.9', '1.0.0')).toBe(false)
})
