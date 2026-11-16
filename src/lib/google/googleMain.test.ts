// @vitest-environment node
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
/* eslint-disable @typescript-eslint/no-explicit-any */
const G = require('../../../electron/googleApi.cjs') as any

// ---------- 가짜 fetch / safeStorage ----------
type Call = { url: string; method: string; headers: Record<string, string>; body?: any }
const res = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
  const isBytes = body instanceof Uint8Array
  const text = body === undefined ? '' : isBytes ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const bytes = isBytes ? (body as Uint8Array) : new TextEncoder().encode(text)
  return new Response(status === 204 || status === 308 ? null : bytes, { status, headers })
}
function fakeFetch(handler: (c: Call, i: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = async (url: string, init: any = {}) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v)
    const c = { url: String(url), method: init.method ?? 'GET', headers, body: init.body }
    calls.push(c)
    return handler(c, calls.length - 1)
  }
  return { fn, calls }
}
function fakeSafe(opts: { available?: boolean; reEncrypt?: boolean; sync?: boolean } = {}) {
  const available = opts.available ?? true
  const enc = (s: string) => Buffer.concat([Buffer.from([0x76, 0x31, 0x30, 0x00, 0xff]), Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)])
  const dec = (b: Buffer) => {
    if (b.length < 5 || b[0] !== 0x76 || b[3] !== 0 || b[4] !== 0xff) throw new Error('bad')
    return Buffer.from(b.subarray(5).map((x) => x ^ 0x5a)).toString('utf8')
  }
  const s: any = {
    encCalls: 0,
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (t: string) => { s.encCalls++; return enc(t) },
    decryptStringAsync: async (b: Buffer) => ({ result: dec(Buffer.from(b)), shouldReEncrypt: !!opts.reEncrypt }),
    enc,
    dec,
  }
  if (opts.sync) {
    s.isEncryptionAvailable = () => true
    s.decryptString = (b: Buffer) => dec(Buffer.from(b))
  }
  return s
}
let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gapi-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
const tokFile = () => path.join(dir, 'google-token.bin')
const idToken = (payload: object) => ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'c2ln'].join('.')

// ---------- 주소 정규화 ----------
test('정규화 우회 목록은 모두 거부된다', () => {
  for (const bad of [
    '/calendar/v3/../../drive/v3/x',
    '/calendar/v3/%2e%2e/oauth2',
    '/calendar/v3/%2E%2E/oauth2',
    'https://evil.com/calendar/v3/',
    '/calendar\\v3',
    '/calendar\\v3/x',
    '//evil.com/calendar/v3/',
    'https://www.googleapis.com@evil.com/calendar/v3/',
    'https://user:pw@www.googleapis.com/calendar/v3/x',
    'https://www.googleapis.com:444/calendar/v3/x',
    'http://www.googleapis.com/calendar/v3/x',
    'https://oauth2.googleapis.com/token',
    '/oauth2/v2/userinfo',
    '/drive/v3/about',
    '/drive/v3/filesX',
    '/drive/v2/files',
    '/upload/drive/v3/../../oauth2',
    '/calendar/v3/x\n',
    'calendar/v3/x',
    '',
    42,
  ]) expect(G.normalizeApiUrl(bad), String(bad)).toEqual({ ok: false })
})

