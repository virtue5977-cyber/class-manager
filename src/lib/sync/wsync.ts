import { encryptBytes, decryptBytes } from '../vault/rowCrypto'
import { canonicalJson, parseCanonical } from '../vault/canon'
import { SYNC_TABLES } from './tables'
import type { SyncRow } from './merge'

/** spec §7.4: .wsync = 0x01‖iv‖GCM(gzip(정규 JSON)), aad 'watson-sync:v1:'+deviceId. .wfile aad 'watson-file:v1:'+blobId. */
export interface Snapshot {
  fmt: 1
  app: string
  deviceId: string
  deviceName: string
  at: string
  keyId: string
  /** 아는 표 전체 행의 updated_at 최댓값(없으면 ''). */
  maxUpdated: string
  /** 이 판이 아는 표(SYNC_TABLES)만. */
  tables: Record<string, SyncRow[]>
  /** 이 판이 모르는 표. 열 때 tables에서 옮겨 담고, 낼 때 tables 최상위 키로 되돌려 쓴다. */
  extra: Record<string, unknown>
}

const KNOWN = new Set<string>(SYNC_TABLES)

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const written = w.write(bytes as BufferSource).then(() => w.close())
  written.catch(() => {}) // 읽기 쪽 오류가 따로 던져지므로 쓰기 쪽 거부는 처리됨으로 표시
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
    await written
  } catch (e) {
    await reader.cancel().catch(() => {})
    throw e
  } finally {
    reader.releaseLock()
    w.releaseLock()
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
export const gzip = (b: Uint8Array) => pipe(b, new CompressionStream('gzip'))
export const gunzip = (b: Uint8Array) => pipe(b, new DecompressionStream('gzip'))

export async function buildWsync(p: {
  dek: Uint8Array
  app: string
  deviceId: string
  deviceName: string
  keyId: string
  at: string
  tables: Record<string, SyncRow[]>
  extra: Record<string, unknown>
}): Promise<Uint8Array> {
  let maxUpdated = ''
  for (const k of Object.keys(p.tables)) {
    if (!KNOWN.has(k)) throw new TypeError('알 수 없는 표는 extra로 넘기세요')
    for (const r of p.tables[k]) if (r.updated_at > maxUpdated) maxUpdated = r.updated_at
  }
  for (const k of Object.keys(p.extra)) if (KNOWN.has(k)) throw new TypeError('extra에 아는 표가 있습니다')
  const merged = Object.create(null) as Record<string, unknown>
  for (const k of Object.keys(p.extra)) merged[k] = p.extra[k]
  for (const k of Object.keys(p.tables)) merged[k] = p.tables[k]
  const doc = { fmt: 1, app: p.app, deviceId: p.deviceId, deviceName: p.deviceName, at: p.at, keyId: p.keyId, maxUpdated, tables: merged }
  const zipped = await gzip(new TextEncoder().encode(canonicalJson(doc)))
  return encryptBytes(p.dek, zipped, 'watson-sync:v1:' + p.deviceId)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export async function openWsync(bytes: Uint8Array, dek: Uint8Array, deviceId: string, expectedKeyId?: string): Promise<Snapshot> {
  let doc: unknown
  try {
    const plain = await gunzip(decryptBytes(dek, bytes, 'watson-sync:v1:' + deviceId))
    doc = parseCanonical(new TextDecoder('utf-8', { fatal: true }).decode(plain))
  } catch {
    throw new Error('BAD_SNAPSHOT')
  }
  if (!isObj(doc) || typeof doc.fmt !== 'number') throw new Error('BAD_SNAPSHOT')
  if (!Number.isInteger(doc.fmt) || doc.fmt < 1) throw new Error('BAD_SNAPSHOT')
  if (doc.fmt > 1) throw new Error('NEWER_FORMAT')
  const strs = ['app', 'deviceId', 'deviceName', 'at', 'keyId', 'maxUpdated'] as const
  if (doc.fmt !== 1 || strs.some((k) => typeof doc[k] !== 'string') || !isObj(doc.tables) || doc.deviceId !== deviceId || doc.keyId === '') throw new Error('BAD_SNAPSHOT')
  const tables = Object.create(null) as Record<string, SyncRow[]>
  const extra = Object.create(null) as Record<string, unknown>
  for (const [k, v] of Object.entries(doc.tables)) {
    if (!KNOWN.has(k)) { extra[k] = v; continue }
    if (!Array.isArray(v) || v.some((r) => !isObj(r) || typeof r.id !== 'string' || typeof r.updated_at !== 'string')) throw new Error('BAD_SNAPSHOT')
    tables[k] = v as SyncRow[]
  }
  if (expectedKeyId !== undefined && doc.keyId !== expectedKeyId) throw new Error('KEY_MISMATCH')
  return {
    fmt: 1, app: doc.app as string, deviceId: doc.deviceId as string, deviceName: doc.deviceName as string,
    at: doc.at as string, keyId: doc.keyId as string, maxUpdated: doc.maxUpdated as string, tables, extra,
  }
}

export function sealFile(dek: Uint8Array, blobId: string, bytes: Uint8Array): Uint8Array {
  try { return encryptBytes(dek, bytes, 'watson-file:v1:' + blobId) } catch { throw new Error('BAD_FILE') }
}
export function openFile(dek: Uint8Array, blobId: string, sealed: Uint8Array): Uint8Array {
  try { return decryptBytes(dek, sealed, 'watson-file:v1:' + blobId) } catch { throw new Error('BAD_FILE') }
}
