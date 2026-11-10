import { BackupFormatError } from './errors'

// 바이트 배치: 'CMBK'(4) | formatVersion u8(1) | iterations u32 BE(4) | salt(16) | iv(12) | ciphertext
const MAGIC = [0x43, 0x4d, 0x42, 0x4b] // 'CMBK'
const SALT_LENGTH = 16
const IV_LENGTH = 12
const GCM_TAG_LENGTH = 16
export const HEADER_LENGTH = 4 + 1 + 4 + SALT_LENGTH // 25
const MIN_LENGTH = HEADER_LENGTH + IV_LENGTH + GCM_TAG_LENGTH // 53

export interface BackupHeader {
  formatVersion: 1
  iterations: number
  salt: Uint8Array
}

export function encodeHeader(h: BackupHeader): Uint8Array {
  const out = new Uint8Array(HEADER_LENGTH)
  out.set(MAGIC, 0)
  out[4] = h.formatVersion
  new DataView(out.buffer).setUint32(5, h.iterations, false)
  out.set(h.salt.subarray(0, SALT_LENGTH), 9)
  return out
}

export function encodeBackupFile(h: BackupHeader, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_LENGTH + IV_LENGTH + ciphertext.length)
  out.set(encodeHeader(h), 0)
  out.set(iv.subarray(0, IV_LENGTH), HEADER_LENGTH)
  out.set(ciphertext, HEADER_LENGTH + IV_LENGTH)
  return out
}

export function decodeBackupFile(bytes: Uint8Array): {
  header: BackupHeader
  headerBytes: Uint8Array
  iv: Uint8Array
  ciphertext: Uint8Array
} {
  if (bytes.length < MIN_LENGTH) throw new BackupFormatError()
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw new BackupFormatError()
  if (bytes[4] !== 1) throw new BackupFormatError()
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5, false)
  // 남이 만든 파일의 큰 값으로 키 만들기가 끝없이 걸리지 않게
  if (iterations < 1 || iterations > 10_000_000) throw new BackupFormatError()
  return {
    header: { formatVersion: 1, iterations, salt: bytes.slice(9, HEADER_LENGTH) },
    headerBytes: bytes.slice(0, HEADER_LENGTH),
    iv: bytes.slice(HEADER_LENGTH, HEADER_LENGTH + IV_LENGTH),
    ciphertext: bytes.slice(HEADER_LENGTH + IV_LENGTH),
  }
}