test('정상 주소는 통과하고 절대 주소로 바뀐다', () => {
  expect(G.normalizeApiUrl('/calendar/v3/users/me/calendarList?minAccessRole=owner')).toEqual({ ok: true, url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner' })
  expect(G.normalizeApiUrl('/calendar/v3/calendars/a%40group.calendar.google.com/events')).toMatchObject({ ok: true })
  expect(G.normalizeApiUrl('https://www.googleapis.com/drive/v3/files?q=name%3D%27a.wsync%27')).toMatchObject({ ok: true })
  expect(G.normalizeApiUrl('/drive/v3/files')).toEqual({ ok: true, url: 'https://www.googleapis.com/drive/v3/files' })
  expect(G.normalizeApiUrl('/drive/v3/files/abc123?alt=media')).toMatchObject({ ok: true })
  expect(G.normalizeApiUrl('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=xyz')).toMatchObject({ ok: true })
})

// ---------- 권한·로그인 주소 ----------
test('권한 목록: BASE·CALENDAR, 그 밖은 거부', () => {
  expect(G.BASE_SCOPES).toEqual(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'])
  expect(G.CALENDAR_SCOPES).toEqual(['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'])
  expect(G.validScopes([...G.BASE_SCOPES, 'openid'])).toEqual(G.BASE_SCOPES)
  expect(G.validScopes(G.CALENDAR_SCOPES)).toEqual(G.CALENDAR_SCOPES)
  expect(() => G.validScopes(['https://www.googleapis.com/auth/drive'])).toThrow()
  expect(() => G.validScopes([])).toThrow()
  expect(() => G.validScopes('openid')).toThrow()
})

test('authUrl: incremental이면 prompt가 빠지고, 아니면 consent. include_granted_scopes·offline은 늘', () => {
  const base = { clientId: 'cid', redirect: 'http://127.0.0.1:5555/callback', challenge: 'ch', state: 'st', scopes: G.BASE_SCOPES }
  const a = new URL(G.authUrl({ ...base, incremental: false }))
  expect(a.origin + a.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  expect(a.searchParams.get('prompt')).toBe('consent')
  expect(a.searchParams.get('include_granted_scopes')).toBe('true')
  expect(a.searchParams.get('access_type')).toBe('offline')
  expect(a.searchParams.get('code_challenge_method')).toBe('S256')
  expect(a.searchParams.get('code_challenge')).toBe('ch')
  expect(a.searchParams.get('state')).toBe('st')
  expect(a.searchParams.get('scope')).toBe(G.BASE_SCOPES.join(' '))
  const b = new URL(G.authUrl({ ...base, scopes: G.CALENDAR_SCOPES, incremental: true }))
  expect(b.searchParams.has('prompt')).toBe(false)
  expect(b.searchParams.get('include_granted_scopes')).toBe('true')
  expect(b.searchParams.get('access_type')).toBe('offline')
})

test('emailFromIdToken: payload에서 이메일, 망가진 것은 null', () => {
  expect(G.emailFromIdToken(idToken({ email: 't@example.com', sub: '1' }))).toBe('t@example.com')
  expect(G.emailFromIdToken('a.b')).toBeNull()
  expect(G.emailFromIdToken('x.!!!.y')).toBeNull()
  expect(G.emailFromIdToken(idToken({ sub: '1' }))).toBeNull()
  expect(G.emailFromIdToken(undefined)).toBeNull()
})

// ---------- 이어 올리기 ----------
const noSleep = { sleep: async () => {} }
test('uploadResumable: 시작 POST → Location → PUT, 308이면 Range로 이어 올려 성공', async () => {
  const bytes = new Uint8Array(10).map((_, i) => i)
  const session = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=U1'
  const f = fakeFetch((_c, i) => {
    if (i === 0) return res(200, '', { location: session })
    if (i === 1) return res(308, undefined, { range: 'bytes=0-4' })
    return res(200, { id: 'FILE1' })
  })
  expect(await G.uploadResumable(f.fn, 'AT', { meta: { name: 'a.wsync', mimeType: 'application/octet-stream' }, bytes }, noSleep)).toEqual({ id: 'FILE1' })
  expect(f.calls[0].method).toBe('POST')
  expect(f.calls[0].url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=resumable/)
  expect(f.calls[0].headers.authorization).toBe('Bearer AT')
  expect(f.calls[0].headers['x-upload-content-length']).toBe('10')
  expect(JSON.parse(f.calls[0].body)).toEqual({ name: 'a.wsync', mimeType: 'application/octet-stream' })
  expect(f.calls[1]).toMatchObject({ method: 'PUT', url: session })
  expect(f.calls[1].headers['content-range']).toBe('bytes 0-9/10')
  expect(f.calls[2].headers['content-range']).toBe('bytes 5-9/10')
  expect(Array.from(f.calls[2].body as Uint8Array)).toEqual([5, 6, 7, 8, 9])
})

test('uploadResumable: fileId면 PATCH로 시작한다', async () => {
  const f = fakeFetch((_c, i) => (i === 0 ? res(200, '', { location: 'https://www.googleapis.com/upload/drive/v3/files/FID1234567?uploadType=resumable&upload_id=U2' }) : res(200, { id: 'FID1234567' })))
  expect(await G.uploadResumable(f.fn, 'AT', { meta: { name: 'a' }, bytes: new Uint8Array(3), fileId: 'FID1234567' }, noSleep)).toEqual({ id: 'FID1234567' })
  expect(f.calls[0].method).toBe('PATCH')
  expect(f.calls[0].url).toMatch(/\/upload\/drive\/v3\/files\/FID1234567\?uploadType=resumable/)
})

test('uploadResumable: 5xx·네트워크 실패 뒤 상태를 물어 이어 올린다', async () => {
  const session = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=U3'
  const f = fakeFetch((_c, i) => {
    if (i === 0) return res(200, '', { location: session })
    if (i === 1) return res(503, { error: {} })
    if (i === 2) throw new TypeError('net')
    if (i === 3) return res(308, undefined, { range: 'bytes=0-1' }) // 상태 묻기
    return res(201, { id: 'F3' })
  })
  expect(await G.uploadResumable(f.fn, 'AT', { meta: {}, bytes: new Uint8Array(4) }, noSleep)).toEqual({ id: 'F3' })
  expect(f.calls[3].headers['content-range']).toBe('bytes */4')
  expect(f.calls[4].headers['content-range']).toBe('bytes 2-3/4')
})

test('uploadResumable: 5번 실패하면 한국어 오류', async () => {
  const f = fakeFetch((_c, i) => (i === 0 ? res(200, '', { location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=U4' }) : res(503)))
  await expect(G.uploadResumable(f.fn, 'AT', { meta: {}, bytes: new Uint8Array(4) }, noSleep)).rejects.toThrow(/올리지 못했습니다/)
  expect(f.calls.length).toBe(6) // 시작 1 + 실패 5
})

test('uploadResumable: 다른 곳을 가리키는 Location에는 토큰을 보내지 않는다', async () => {
  const f = fakeFetch(() => res(200, '', { location: 'https://evil.com/upload' }))
  await expect(G.uploadResumable(f.fn, 'AT', { meta: {}, bytes: new Uint8Array(4) }, noSleep)).rejects.toThrow()
  expect(f.calls.length).toBe(1)
})

test('uploadResumable: 60MB 넘으면 보내지 않는다', async () => {
  const f = fakeFetch(() => res(200))
  await expect(G.uploadResumable(f.fn, 'AT', { meta: {}, bytes: new Uint8Array(G.MAX_BYTES + 1) }, noSleep)).rejects.toThrow(/60MB/)
  expect(f.calls.length).toBe(0)
})

// ---------- 토큰 저장 ----------
test('토큰 저장: 비동기 암호화로 쓰고 다시 읽는다(평문이 파일에 없음)', async () => {
  const safe = fakeSafe()
  const st = G.createTokenStore({ file: tokFile(), safe })
  await st.save({ refresh: '1//REFRESH-SECRET', scopes: G.BASE_SCOPES, email: 'a@b.c' })
  const raw = fs.readFileSync(tokFile())
  expect(raw.toString('latin1')).not.toContain('REFRESH-SECRET')
  const st2 = G.createTokenStore({ file: tokFile(), safe })
  expect(await st2.load()).toEqual({ refresh: '1//REFRESH-SECRET', scopes: G.BASE_SCOPES, email: 'a@b.c' })
  expect(st2.persisted()).toBe(true)
})

test('토큰 저장: 비동기 암호화를 못 쓰면 파일에 쓰지 않고 이번 실행에만', async () => {
  const st = G.createTokenStore({ file: tokFile(), safe: fakeSafe({ available: false }) })
  await st.save({ refresh: '1//R', scopes: G.BASE_SCOPES, email: null })
  expect(fs.existsSync(tokFile())).toBe(false)
  expect(await st.load()).toMatchObject({ refresh: '1//R' })
  expect(st.persisted()).toBe(false)
})

test('옛 파일(동기 암호화한 refresh 문자열) → 캘린더 권한으로 읽고 새 형식으로 다시 쓴다', async () => {
  const safe = fakeSafe()
  fs.writeFileSync(tokFile(), safe.enc('1//OLD'))
  const st = G.createTokenStore({ file: tokFile(), safe })
  expect(await st.load()).toEqual({ refresh: '1//OLD', scopes: G.CALENDAR_SCOPES, email: null })
  expect(JSON.parse(safe.dec(fs.readFileSync(tokFile())))).toMatchObject({ v: 2, refresh: '1//OLD', scopes: G.CALENDAR_SCOPES })
})

test('옛 파일: 비동기 풀기가 실패하면 동기 decryptString을 한 번 써 본다', async () => {
  const safe = fakeSafe({ sync: true })
  safe.decryptStringAsync = async () => { throw new Error('nope') }
  fs.writeFileSync(tokFile(), safe.enc('1//SYNC'))
  expect(await G.createTokenStore({ file: tokFile(), safe }).load()).toMatchObject({ refresh: '1//SYNC', scopes: G.CALENDAR_SCOPES })
})

test('옛 평문 파일 → 한 번 읽고 암호화해 덮어쓴다', async () => {
  const safe = fakeSafe()
  fs.writeFileSync(tokFile(), '1//PLAINTEXT-REFRESH')
  expect(await G.createTokenStore({ file: tokFile(), safe }).load()).toMatchObject({ refresh: '1//PLAINTEXT-REFRESH', scopes: G.CALENDAR_SCOPES })
  expect(fs.readFileSync(tokFile()).toString('latin1')).not.toContain('PLAINTEXT-REFRESH')
})

test('옛 평문 파일 + 암호화 불가 → 메모리에만 두고 평문 파일은 지운다', async () => {
  fs.writeFileSync(tokFile(), '1//PLAINTEXT-REFRESH')
  const st = G.createTokenStore({ file: tokFile(), safe: fakeSafe({ available: false }) })
  expect(await st.load()).toMatchObject({ refresh: '1//PLAINTEXT-REFRESH' })
  expect(fs.existsSync(tokFile())).toBe(false)
})

test('shouldReEncrypt면 다시 감싸 쓴다', async () => {
  const safe = fakeSafe({ reEncrypt: true })
  await G.createTokenStore({ file: tokFile(), safe }).save({ refresh: '1//R', scopes: G.BASE_SCOPES, email: null })
  const before = safe.encCalls
  await G.createTokenStore({ file: tokFile(), safe }).load()
  expect(safe.encCalls).toBe(before + 1)
})

test('망가진 파일은 연결 안 됨', async () => {
  fs.writeFileSync(tokFile(), Buffer.from([0, 1, 2, 3, 250, 251]))
  expect(await G.createTokenStore({ file: tokFile(), safe: fakeSafe() }).load()).toBeNull()
})

// ---------- 클라이언트(status·login·api·logout) ----------
function mkClient(handler: (c: Call, i: number) => Response | Promise<Response>, opts: { safe?: any } = {}) {
  const f = fakeFetch(handler)
  const store = G.createTokenStore({ file: tokFile(), safe: opts.safe ?? fakeSafe() })
  const client = G.createGoogleClient({ fetchFn: f.fn, store, readClient: () => ({ client_id: 'cid', client_secret: 'sec' }), sleep: async () => {} })
  return { f, store, client }
}
const tokenOk = (extra: object = {}) => res(200, { access_token: 'AT-' + Math.random(), expires_in: 3600, ...extra })

test('status: 연결 안 됨 → connected false, scopes []', async () => {
  const { client } = mkClient(() => res(500))
  expect(await client.status()).toEqual({ client: true, connected: false, email: null, scopes: [], sessionOnly: false })
})

test('completeLogin: 받은 scope·이메일을 저장하고 status에 보인다', async () => {
  const { client } = mkClient(() => res(500))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: G.BASE_SCOPES.join(' '), id_token: idToken({ email: 't@x.kr' }) }, G.BASE_SCOPES, false)
  expect(await client.status()).toEqual({ client: true, connected: true, email: 't@x.kr', scopes: G.BASE_SCOPES, sessionOnly: false })
})

test('completeLogin incremental: refresh_token이 없으면 기존 것을 지키고 권한을 더한다', async () => {
  const { client, store } = mkClient(() => res(500))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//KEEP', scope: G.BASE_SCOPES.join(' '), id_token: idToken({ email: 't@x.kr' }) }, G.BASE_SCOPES, false)
  await client.completeLogin({ access_token: 'AT2', scope: [...G.BASE_SCOPES, ...G.CALENDAR_SCOPES].join(' '), id_token: idToken({ email: 't@x.kr' }) }, G.CALENDAR_SCOPES, true)
  expect(await store.load()).toEqual({ refresh: '1//KEEP', scopes: [...G.BASE_SCOPES, ...G.CALENDAR_SCOPES], email: 't@x.kr' })
})

test('completeLogin: refresh_token이 없고 기존도 없으면 오류', async () => {
  const { client } = mkClient(() => res(500))
  await expect(client.completeLogin({ access_token: 'AT', scope: 'openid' }, G.BASE_SCOPES, true)).rejects.toThrow()
})

test('completeLogin incremental: 다른 계정이면 거부(기존 refresh와 섞지 않음)', async () => {
  const { client } = mkClient(() => res(500))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//A', scope: 'openid', id_token: idToken({ email: 'a@x.kr' }) }, G.BASE_SCOPES, false)
  await expect(client.completeLogin({ access_token: 'AT2', scope: 'openid', id_token: idToken({ email: 'b@x.kr' }) }, G.CALENDAR_SCOPES, true)).rejects.toThrow(/같은 계정/)
})

test('옛 설치(scope 없음) status: 캘린더 권한, 이메일 null', async () => {
  const safe = fakeSafe()
  fs.writeFileSync(tokFile(), safe.enc('1//OLD'))
  const { client } = mkClient(() => res(500), { safe })
  expect(await client.status()).toMatchObject({ connected: true, email: null, scopes: G.CALENDAR_SCOPES })
})

test('api: 허용 안 된 주소·메서드는 토큰 없이 거부', async () => {
  const { client, f } = mkClient(() => res(200, {}))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', scope: 'openid' }, G.BASE_SCOPES, false)
  await expect(client.api('GET', 'https://evil.com/calendar/v3/x')).rejects.toThrow(/허용/)
  await expect(client.api('HEAD', '/calendar/v3/x')).rejects.toThrow(/허용/)
  expect(f.calls.length).toBe(0)
})

test('api: JSON 본문·응답, 머리글은 wantHeaders일 때만(허용 목록, 소문자)', async () => {
  const { client, f } = mkClient(() => res(200, { id: 'x' }, { 'Content-Type': 'application/json', Location: 'https://www.googleapis.com/x', 'Set-Cookie': 'a=b', ETag: '"e"' }))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  expect(await client.api('POST', '/calendar/v3/calendars', { summary: 's' })).toEqual({ status: 200, json: { id: 'x' } })
  expect(f.calls[0].headers['content-type']).toBe('application/json')
  expect(f.calls[0].headers.authorization).toBe('Bearer AT')
  expect(JSON.parse(f.calls[0].body)).toEqual({ summary: 's' })
  const r = await client.api('GET', '/drive/v3/files', null, { wantHeaders: true })
  expect(r.headers).toEqual({ 'content-type': 'application/json', location: 'https://www.googleapis.com/x', etag: '"e"' })
})

test('api: 바이너리 본문·응답', async () => {
  const { client, f } = mkClient((c) => (c.method === 'GET' ? res(200, new Uint8Array([9, 8, 7]), { 'content-type': 'application/octet-stream' }) : res(200, { id: 'n' })))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  const up = await client.api('POST', '/upload/drive/v3/files?uploadType=multipart', new Uint8Array([1, 2]), { contentType: 'multipart/related; boundary=b' })
  expect(up).toEqual({ status: 200, json: { id: 'n' } })
  expect(f.calls[0].headers['content-type']).toBe('multipart/related; boundary=b')
  expect(Array.from(f.calls[0].body)).toEqual([1, 2])
  const down = await client.api('GET', '/drive/v3/files/abcdefghij?alt=media', undefined, { binary: true })
  expect(down.status).toBe(200)
  expect(Array.from(down.bytes)).toEqual([9, 8, 7])
  expect(down.json).toBeUndefined()
})

test('api: 2xx 아님 → 오류 JSON과 상태를 돌려준다(던지지 않음)', async () => {
  const { client } = mkClient(() => res(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  expect(await client.api('GET', '/drive/v3/files')).toEqual({ status: 403, json: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } })
})

test('api: 401이면 한 번 새로 고쳐 다시, 그래도 401이면 401', async () => {
  let n = 0
  const { client, f } = mkClient((c) => {
    if (c.url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk()
    n++
    return n === 1 ? res(401, { error: {} }) : res(200, { ok: 1 })
  })
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  expect(await client.api('GET', '/calendar/v3/x')).toEqual({ status: 200, json: { ok: 1 } })
  const tokenCall = f.calls.find((c) => c.url.startsWith('https://oauth2.googleapis.com/token'))!
  expect(String(tokenCall.body)).toContain('grant_type=refresh_token')
  const m = mkClient((c) => (c.url.startsWith('https://oauth2.googleapis.com/token') ? tokenOk() : res(401, { error: {} })))
  await m.client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  expect((await m.client.api('GET', '/calendar/v3/x')).status).toBe(401)
  expect(m.f.calls.filter((c) => c.url.includes('/calendar/')).length).toBe(2)
})

test('api: refresh가 invalid_grant면 401', async () => {
  const { client } = mkClient((c) => (c.url.startsWith('https://oauth2.googleapis.com/token') ? res(400, { error: 'invalid_grant' }) : res(200, {})))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 0, scope: 'openid' }, G.BASE_SCOPES, false)
  expect((await client.api('GET', '/calendar/v3/x')).status).toBe(401)
})

test('api: 로그인 안 됨 → 401', async () => {
  const { client, f } = mkClient(() => res(200, {}))
  expect((await client.api('GET', '/calendar/v3/x')).status).toBe(401)
  expect(f.calls.length).toBe(0)
})

test('download: fileId 형식, 60MB 상한(Content-Length·누적)', async () => {
  const { client } = mkClient((c) => {
    if (c.url.includes('BIGLENGTH00')) return res(200, new Uint8Array(1), { 'content-length': String(G.MAX_BYTES + 1) })
    return res(200, new Uint8Array([1, 2, 3]))
  })
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  await expect(client.download('../etc')).rejects.toThrow()
  await expect(client.download('short')).rejects.toThrow()
  expect(Array.from(await client.download('abcdefghij'))).toEqual([1, 2, 3])
  await expect(client.download('BIGLENGTH00')).rejects.toThrow(/60MB/)
})

test('download: 스트림 누적이 60MB를 넘으면 멈춘다', async () => {
  const chunk = new Uint8Array(16 * 1024 * 1024)
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(chunk); c.close() } })
  const { client } = mkClient(() => new Response(big, { status: 200 }))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  await expect(client.download('abcdefghij')).rejects.toThrow(/60MB/)
})

test('logout: 취소 요청 + 토큰 파일 삭제 + status 끊김', async () => {
  const { client, f } = mkClient(() => res(200, {}))
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid', id_token: idToken({ email: 'a@b.c' }) }, G.BASE_SCOPES, false)
  expect(fs.existsSync(tokFile())).toBe(true)
  await client.logout()
  expect(fs.existsSync(tokFile())).toBe(false)
  expect(f.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true)
  expect(await client.status()).toMatchObject({ connected: false, email: null, scopes: [] })
})

test('uploadResumable(클라이언트): 401이면 새로 고쳐 처음부터 한 번 더', async () => {
  let starts = 0
  const { client } = mkClient((c) => {
    if (c.url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk()
    if (c.method === 'POST') { starts++; return starts === 1 ? res(401) : res(200, '', { location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=Z' }) }
    return res(200, { id: 'OK' })
  })
  await client.completeLogin({ access_token: 'AT', refresh_token: '1//R', expires_in: 3600, scope: 'openid' }, G.BASE_SCOPES, false)
  expect(await client.uploadResumable({ name: 'a' }, new Uint8Array(2))).toEqual({ id: 'OK' })
})
