// 구글 드라이브 'Watson' 폴더(스펙 §7.4). 1.0.1 exe가 허용하는 주소만 쓴다.
//   GET/POST /drive/v3/files, GET/PATCH?/DELETE /drive/v3/files/<id>, (이어 올리기·받기는 uploadResumable/download)
import { callJson, GoogleApiError, googleDownload, googleUpload, type GoogleBridge } from '../google/google'
import type { Wrapped } from '../vault/keys'

export interface KeyFile extends Wrapped { v: 1; keyId: string; check: string; updatedAt: string }
export interface DeviceEntry { deviceId: string; fileId: string; modifiedTime: string }
type Kind = 'root' | 'key' | 'device' | 'file'
interface Item { id: string; name?: string; createdTime: string; modifiedTime: string; appProperties?: Record<string, string> }

const FOLDER = 'application/vnd.google-apps.folder'
const FIELDS = 'files(id,name,createdTime,modifiedTime,appProperties)'
const SAFE = /^[A-Za-z0-9_.:-]{1,200}$/
const safe = (v: string, what: string) => { if (!SAFE.test(v)) throw new Error(`${what} 형식이 올바르지 않습니다.`); return v }
const props = (k: Kind, extra: Record<string, string> = {}) => ({ watson: k, ...extra })
const has = (k: string, v: string) => `appProperties has { key='${k}' and value='${v}' }`
const byAge = (a: Item, b: Item) => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.id < b.id ? -1 : 1)

const MAX_PAGES = 100
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve())

/** 열쇠 파일 모양 검사. 아는 칸만 새 객체에 복사한다. */
function parseKeyFile(text: string): KeyFile {
  let j: unknown
  try { j = JSON.parse(text) } catch { throw new Error('BAD_KEY_FILE') }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('BAD_KEY_FILE')
  const o = j as Record<string, unknown>
  const str = (k: string) => { const v = Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; if (typeof v !== 'string') throw new Error('BAD_KEY_FILE'); return v }
  const iter = Object.prototype.hasOwnProperty.call(o, 'iter') ? o.iter : undefined
  if (o.v !== 1 || typeof iter !== 'number' || !Number.isInteger(iter) || iter < 100_000 || iter > 10_000_000) throw new Error('BAD_KEY_FILE')
  return { v: 1, keyId: str('keyId'), salt: str('salt'), iter, iv: str('iv'), ct: str('ct'), check: str('check'), updatedAt: str('updatedAt') }
}
const ignore404 = async (p: Promise<unknown>) => { try { await p } catch (e) { if (!(e instanceof GoogleApiError && e.status === 404)) throw e } }

