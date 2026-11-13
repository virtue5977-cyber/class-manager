import type { AppDB } from '../db/schema'
import { decryptBytes, encryptBytes } from './rowCrypto'

const DEK = Symbol('watson.dek')

export interface BlobCrypto {
  seal(id: string, bytes: Uint8Array): Uint8Array
  open(id: string, sealed: Uint8Array): Uint8Array
}

/** openVaultDb만 부른다: DEK를 db 안 비공개 심볼에 둔다(열거되지 않음). */
export function stashDek(db: AppDB, dek: Uint8Array): void {
  Object.defineProperty(db, DEK, { value: dek, enumerable: false, writable: false, configurable: false })
}

const aad = (id: string) => `watson-blob:v1:${id}`

/** 첨부 바이트 암호화 도구. 평문 DB는 null. */
export function blobCrypto(db: AppDB): BlobCrypto | null {
  const dek = (db as unknown as Record<symbol, Uint8Array | undefined>)[DEK]
  if (!dek) return null
  return {
    seal: (id, bytes) => encryptBytes(dek, bytes, aad(id)),
    open: (id, sealed) => decryptBytes(dek, sealed, aad(id)),
  }
}
