// 구글 통로 본체(시험됨). main.cjs는 연결만 한다. 토큰은 로그에 남기지 않는다.
const fs = require('node:fs/promises')

const BASE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file']
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']
const ALLOWED_SCOPES = new Set([...BASE_SCOPES, ...CALENDAR_SCOPES])
const API_ORIGIN = 'https://www.googleapis.com'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const MAX_BYTES = 60 * 1024 * 1024
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const RESP_HEADERS = ['location', 'content-type', 'content-length', 'etag', 'content-range', 'range', 'retry-after']
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/
const MAX_TRIES = 5

const MSG_URL = '허용되지 않은 주소입니다.'
const MSG_METHOD = '허용되지 않은 요청입니다.'
const MSG_BIG = '파일이 너무 큽니다(60MB까지).'
const MSG_NET = '구글에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'
const MSG_UPLOAD = '드라이브에 올리지 못했습니다. 잠시 뒤 다시 하세요.'
const MSG_RECONNECT = '구글 연결이 끊겼습니다. 설정에서 다시 연결하세요.'

/** 상대 경로는 www.googleapis.com 기준. new URL로 정규화한 뒤 허용 접두와 맞춘다. */
function normalizeApiUrl(input) {
  const no = { ok: false }
  if (typeof input !== 'string' || !input || input.length > 8192) return no
  if (/[\\\s\u0000-\u001f\u007f]/.test(input) || input.includes('#')) return no
  const pathPart = input.split('?')[0]
  if (pathPart.includes('..') || /%2e/i.test(pathPart) || /%2f|%5c/i.test(pathPart)) return no
  let u
  if (input.startsWith('/')) {
    if (input.startsWith('//')) return no
    try { u = new URL(API_ORIGIN + input) } catch { return no }
  } else if (input.startsWith('https://')) {
    try { u = new URL(input) } catch { return no }
  } else return no
  if (u.protocol !== 'https:' || u.hostname !== 'www.googleapis.com' || u.port !== '' || u.username || u.password || u.origin !== API_ORIGIN) return no
  const p = u.pathname
  if (p.includes('..') || /%2e/i.test(p)) return no
  const under = (pre) => p === pre || p.startsWith(pre + '/')
  if (!(p.startsWith('/calendar/v3/') || under('/drive/v3/files') || under('/upload/drive/v3/files'))) return no
  return { ok: true, url: u.toString() }
}

/** 권한은 BASE ∪ CALENDAR 안에서만(중복 제거, 순서 유지). */
function validScopes(scopes) {
  if (!Array.isArray(scopes) || !scopes.length) throw new Error('허용되지 않은 권한입니다.')
  const out = []
  for (const s of scopes) {
    if (typeof s !== 'string' || !ALLOWED_SCOPES.has(s)) throw new Error('허용되지 않은 권한입니다.')
    if (!out.includes(s)) out.push(s)
  }
  return out
}

function authUrl({ clientId, redirect, challenge, state, scopes, incremental, loginHint }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    include_granted_scopes: 'true',
  })
  if (!incremental) q.set('prompt', 'consent')
  if (incremental && typeof loginHint === 'string' && loginHint) q.set('login_hint', loginHint)
  url.search = q.toString()
  return url.toString()
}

/** 서명은 보지 않는다(토큰 응답은 TLS로 구글에서 직접 받음). payload의 email만. */
function emailFromIdToken(idToken) {
  try {
    if (typeof idToken !== 'string') return null
    const parts = idToken.split('.')
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return p && typeof p.email === 'string' && p.email.includes('@') ? p.email : null
  } catch {
    return null
  }
}

const toBytes = (b) => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null)
const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms))

