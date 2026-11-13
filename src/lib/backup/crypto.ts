import { BackupDecryptError } from './errors'

export const PBKDF2_ITERATIONS = 600_000
const KEY_CHECK_TEXT = 'class-manager-key-check'
const CHECK_AAD = new TextEncoder().encode('watson-check:v1')
const LEGACY_CHECK_AAD = new Uint8Array(0)

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encrypt(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext)
  return { iv, ciphertext: new Uint8Array(ct) }
}

export async function decrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext)
    return new Uint8Array(pt)
  } catch {
    throw new BackupDecryptError()
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function makeKeyCheck(key: CryptoKey): Promise<string> {
  const { iv, ciphertext } = await encrypt(key, new TextEncoder().encode(KEY_CHECK_TEXT), CHECK_AAD)
  const joined = new Uint8Array(iv.length + ciphertext.length)
  joined.set(iv)
  joined.set(ciphertext, iv.length)
  return toBase64(joined)
}

export async function verifyKeyCheck(key: CryptoKey, check: string): Promise<boolean> {
  try {
    const bytes = fromBase64(check)
    for (const aad of [CHECK_AAD, LEGACY_CHECK_AAD]) {
      try {
        const pt = await decrypt(key, bytes.slice(0, 12), bytes.slice(12), aad)
        if (new TextDecoder().decode(pt) === KEY_CHECK_TEXT) return true
      } catch { /* 다음 aad */ }
    }
    return false
  } catch {
    return false
  }
}

export { toBase64, fromBase64 }
