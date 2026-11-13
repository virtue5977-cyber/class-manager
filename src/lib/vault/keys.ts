import { decryptBytes, encryptBytes } from './rowCrypto'
import { fromBase64, toBase64 } from '../backup/crypto'

/**
 * 열쇠 관리(순수 암호). DEK는 무작위 32바이트, keyId는 소문자 uuid.
 * 감싸기 형식: rowCrypto의 봉인형 0x01 ‖ iv(12) ‖ 암호문+태그를 iv와 ct로 나눠 저장한다
 * (iv = 봉인 1..13바이트, ct = 나머지, 0x01은 판 표시라 저장하지 않고 풀 때 다시 붙인다).
 * aad = `watson-dek:v1:<pass|recovery>:<keyId>`.
 */
export const PASS_ITER = 600_000
export const RECOVERY_ITER = 100_000
export type WrapKind = 'pass' | 'recovery'
export interface Wrapped { salt: string; iter: number; iv: string; ct: string }
export interface VaultPayload {
  v: 1
  keyId: string
  dbName: string
  pass: Wrapped & { updatedAt: string }
  recovery?: Wrapped
  dekB64: string
}

const RECOVERY_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_LEN = 25
const MSG_BAD_CODE = '복구 코드 형식이 맞지 않습니다. 25자(영문 대문자·숫자)를 확인해 주세요.'

export function newDek(): { dek: Uint8Array; keyId: string } {
  return { dek: crypto.getRandomValues(new Uint8Array(32)), keyId: crypto.randomUUID().toLowerCase() }
}

export function dbNameFor(keyId: string): string {
  return 'watson-' + keyId.slice(0, 8)
}

async function pbkdf2(secret: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256)
  return new Uint8Array(bits)
}

export function passKeyRaw(passphrase: string, salt: Uint8Array, iter = PASS_ITER): Promise<Uint8Array> {
  return pbkdf2(passphrase, salt, iter)
}

export function recoveryKeyRaw(code: string, salt: Uint8Array, iter = RECOVERY_ITER): Promise<Uint8Array> {
  return pbkdf2(normalizeRecoveryCode(code).replace(/-/g, ''), salt, iter)
}

const aadFor = (kind: WrapKind, keyId: string) => `watson-dek:v1:${kind}:${keyId}`

export function wrapDek(dek: Uint8Array, keyRaw: Uint8Array, keyId: string, kind: WrapKind, salt: Uint8Array = new Uint8Array(16), iter = kind === 'pass' ? PASS_ITER : RECOVERY_ITER): Wrapped {
  const sealed = encryptBytes(keyRaw, dek, aadFor(kind, keyId))
  return { salt: toBase64(salt), iter, iv: toBase64(sealed.slice(1, 13)), ct: toBase64(sealed.slice(13)) }
}

export function unwrapDek(w: Wrapped, keyRaw: Uint8Array, keyId: string, kind: WrapKind): Uint8Array {
  try {
    const iv = fromBase64(w.iv)
    const ct = fromBase64(w.ct)
    const sealed = new Uint8Array(1 + iv.length + ct.length)
    sealed[0] = 1
    sealed.set(iv, 1)
    sealed.set(ct, 1 + iv.length)
    const dek = decryptBytes(keyRaw, sealed, aadFor(kind, keyId))
    if (dek.length !== 32) throw new Error('bad length')
    return dek
  } catch {
    throw new Error('열쇠가 맞지 않습니다')
  }
}

/** 편향 없는 무작위 문자(거부 샘플링). 32개 문자라 256 % 32 == 0이지만 문자 집합이 바뀌어도 안전하도록 한계값을 둔다. */
export function newRecoveryCode(): string {
  const n = RECOVERY_CHARS.length
  const limit = 256 - (256 % n)
  let out = ''
  while (out.length < CODE_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < CODE_LEN) out += RECOVERY_CHARS[b % n]
    }
  }
  return out.match(/.{5}/g)!.join('-')
}

export function normalizeRecoveryCode(input: string): string {
  const s = input.toUpperCase().replace(/[\s-]/g, '')
  if (s.length !== CODE_LEN || [...s].some((c) => !RECOVERY_CHARS.includes(c))) throw new Error(MSG_BAD_CODE)
  return s.match(/.{5}/g)!.join('-')
}

/** vault:store에 넘길 객체(dpapi 제외). */
export function buildVaultPayload(a: {
  keyId: string
  dek: Uint8Array
  passRaw: Uint8Array
  passSalt: Uint8Array
  passIter?: number
  recoveryRaw?: Uint8Array
  recoverySalt?: Uint8Array
  recoveryIter?: number
}): VaultPayload {
  const pass = { ...wrapDek(a.dek, a.passRaw, a.keyId, 'pass', a.passSalt, a.passIter ?? PASS_ITER), updatedAt: new Date().toISOString() }
  const p: VaultPayload = { v: 1, keyId: a.keyId, dbName: dbNameFor(a.keyId), pass, dekB64: toBase64(a.dek) }
  if (a.recoveryRaw && a.recoverySalt) {
    p.recovery = wrapDek(a.dek, a.recoveryRaw, a.keyId, 'recovery', a.recoverySalt, a.recoveryIter ?? RECOVERY_ITER)
  }
  return p
}