/** 응답 본문을 상한까지 읽는다(Content-Length와 누적 둘 다 확인). */
async function readCapped(res, max = MAX_BYTES) {
  const len = Number(res.headers.get('content-length') || 0)
  if (len > max) {
    try { await res.body?.cancel() } catch { /* 무시 */ }
    throw new Error(MSG_BIG)
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      try { await reader.cancel() } catch { /* 무시 */ }
      throw new Error(MSG_BIG)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
const parseJson = (bytes) => {
  if (!bytes.length) return undefined
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { return undefined }
}
const pickHeaders = (res) => {
  const h = {}
  for (const k of RESP_HEADERS) {
    const v = res.headers.get(k)
    if (v != null) h[k] = v
  }
  return h
}
const expiresMs = (t) => (typeof t.expires_in === 'number' && Number.isFinite(t.expires_in) && t.expires_in >= 0 ? t.expires_in : 3600) * 1000
const httpError = (msg, status) => Object.assign(new Error(msg), { status })

/** 이어 올리기: 시작 POST(새 파일)/PATCH(fileId) → Location → PUT. 308·5xx·네트워크 실패는 Range로 이어서, 실패 5번이면 오류. */
async function uploadResumable(fetchFn, token, { meta, bytes, fileId }, { sleep = sleepDefault } = {}) {
  const data = toBytes(bytes)
  if (!data) throw new Error('올릴 내용이 없습니다.')
  if (data.length > MAX_BYTES) throw new Error(MSG_BIG)
  if (fileId != null && !FILE_ID.test(String(fileId))) throw new Error(MSG_URL)
  const m = meta && typeof meta === 'object' ? meta : {}
  const startUrl = `${API_ORIGIN}/upload/drive/v3/files${fileId ? '/' + fileId : ''}?uploadType=resumable&fields=id`
  const auth = { authorization: 'Bearer ' + token }
  const total = data.length
  let fails = 0
  const fail = async (status) => {
    fails++
    if (status === 401) throw httpError(MSG_RECONNECT, 401)
    if (fails >= MAX_TRIES) throw httpError(MSG_UPLOAD, status)
    await sleep(Math.min(8000, 500 * 2 ** (fails - 1)))
  }
  const retriable = (s) => s === 308 || s === 429 || s >= 500
  let session = null
  while (!session) {
    let r
    try {
      r = await fetchFn(startUrl, {
        method: fileId ? 'PATCH' : 'POST',
        headers: { ...auth, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(total), 'x-upload-content-type': typeof m.mimeType === 'string' ? m.mimeType : 'application/octet-stream' },
        body: JSON.stringify(m),
      })
    } catch {
      await fail(0)
      continue
    }
    if (r.ok) {
      const loc = normalizeApiUrl(r.headers.get('location') || '')
      if (!loc.ok || !loc.url.startsWith(API_ORIGIN + '/upload/drive/v3/files')) throw new Error(MSG_UPLOAD)
      session = loc.url
    } else if (r.status === 401 || !retriable(r.status)) {
      if (r.status === 401) throw httpError(MSG_RECONNECT, 401)
      throw httpError(`${MSG_UPLOAD}(${r.status})`, r.status)
    } else await fail(r.status)
  }
  let offset = 0
  let ask = false // 실패 뒤에는 어디까지 받았는지 먼저 묻는다
  const rangeEnd = (r) => {
    const m2 = /bytes=0-(\d+)/.exec(r.headers.get('range') || '')
    return m2 ? Number(m2[1]) + 1 : 0
  }
  for (;;) {
    let r
    try {
      r = ask || offset >= total
        ? await fetchFn(session, { method: 'PUT', headers: { ...auth, 'content-range': `bytes */${total}` } })
        : await fetchFn(session, { method: 'PUT', headers: { ...auth, 'content-range': `bytes ${offset}-${total - 1}/${total}` }, body: data.subarray(offset) })
    } catch {
      ask = true
      await fail(0)
      continue
    }
    if (r.status === 200 || r.status === 201) {
      const j = parseJson(await readCapped(r, 1024 * 1024))
      if (!j || typeof j.id !== 'string') throw new Error(MSG_UPLOAD)
      return { id: j.id }
    }
    if (r.status === 308) {
      offset = Math.min(rangeEnd(r), total)
      const wasAsk = ask
      ask = false
      if (!wasAsk) await fail(308)
      continue
    }
    if (retriable(r.status)) {
      ask = true
      await fail(r.status)
      continue
    }
    if (r.status === 401) throw httpError(MSG_RECONNECT, 401)
    throw httpError(`${MSG_UPLOAD}(${r.status})`, r.status)
  }
}

async function downloadFile(fetchFn, token, fileId) {
  if (typeof fileId !== 'string' || !FILE_ID.test(fileId)) throw new Error('파일 이름이 맞지 않습니다.')
  let r
  try {
    r = await fetchFn(`${API_ORIGIN}/drive/v3/files/${fileId}?alt=media`, { method: 'GET', headers: { authorization: 'Bearer ' + token } })
  } catch {
    throw new Error(MSG_NET)
  }
  if (r.status === 401) throw httpError(MSG_RECONNECT, 401)
  if (r.status === 404) throw httpError('드라이브에서 파일을 찾지 못했습니다.', 404)
  if (!r.ok) throw httpError(`드라이브에서 받지 못했습니다(${r.status}).`, r.status)
  return readCapped(r)
}

// ---- 토큰 저장: safeStorage 비동기. 못 쓰면 파일에 쓰지 않고 이번 실행에만(평문 저장 없음) ----
function parseRecord(text) {
  if (typeof text !== 'string' || !text) return null
  const t = text.trim()
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      if (j && j.v === 2 && typeof j.refresh === 'string' && j.refresh) {
        return { rec: { refresh: j.refresh, scopes: Array.isArray(j.scopes) ? j.scopes.filter((s) => typeof s === 'string') : CALENDAR_SCOPES.slice(), email: typeof j.email === 'string' ? j.email : null }, legacy: false }
      }
      if (j && typeof j.refresh_token === 'string' && j.refresh_token) return { rec: { refresh: j.refresh_token, scopes: CALENDAR_SCOPES.slice(), email: null }, legacy: true }
    } catch { /* 아래 */ }
    return null
  }
  // 옛 판: refresh 문자열 하나(받은 권한 기록 없음 → 지금까지의 캘린더 권한)
  if (/^[\x21-\x7e]{4,4096}$/.test(t)) return { rec: { refresh: t, scopes: CALENDAR_SCOPES.slice(), email: null }, legacy: true }
  return null
}

