// 시험용 가짜 드라이브. 1.0.1 exe의 GoogleBridge(api/uploadResumable/download)와 같은 주소 모양만 받는다.
import type { GoogleApiResult, GoogleBridge, GoogleMethod, GoogleUploadResult, GoogleDownloadResult } from '../google/google'

export interface FakeFile {
  id: string
  name?: string
  mimeType?: string
  parents: string[]
  appProperties: Record<string, string>
  createdTime: string
  modifiedTime: string
  trashed: boolean
  bytes?: Uint8Array
}
export interface FakeFail { status: number; reason?: string }
export interface FakeDrive extends GoogleBridge {
  /** 다음 n번(기본 1) 호출을 이 오류로 실패시킨다. */
  failNext(f: FakeFail, n?: number): void
  /** 부른 주소 기록: `METHOD url`(api), `UPLOAD`/`UPDATE <id>`(uploadResumable), `DOWNLOAD <id>` */
  calls: string[]
  files: Map<string, FakeFile>
  /** 저장된 바이트(평문 검사용) */
  bytesOf(id: string): Uint8Array | undefined
  allBytes(): Uint8Array[]
}

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/
const err = (status: number, reason?: string): GoogleApiResult => ({ status, json: { error: { code: status, errors: reason ? [{ reason }] : [] } } })

