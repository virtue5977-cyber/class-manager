import type { AppDB } from '../db/schema'
import type { NoteBlobRec, NoteFileRec } from '../db/types'
import { blobCrypto } from '../vault/blobCrypto'

/** 이 크기 이하는 행 하나, 넘으면 CHUNK씩 나눈다. */
export const BLOB_SINGLE_MAX = 8 * 1024 * 1024
export const BLOB_CHUNK = 1024 * 1024
export const CORRUPT = '첨부가 손상되었습니다'

const yieldTick = () => new Promise<void>((r) => setTimeout(r))
/** base64를 한 번에 바꾸는 바이트 수(3의 배수, 768KB) */
const B64_PIECE = 3 * 256 * 1024
const B64_ONLY = /^[A-Za-z0-9+/]*={0,2}$/

/** 바이트를 암호화한 note_blobs 행으로 만든다(묶음 밖에서 부른다. 조각 사이에 양보). */
export async function sealBlobRows(db: AppDB, fileId: string, bytes: Uint8Array): Promise<{ rows: NoteBlobRec[]; chunks?: number }> {
  const c = blobCrypto(db)
  if (!c) throw new Error('암호화 DB가 아닙니다.')
  if (bytes.length <= BLOB_SINGLE_MAX) return { rows: [{ id: fileId, _enc: c.seal(fileId, bytes) }] }
  const rows: NoteBlobRec[] = []
  const n = Math.ceil(bytes.length / BLOB_CHUNK)
  for (let i = 0; i < n; i++) {
    const id = `${fileId}#${i}`
    rows.push({ id, _enc: c.seal(id, bytes.subarray(i * BLOB_CHUNK, (i + 1) * BLOB_CHUNK)) })
    await yieldTick()
  }
  return { rows, chunks: n }
}

export const blobIds = (f: Pick<NoteFileRec, 'id' | 'chunks'>): string[] =>
  f.chunks ? Array.from({ length: f.chunks }, (_, i) => `${f.id}#${i}`) : [f.id]

/** 암호화 DB의 첨부 바이트를 푼다. 없거나 깨졌으면 '첨부가 손상되었습니다'.
 *  yieldBetween: 조각 사이에 양보한다(큰 파일이 화면을 멈추지 않게). Dexie 묶음 안에서는 쓰지 않는다(묶음이 끝난다). */
export async function openBlobBytes(db: AppDB, f: Pick<NoteFileRec, 'id' | 'chunks' | 'size'>, opts: { yieldBetween?: boolean } = {}): Promise<Uint8Array> {
  let rows: (NoteBlobRec | undefined)[]
  try {
    rows = await db.note_blobs.bulkGet(blobIds(f))
  } catch {
    throw new Error(CORRUPT)
  }
  return openBlobRows(db, f, rows, opts)
}

/** 미리 읽어 둔 note_blobs 행(blobIds 순서)을 푼다. 묶음 안에서 행만 읽고 풀기는 묶음 밖에서 하려고 나눈다. */
export async function openBlobRows(
  db: AppDB, f: Pick<NoteFileRec, 'id' | 'chunks' | 'size'>, rows: (NoteBlobRec | undefined)[], opts: { yieldBetween?: boolean } = {},
): Promise<Uint8Array> {
  const c = blobCrypto(db)
  if (!c) throw new Error('암호화 DB가 아닙니다.')
  try {
    const ids = blobIds(f)
    if (rows.length !== ids.length) throw new Error('missing')
    const parts: Uint8Array[] = []
    for (let i = 0; i < ids.length; i++) {
      const r = rows[i]
      if (!r) throw new Error('missing')
      if (opts.yieldBetween && i > 0) await yieldTick()
      parts.push(c.open(ids[i], r._enc))
    }
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
    let o = 0
    for (const p of parts) { out.set(p, o); o += p.length }
    if (typeof f.size === 'number' && out.length !== f.size) throw new Error('size')
    return out
  } catch {
    throw new Error(CORRUPT)
  }
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
  return btoa(s)
}
/** 3바이트 배수로 나눠 base64로 바꾸고 조각 사이에 양보한다(결과는 bytesToB64와 같다). */
export async function bytesToB64Yielding(bytes: Uint8Array, piece = B64_PIECE): Promise<string> {
  if (bytes.length <= piece) return bytesToB64(bytes)
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += piece) {
    if (i > 0) await yieldTick()
    out.push(bytesToB64(bytes.subarray(i, i + piece)))
  }
  return out.join('')
}
/** 4글자 배수로 나눠 풀고 조각 사이에 양보한다(결과는 b64ToBytes와 같다). 표준 base64가 아니면(공백 등) 한 번에 푼다. */
export async function b64ToBytesYielding(b: string, piece = B64_PIECE): Promise<Uint8Array> {
  const chars = (piece / 3) * 4
  if (b.length <= chars || b.length % 4 !== 0) return b64ToBytes(b)
  const parts: Uint8Array[] = []
  for (let i = 0; i < b.length; i += chars) {
    if (i > 0) await yieldTick()
    const s = b.slice(i, i + chars)
    if (!B64_ONLY.test(s) || (i + chars < b.length && s.includes('='))) return b64ToBytes(b)
    parts.push(b64ToBytes(s))
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export function b64ToBytes(b: string): Uint8Array {
  const s = atob(b)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