function createTokenStore({ file, safe }) {
  let cache // undefined = 아직 안 읽음, null = 없음
  let loading = null
  let persisted = false
  let chain = Promise.resolve()
  const queue = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
  const avail = async () => {
    try { return !!(await safe.isAsyncEncryptionAvailable()) } catch { return false }
  }
  async function writeFileAtomic(buf) {
    const tmp = file + '.tmp'
    await fs.writeFile(tmp, buf)
    await fs.rename(tmp, file)
  }
  // 저장: 암호화 가능하면 파일, 아니면 메모리만(남은 파일도 지운다).
  async function persist(rec) {
    if (await avail()) {
      try {
        const enc = await safe.encryptStringAsync(JSON.stringify({ v: 2, refresh: rec.refresh, scopes: rec.scopes, email: rec.email }))
        await writeFileAtomic(Buffer.from(enc))
        persisted = true
        return
      } catch { /* 아래: 저장 못 함 */ }
    }
    persisted = false
    await fs.rm(file, { force: true }).catch(() => {})
  }
  async function readOnce() {
    let buf
    try { buf = await fs.readFile(file) } catch { return null }
    const canAsync = await avail()
    let text = null
    let rewrite = false
    let plaintext = false
    if (canAsync) {
      try {
        const r = await safe.decryptStringAsync(buf)
        if (r && typeof r.result === 'string') {
          text = r.result
          rewrite = !!r.shouldReEncrypt
        }
      } catch { /* 옛 동기 방식일 수 있다 */ }
    }
    if (text == null && typeof safe.decryptString === 'function') {
      try {
        if (typeof safe.isEncryptionAvailable !== 'function' || safe.isEncryptionAvailable()) {
          text = safe.decryptString(buf)
          rewrite = true
        }
      } catch { /* 평문일 수 있다 */ }
    }
    if (text == null) {
      text = buf.toString('utf8')
      plaintext = true
    }
    const parsed = parseRecord(text)
    if (!parsed) return null
    if (plaintext) {
      // 옛 평문 파일: 한 번 읽고 암호화해 덮어쓰거나(가능할 때), 지운다.
      await persist(parsed.rec)
    } else if (rewrite || parsed.legacy) {
      if (canAsync) await persist(parsed.rec)
      else persisted = false
    } else persisted = true
    return parsed.rec
  }
  async function load() {
    if (cache !== undefined) return cache
    loading ??= queue(async () => {
      if (cache === undefined) cache = await readOnce()
      return cache
    })
    try { return await loading } finally { loading = null }
  }
  return {
    load,
    persisted: () => persisted,
    async save(rec) {
      const clean = { refresh: rec.refresh, scopes: rec.scopes.slice(), email: rec.email ?? null }
      await queue(async () => {
        cache = clean
        await persist(clean)
      })
    },
    async clear() {
      await queue(async () => {
        cache = null
        persisted = false
        await fs.rm(file, { force: true })
      })
    },
  }
}