export function createDriveStore(g: GoogleBridge, opts: { pageSize?: number; recheckDelayMs?: number } = {}) {
  const pageSize = opts.pageSize ?? 100
  const recheckDelayMs = opts.recheckDelayMs ?? 3000

  async function list(q: string, fields = FIELDS): Promise<Item[]> {
    const out: Item[] = []
    let token: string | undefined
    const seen = new Set<string>()
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error('PAGING_LOOP')
      const qs = new URLSearchParams({ q, fields: fields.replace('files(', 'nextPageToken,files('), orderBy: 'createdTime', pageSize: String(pageSize) })
      if (token) qs.set('pageToken', token)
      const j = await callJson<{ files?: Item[]; nextPageToken?: string }>(g, 'GET', `/drive/v3/files?${qs}`)
      out.push(...(j?.files ?? []))
      token = j?.nextPageToken
      if (!token) break
      if (seen.has(token)) throw new Error('PAGING_LOOP')
      seen.add(token)
    }
    return out.sort(byAge)
  }
  const inRoot = (root: string, kind: Kind, extra?: [string, string]) =>
    `${has('watson', kind)}${extra ? ` and ${has(extra[0], extra[1])}` : ''} and '${safe(root, '폴더 id')}' in parents and trashed=false`

  async function findRoot() {
    const r = (await list(`${has('watson', 'root')} and trashed=false`))[0]
    return r ? { id: r.id, createdTime: r.createdTime } : null
  }
  async function deleteRoot(id: string): Promise<void> {
    await ignore404(callJson(g, 'DELETE', `/drive/v3/files/${id}`))
  }
  /** 만든 뒤 바로, 잠깐 있다가 한 번 더 목록을 본다. 더 오래된 루트가 있으면 내 것을 지우고 그것을 쓴다. */
  async function createRoot(): Promise<{ id: string; created: boolean }> {
    const mine = await callJson<{ id: string; createdTime: string }>(g, 'POST', '/drive/v3/files?fields=id,createdTime', { name: 'Watson', mimeType: FOLDER, appProperties: props('root') })
    for (let i = 0; i < 2; i++) {
      if (i === 1) await sleep(recheckDelayMs)
      const oldest = await findRoot()
      if (oldest && oldest.id !== mine.id) {
        await deleteRoot(mine.id)
        return { id: oldest.id, created: false }
      }
    }
    return { id: mine.id, created: true }
  }
  /** 매 동기화 처음에 부른다. 가장 오래된 루트로 옮겨 가야 하면 switched. losers는 그 밖의 루트(부르는 쪽이 지운다). */
  async function resolveRoot(myRootId: string): Promise<{ rootId: string; switched: boolean; losers: string[] }> {
    const roots = await list(`${has('watson', 'root')} and trashed=false`, 'files(id,createdTime)')
    if (!roots.length) return { rootId: myRootId, switched: false, losers: [] }
    const oldest = roots[0].id
    return { rootId: oldest, switched: oldest !== myRootId, losers: roots.slice(1).map((r) => r.id) }
  }

  async function findOne(root: string, kind: Kind, extra?: [string, string]) {
    return (await list(inRoot(root, kind, extra)))[0] ?? null
  }
  async function put(root: string, name: string, kind: Kind, extra: Record<string, string>, bytes: Uint8Array, fileId?: string) {
    if (fileId) return googleUpload(g, { name, appProperties: props(kind, extra) }, bytes, fileId) // 고칠 때는 parents를 못 바꾼다
    return googleUpload(g, { name, parents: [root], appProperties: props(kind, extra), mimeType: 'application/octet-stream' }, bytes)
  }

  async function readKeyFile(root: string): Promise<KeyFile | null> {
    const it = await findOne(root, 'key')
    if (!it) return null
    return parseKeyFile(new TextDecoder().decode(await googleDownload(g, it.id)))
  }

  return {
    findRoot,
    createRoot,
    resolveRoot,
    deleteRoot,
    readKeyFile,
    /** 열쇠 파일이 이미 있고 keyId가 expectKeyId와 다르면 KEY_EXISTS(force가 아닌 한). */
    async writeKeyFile(root: string, kf: KeyFile, o: { expectKeyId?: string | null; force?: boolean } = {}): Promise<void> {
      const it = await findOne(root, 'key')
      if (it && !o.force) {
        let cur: string | null = null
        try { cur = (await readKeyFile(root))?.keyId ?? null } catch { cur = null }
        if (cur === null || cur !== (o.expectKeyId ?? null)) throw new Error('KEY_EXISTS')
      }
      await put(root, 'watson-key.json', 'key', {}, new TextEncoder().encode(JSON.stringify(kf)), it?.id)
    },
    async listDevices(root: string): Promise<DeviceEntry[]> {
      return (await list(inRoot(root, 'device'))).map((i) => ({ deviceId: i.appProperties?.deviceId ?? '', fileId: i.id, modifiedTime: i.modifiedTime })).filter((d) => d.deviceId)
    },
    downloadDevice: (fileId: string) => googleDownload(g, fileId),
    /** 파일 하나의 드라이브 modifiedTime(서버 시각). files.get이라 목록 지연과 무관하다. */
    async fileModifiedTime(fileId: string): Promise<string | null> {
      const j = await callJson<{ modifiedTime?: string }>(g, 'GET', `/drive/v3/files/${safe(fileId, '파일 id')}?fields=modifiedTime`)
      return typeof j?.modifiedTime === 'string' ? j.modifiedTime : null
    },
    async uploadDevice(root: string, deviceId: string, bytes: Uint8Array, fileId?: string): Promise<string> {
      safe(deviceId, '기기 id')
      const id = fileId ?? (await findOne(root, 'device', ['deviceId', deviceId]))?.id
      return put(root, `${deviceId}.wsync`, 'device', { deviceId }, bytes, id)
    },
    async deleteDevice(fileId: string): Promise<void> {
      await ignore404(callJson(g, 'DELETE', `/drive/v3/files/${fileId}`))
    },
    async listFileIds(root: string): Promise<Set<string>> {
      const out = new Set<string>()
      for (const i of await list(inRoot(root, 'file'))) if (i.appProperties?.blobId) out.add(i.appProperties.blobId)
      return out
    },
    async hasFile(root: string, blobId: string): Promise<boolean> {
      return !!(await findOne(root, 'file', ['blobId', safe(blobId, '첨부 id')]))
    },
    async uploadFile(root: string, blobId: string, bytes: Uint8Array): Promise<string> {
      safe(blobId, '첨부 id')
      const ex = await findOne(root, 'file', ['blobId', blobId])
      if (ex) return ex.id
      return put(root, `${blobId}.wfile`, 'file', { blobId }, bytes)
    },
    async downloadFile(root: string, blobId: string): Promise<Uint8Array> {
      const it = await findOne(root, 'file', ['blobId', safe(blobId, '첨부 id')])
      if (!it) throw new Error('드라이브에 첨부가 없습니다.')
      return googleDownload(g, it.id)
    },
  }
}
export type DriveStore = ReturnType<typeof createDriveStore>
