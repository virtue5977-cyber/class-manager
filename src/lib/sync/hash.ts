import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { canonicalJson } from '../vault/canon'

const enc = new TextEncoder()

/** syncKey = HKDF-SHA256(DEK, salt 없음, info 'watson-sync-hash:v1', 32바이트) */
export function syncKeyFrom(dek: Uint8Array): Uint8Array {
  return hkdf(sha256, dek, undefined, enc.encode('watson-sync-hash:v1'), 32)
}

/** 행 해시 = HMAC-SHA256(syncKey, 정규 JSON(행)) hex. 맨 SHA-256은 짧은 행을 추측으로 되찾을 수 있어 쓰지 않는다. */
export function rowHash(key: Uint8Array, row: unknown): string {
  return bytesToHex(hmac(sha256, key, enc.encode(canonicalJson(row))))
}