// ---- 클라이언트: 토큰 교환·새로 고침·API·업로드·다운로드 ----
function createGoogleClient({ fetchFn, store, readClient, now = () => Date.now(), sleep = sleepDefault }) {
  let access = null // { token, until }

  async function tokenRequest(params) {
    const c = readClient()
    if (!c) throw new Error('구글 연결 파일을 먼저 올리세요.')
    let res
    try {
      res = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, ...params }).toString(),
      })
    } catch {
      throw new Error(MSG_NET)
    }
    const body = parseJson(await readCapped(res, 1024 * 1024)) || {}
    if (!res.ok) {
      if (body.error === 'invalid_grant') throw httpError('구글 로그인이 만료되었습니다. 다시 연결하세요.', 401)
      throw httpError('구글 인증에 실패했습니다.', res.status)
    }
    return body
  }
  /** 토큰이 없거나 취소됐으면 null(→ 401). 네트워크 실패는 던진다. */
  async function accessToken(force = false) {
    if (!force && access && access.until > now() + 60000) return access.token
    const rec = await store.load()
    if (!rec) return null
    try {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: rec.refresh })
      if (typeof t.access_token !== 'string') return null
      access = { token: t.access_token, until: now() + expiresMs(t) }
      return access.token
    } catch (e) {
      if (e && e.status === 401) {
        access = null
        return null
      }
      throw e
    }
  }
  // 401이면 한 번 새로 고쳐 다시
  async function withAuth(fn) {
    let token = await accessToken()
    if (!token) throw httpError(MSG_RECONNECT, 401)
    try {
      return await fn(token)
    } catch (e) {
      if (!e || e.status !== 401) throw e
      access = null
      token = await accessToken(true)
      if (!token) throw httpError(MSG_RECONNECT, 401)
      return fn(token)
    }
  }

  return {
    tokenRequest,
    async status() {
      const rec = await store.load()
      return { client: !!readClient(), connected: !!rec, email: rec ? rec.email : null, scopes: rec ? rec.scopes.slice() : [], sessionOnly: !!rec && !store.persisted() }
    },
    /** 토큰 응답 t를 저장. 받은 scope(공백 구분)와 id_token의 이메일. incremental에서 refresh가 없으면 기존 것. */
    async completeLogin(t, requested, incremental) {
      if (!t || typeof t.access_token !== 'string') throw new Error('구글 인증에 실패했습니다.')
      const prev = await store.load()
      const email = emailFromIdToken(t.id_token)
      let refresh = typeof t.refresh_token === 'string' && t.refresh_token ? t.refresh_token : null
      if (!refresh) {
        if (!incremental || !prev) throw new Error('구글이 로그인 유지 정보를 주지 않았습니다. 다시 시도하세요.')
        if (email && prev.email && email !== prev.email) throw new Error('처음 연결한 것과 같은 계정을 고르세요.')
        refresh = prev.refresh
      }
      const granted = typeof t.scope === 'string' && t.scope.trim() ? t.scope.trim().split(/\s+/) : [...new Set([...(incremental && prev ? prev.scopes : []), ...requested])]
      await store.save({ refresh, scopes: granted, email: email ?? (incremental && prev ? prev.email : null) })
      access = { token: t.access_token, until: now() + expiresMs(t) }
      return true
    },
    async logout() {
      const rec = await store.load().catch(() => null)
      access = null
      await store.clear()
      if (rec) {
        try {
          await fetchFn(REVOKE_URL + '?token=' + encodeURIComponent(rec.refresh), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
        } catch { /* 취소 실패는 무시(지역 토큰은 이미 지움) */ }
      }
      return true
    },
    async loginHint() {
      const rec = await store.load()
      return rec ? rec.email : null
    },
    async api(method, url, body, opts) {
      const o = opts && typeof opts === 'object' ? opts : {}
      if (!METHODS.has(method)) throw new Error(MSG_METHOD)
      const n = normalizeApiUrl(url)
      if (!n.ok) throw new Error(MSG_URL)
      const headers = {}
      let payload
      if (body != null) {
        const bytes = toBytes(body)
        if (bytes) {
          if (bytes.length > MAX_BYTES) throw new Error(MSG_BIG)
          const ct = typeof o.contentType === 'string' && o.contentType.length <= 200 && !/[\r\n]/.test(o.contentType) ? o.contentType : 'application/octet-stream'
          headers['content-type'] = ct
          payload = bytes
        } else {
          payload = JSON.stringify(body)
          if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error(MSG_BIG)
          headers['content-type'] = 'application/json'
        }
      }
      const send = async (token) => {
        try {
          return await fetchFn(n.url, { method, headers: { ...headers, authorization: 'Bearer ' + token }, body: payload })
        } catch {
          throw new Error(MSG_NET)
        }
      }
      let token = await accessToken()
      if (!token) return { status: 401 }
      let res = await send(token)
      if (res.status === 401) {
        try { await res.body?.cancel() } catch { /* 무시 */ }
        access = null
        token = await accessToken(true)
        if (!token) return { status: 401 }
        res = await send(token)
      }
      const out = { status: res.status }
      if (o.wantHeaders) out.headers = pickHeaders(res)
      const bytes = await readCapped(res)
      if (o.binary && res.ok) out.bytes = bytes
      else {
        const j = parseJson(bytes)
        if (j !== undefined) out.json = j
      }
      return out
    },
    uploadResumable: (meta, bytes, fileId) => withAuth((token) => uploadResumable(fetchFn, token, { meta, bytes, fileId }, { sleep })),
    download: (fileId) => {
      if (typeof fileId !== 'string' || !FILE_ID.test(fileId)) return Promise.reject(new Error('파일 이름이 맞지 않습니다.'))
      return withAuth((token) => downloadFile(fetchFn, token, fileId))
    },
  }
}

module.exports = {
  BASE_SCOPES,
  CALENDAR_SCOPES,
  MAX_BYTES,
  normalizeApiUrl,
  validScopes,
  authUrl,
  emailFromIdToken,
  uploadResumable,
  downloadFile,
  readCapped,
  createTokenStore,
  createGoogleClient,
}
