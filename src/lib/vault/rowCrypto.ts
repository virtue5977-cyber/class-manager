import { gcm } from '@noble/ciphers/aes.js'
import { canonicalJson, parseCanonical } from './canon'

const VERSION = 1
const IV_LEN = 12
const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })

/** 형식 v1: 0x01 ‖ iv(12) ‖ AES-256-GCM(암호문+태그). 동기식. */
export function encryptBytes(key: Uint8Array, plain: Uint8Array, aad: string): Uint8Array {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ct = gcm(key, iv, enc.encode(aad)).encrypt(plain)
  const out = new Uint8Array(1 + IV_LEN + ct.length)
  out[0] = VERSION
  out.set(iv, 1)
  out.set(ct, 1 + IV_LEN)
  return out
}

export function decryptBytes(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  if (sealed.length < 1 + IV_LEN + 16) throw new Error('암호문이 너무 짧습니다')
  if (sealed[0] !== VERSION) throw new Error(`지원하지 않는 암호문 판: ${sealed[0]}`)
  const iv = sealed.subarray(1, 1 + IV_LEN)
  return gcm(key, iv, enc.encode(aad)).decrypt(sealed.subarray(1 + IV_LEN))
}

function rowAad(table: string, id: unknown): string {
  return `watson-row:v1:${table}:${String(id)}`
}

export function sealRow(
  table: string,
  row: Record<string, unknown>,
  key: Uint8Array,
  plain: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of plain) if (f in row && row[f] !== undefined) out[f] = row[f]
  const { _enc: _drop, ...whole } = row
  void _drop
  out._enc = encryptBytes(key, enc.encode(canonicalJson(whole)), rowAad(table, row.id))
  return out
}

export function openRow(
  table: string,
  stored: Record<string, unknown>,
  key: Uint8Array,
  plain: ReadonlySet<string>,
): Record<string, unknown> | { id: unknown; _broken: true } {
  const broken = { id: stored.id, _broken: true as const }
  try {
    const e = stored._enc
    if (!(e instanceof Uint8Array)) return broken
    const text = dec.decode(decryptBytes(key, e, rowAad(table, stored.id)))
    const row = parseCanonical(text) as Record<string, unknown>
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return broken
    for (const f of plain) {
      if (f in stored && stored[f] !== undefined) {
        if (canonicalJson(stored[f]) !== canonicalJson(row[f])) return broken
      } else if (row[f] !== undefined) return broken
    }
    return row
  } catch {
    return broken
  }
}
