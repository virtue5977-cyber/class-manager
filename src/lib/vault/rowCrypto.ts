import { gcm } from '@noble/ciphers/aes.js'
import { asBytes, canonicalJson, parseCanonical } from './canon'

const VERSION = 1
const IV_LEN = 12
const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })

/** 형식 v1: 0x01 ‖ iv(12) ‖ AES-256-GCM(암호문+태그). 동기식. */
function checkKey(key: Uint8Array): void {
  if (key.length !== 32) throw new TypeError('열쇠는 32바이트(AES-256)여야 합니다')
}

export function encryptBytes(key: Uint8Array, plain: Uint8Array, aad: string): Uint8Array {
  checkKey(key)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ct = gcm(key, iv, enc.encode(aad)).encrypt(plain)
  const out = new Uint8Array(1 + IV_LEN + ct.length)
  out[0] = VERSION
  out.set(iv, 1)
  out.set(ct, 1 + IV_LEN)
  return out
}

export function decryptBytes(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  checkKey(key)
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
  if (row.id == null) throw new TypeError('id 없는 행은 암호화할 수 없습니다')
  const out: Record<string, unknown> = {}
  for (const f of plain) if (f in row && row[f] !== undefined) out[f] = row[f]
  const { _enc: _drop, ...whole } = row
  void _drop
  out._enc = encryptBytes(key, enc.encode(canonicalJson(whole)), rowAad(table, row.id))
  return out
}

/**
 * 푼 글 캐시(DB 하나·열쇠 하나, 표+행 id마다): 마지막으로 확인한 암호문과 그 평문 글을 둔다.
 * 저장된 암호문 바이트가 그때와 똑같을 때만 다시 쓴다(같은 열쇠·같은 AAD·같은 바이트 → 같은 확인 결과).
 * 같은 행을 여러 화면·liveQuery가 거듭 읽을 때 AES-GCM을 다시 하지 않는다. 대략의 바이트 합(글 ×2 + 암호문)이 maxBytes를 넘으면 오래된 것부터 버린다.
 * 행 객체는 매번 새로 만든다(parseCanonical)·평문 칸 대조도 매번 한다.
 */
export class OpenTextCache {
  private m = new Map<string, { enc: Uint8Array; text: string }>()
  private bytes = 0
  constructor(private readonly maxBytes = 24 * 1024 * 1024) {}
  get size(): number { return this.m.size }
  get(id: string, enc: Uint8Array): string | undefined {
    const hit = this.m.get(id)
    if (!hit || !sameBytes(hit.enc, enc)) return undefined
    this.m.delete(id)
    this.m.set(id, hit) // 최근 사용
    return hit.text
  }
  set(id: string, enc: Uint8Array, text: string): void {
    const cost = text.length * 2 + enc.length
    if (cost > this.maxBytes / 8) return // 아주 큰 행은 두지 않는다
    this.drop(id)
    this.m.set(id, { enc: enc.slice(), text })
    this.bytes += cost
    while (this.bytes > this.maxBytes) {
      const oldest = this.m.keys().next().value as string
      this.drop(oldest)
    }
  }
  private drop(id: string): void {
    const cur = this.m.get(id)
    if (!cur) return
    this.bytes -= cur.text.length * 2 + cur.enc.length
    this.m.delete(id)
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function openRow(
  table: string,
  stored: Record<string, unknown>,
  key: Uint8Array,
  plain: ReadonlySet<string>,
  cache?: OpenTextCache,
): Record<string, unknown> | { id: unknown; _broken: true } {
  const broken = { id: stored.id, _broken: true as const }
  try {
    const e = asBytes(stored._enc)
    if (!e) return broken
    const cid = cache ? `${table}\u0001${typeof stored.id === 'string' ? 's' + stored.id : JSON.stringify(stored.id)}` : ''
    let text = cache?.get(cid, e)
    if (text === undefined) {
      text = dec.decode(decryptBytes(key, e, rowAad(table, stored.id)))
      cache?.set(cid, e, text)
    }
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
