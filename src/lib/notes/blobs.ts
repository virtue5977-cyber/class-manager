import type { AppDB } from '../db/schema'
import type { NoteBlobRec, NoteFileRec } from '../db/types'
import { blobCrypto } from '../vault/blobCrypto'

/** 이 크기 이하는 행 하나, 넘으면 CHUNK씩 나눈다. */
export const BLOB_SINGLE_MAX = 8 * 1024 * 1024
export const BLOB_CHUNK = 1024 * 1024
export const CORRUPT = '첨부가 손상되었습니다'

const yieldTick = () => new Promise<void>((r) => setTimeout(r))

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

/** 암호화 DB의 첨부 바이트를 푼다. 없거나 깨졌으면 '첨부가 손상되었습니다'. */
export async function openBlobBytes(db: AppDB, f: Pick<NoteFileRec, 'id' | 'chunks' | 'size'>): Promise<Uint8Array> {
  const c = blobCrypto(db)
  if (!c) throw new Error('암호화 DB가 아닙니다.')
  try {
    const ids = blobIds(f)
    const rows = await db.note_blobs.bulkGet(ids)
    const parts = rows.map((r, i) => {
      if (!r) throw new Error('missing')
      return c.open(ids[i], r._enc)
    })
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
export function b64ToBytes(b: string): Uint8Array {
  const s = atob(b)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