/** now: 호출마다 ISO 문자열을 돌려주는 시계. 기본은 2026-01-01부터 1초씩. */
export function fakeDrive(opts: { now?: () => string } = {}): FakeDrive {
  let tick = 0
  const now = opts.now ?? (() => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString())
  let seq = 0
  const files = new Map<string, FakeFile>()
  const calls: string[] = []
  const fails: FakeFail[] = []
  const nextId = () => `fakeid${String(++seq).padStart(8, '0')}`
  const takeFail = () => fails.shift()

  const project = (f: FakeFile, fields: string[]) => {
    const all: Record<string, unknown> = { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties, createdTime: f.createdTime, modifiedTime: f.modifiedTime, trashed: f.trashed }
    const out: Record<string, unknown> = {}
    for (const k of fields) if (all[k] !== undefined) out[k] = all[k]
    return out
  }
  const fieldList = (s: string | null, dflt: string) => (s ?? dflt).split(',').map((x) => x.trim()).filter(Boolean)

  function matchQ(f: FakeFile, q: string): boolean {
    if (f.trashed && /trashed\s*=\s*false/.test(q)) return false
    for (const m of q.matchAll(/appProperties has \{ key='([^']*)' and value='((?:[^'\\]|\\.)*)' \}/g)) {
      if (f.appProperties[m[1]] !== m[2].replace(/\\(.)/g, '$1')) return false
    }
    for (const m of q.matchAll(/'([^']+)' in parents/g)) if (!f.parents.includes(m[1])) return false
    return true
  }

  const bridge: FakeDrive = {
    calls,
    files,
    failNext(f, n = 1) { for (let i = 0; i < n; i++) fails.push(f) },
    bytesOf: (id) => files.get(id)?.bytes,
    allBytes: () => [...files.values()].flatMap((f) => (f.bytes ? [f.bytes] : [])),
    async status() { return { connected: true, email: 'fake@example.com', scopes: [] } as never },
    async setClient() { return true },
    async login() { return true },
    async logout() { return true },
    async api(method: GoogleMethod, url: string, body?: unknown): Promise<GoogleApiResult> {
      calls.push(`${method} ${url}`)
      const f = takeFail()
      if (f) return err(f.status, f.reason)
      const u = new URL(url, 'https://www.googleapis.com')
      const m = /^\/drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname)
      if (!m) return err(404, 'notFound')
      const id = m[1]
      if (id !== undefined && !ID_RE.test(id)) return err(404, 'notFound')
      const sp = u.searchParams
      if (id === undefined) {
        if (method === 'GET') {
          const q = sp.get('q') ?? ''
          const size = Math.min(1000, Number(sp.get('pageSize') ?? 100))
          const start = Number(sp.get('pageToken') ?? 0)
          let list = [...files.values()].filter((x) => matchQ(x, q))
          if (sp.get('orderBy') === 'createdTime') list = list.sort((a, b) => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.id < b.id ? -1 : 1))
          const page = list.slice(start, start + size)
          const flds = sp.get('fields') ?? ''
          const inner = /files\(([^)]*)\)/.exec(flds)
          const fl = fieldList(inner ? inner[1] : null, 'id,name')
          const json: Record<string, unknown> = { files: page.map((x) => project(x, fl)) }
          if (start + size < list.length && (!flds || flds.includes('nextPageToken'))) json.nextPageToken = String(start + size)
          return { status: 200, json }
        }
        if (method === 'POST') {
          const b = (body ?? {}) as Partial<FakeFile>
          const t = now()
          const nf: FakeFile = { id: nextId(), name: b.name, mimeType: b.mimeType, parents: b.parents ?? [], appProperties: { ...(b.appProperties ?? {}) }, createdTime: t, modifiedTime: t, trashed: false }
          files.set(nf.id, nf)
          return { status: 200, json: project(nf, fieldList(sp.get('fields'), 'id')) }
        }
        return err(405, 'methodNotAllowed')
      }
      const file = files.get(id)
      if (!file) return err(404, 'notFound')
      if (method === 'GET') {
        if (sp.get('alt') === 'media') return { status: 200, bytes: file.bytes ?? new Uint8Array() }
        return { status: 200, json: project(file, fieldList(sp.get('fields'), 'id,name')) }
      }
      if (method === 'DELETE') { files.delete(id); return { status: 204 } }
      if (method === 'PATCH') {
        const b = (body ?? {}) as Partial<FakeFile>
        if (b.name !== undefined) file.name = b.name
        if (b.appProperties) Object.assign(file.appProperties, b.appProperties)
        file.modifiedTime = now()
        return { status: 200, json: project(file, fieldList(sp.get('fields'), 'id')) }
      }
      return err(405, 'methodNotAllowed')
    },
    async uploadResumable(meta, bytes, fileId): Promise<GoogleUploadResult> {
      calls.push(fileId ? `UPDATE ${fileId}` : 'UPLOAD')
      const f = takeFail()
      if (f) return { ok: false, status: f.status, ...(f.reason ? { reason: f.reason } : {}) }
      const m = meta as Partial<FakeFile>
      const copy = new Uint8Array(bytes)
      const t = now()
      if (fileId) {
        const file = files.get(fileId)
        if (!file) return { ok: false, status: 404, reason: 'notFound' }
        // 실제 드라이브처럼 고칠 때는 parents를 바꿀 수 없다.
        if (m.parents) return { ok: false, status: 403, reason: 'fieldNotWritable' }
        if (m.name !== undefined) file.name = m.name
        if (m.appProperties) Object.assign(file.appProperties, m.appProperties)
        file.bytes = copy
        file.modifiedTime = t
        return { ok: true, id: file.id }
      }
      const nf: FakeFile = { id: nextId(), name: m.name, mimeType: m.mimeType, parents: m.parents ?? [], appProperties: { ...(m.appProperties ?? {}) }, createdTime: t, modifiedTime: t, trashed: false, bytes: copy }
      files.set(nf.id, nf)
      return { ok: true, id: nf.id }
    },
    async download(fileId): Promise<GoogleDownloadResult> {
      calls.push(`DOWNLOAD ${fileId}`)
      const f = takeFail()
      if (f) return { ok: false, status: f.status, ...(f.reason ? { reason: f.reason } : {}) }
      const file = files.get(fileId)
      if (!file) return { ok: false, status: 404, reason: 'notFound' }
      return { ok: true, bytes: new Uint8Array(file.bytes ?? new Uint8Array()) }
    },
  }
  return bridge
}
