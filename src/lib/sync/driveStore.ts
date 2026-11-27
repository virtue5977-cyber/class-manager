// 구글 드라이브 'Watson' 폴더(스펙 §7.4). 1.0.1 exe가 허용하는 주소만 쓴다.
//   GET/POST /drive/v3/files, GET/PATCH?/DELETE /drive/v3/files/<id>, (이어 올리기·받기는 uploadResumable/download)
import { callJson, googleDownload, googleUpload, type GoogleBridge } from '../google/google'
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

export function createDriveStore(g: GoogleBridge, opts: { pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 100

  async function list(q: string, fields = FIELDS): Promise<Item[]> {
    const out: Item[] = []
    let token: string | undefined
    do {
      const qs = new URLSearchParams({ q, fields: fields.replace('files(', 'nextPageToken,files('), orderBy: 'createdTime', pageSize: String(pageSize) })
      if (token) qs.set('pageToken', token)
      const j = await callJson<{ files?: Item[]; nextPageToken?: string }>(g, 'GET', `/drive/v3/files?${qs}`)
      out.push(...(j?.files ?? []))
      token = j?.nextPageToken
    } while (token)
    return out.sort(byAge)
  }
  const inRoot = (root: string, kind: Kind, extra?: [string, string]) =>
    `${has('watson', kind)}${extra ? ` and ${has(extra[0], extra[1])}` : ''} and '${safe(root, '폴더 id')}' in parents and trashed=false`

  async function findRoot() {
    const r = (await list(`${has('watson', 'root')} and trashed=false`))[0]
    return r ? { id: r.id, createdTime: r.createdTime } : null
  }
  async function createRoot(): Promise<string> {
    const mine = await callJson<{ id: string; createdTime: string }>(g, 'POST', '/drive/v3/files?fields=id,createdTime', { name: 'Watson', mimeType: FOLDER, appProperties: props('root') })
    const oldest = await findRoot()
    if (oldest && oldest.id !== mine.id) {
      await callJson(g, 'DELETE', `/drive/v3/files/${mine.id}`)
      return oldest.id
    }
    return mine.id
  }

  async function findOne(root: string, kind: Kind, extra?: [string, string]) {
    return (await list(inRoot(root, kind, extra)))[0] ?? null
  }
  async function put(root: string, name: string, kind: Kind, extra: Record<string, string>, bytes: Uint8Array, fileId?: string) {
    if (fileId) return googleUpload(g, { name, appProperties: props(kind, extra) }, bytes, fileId) // 고칠 때는 parents를 못 바꾼다
    return googleUpload(g, { name, parents: [root], appProperties: props(kind, extra), mimeType: 'application/octet-stream' }, bytes)
  }

  return {
    findRoot,
    createRoot,
    async readKeyFile(root: string): Promise<KeyFile | null> {
      const it = await findOne(root, 'key')
      if (!it) return null
      return JSON.parse(new TextDecoder().decode(await googleDownload(g, it.id))) as KeyFile
    },
    async writeKeyFile(root: string, kf: KeyFile): Promise<void> {
      const it = await findOne(root, 'key')
      await put(root, 'watson-key.json', 'key', {}, new TextEncoder().encode(JSON.stringify(kf)), it?.id)
    },
    async listDevices(root: string): Promise<DeviceEntry[]> {
      return (await list(inRoot(root, 'device'))).map((i) => ({ deviceId: i.appProperties?.deviceId ?? '', fileId: i.id, modifiedTime: i.modifiedTime })).filter((d) => d.deviceId)
    },
    downloadDevice: (fileId: string) => googleDownload(g, fileId),
    async uploadDevice(root: string, deviceId: string, bytes: Uint8Array, fileId?: string): Promise<string> {
      safe(deviceId, '기기 id')
      const id = fileId ?? (await findOne(root, 'device', ['deviceId', deviceId]))?.id
      return put(root, `${deviceId}.wsync`, 'device', { deviceId }, bytes, id)
    },
    async deleteDevice(fileId: string): Promise<void> {
      await callJson(g, 'DELETE', `/drive/v3/files/${fileId}`)
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
