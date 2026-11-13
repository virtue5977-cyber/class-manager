import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const enc = new TextEncoder()

export function bytesToB64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function label(v: unknown): string {
  if (typeof v === 'function') return '함수'
  if (v === null || typeof v !== 'object') return typeof v
  return Object.prototype.toString.call(v).slice(8, -1)
}

function isPlainObject(v: object): boolean {
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

function ser(v: unknown): string {
  if (v === null) return 'null'
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v)
    case 'boolean':
      return v ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError(`저장할 수 없는 값: ${v}`)
      return JSON.stringify(v)
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : ser(x))).join(',') + ']'
      if (v instanceof Uint8Array) return '{"$u8":"' + bytesToB64(v) + '"}'
      if (!isPlainObject(v)) throw new TypeError(`저장할 수 없는 값: ${label(v)}`)
      const o = v as Record<string, unknown>
      const parts: string[] = []
      for (const k of Object.keys(o).sort()) {
        if (o[k] === undefined) continue
        parts.push(JSON.stringify(k) + ':' + ser(o[k]))
      }
      return '{' + parts.join(',') + '}'
    }
    default:
      throw new TypeError(`저장할 수 없는 값: ${label(v)}`)
  }
}

/** 정규 JSON: 키 사전순, Uint8Array → {"$u8":b64}, undefined 칸 생략. */
export function canonicalJson(v: unknown): string {
  return ser(v)
}

export function parseCanonical(s: string): unknown {
  return JSON.parse(s, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const keys = Object.keys(val)
      if (keys.length === 1 && keys[0] === '$u8' && typeof val.$u8 === 'string') return b64ToBytes(val.$u8)
    }
    return val
  })
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(enc.encode(s)))
}
