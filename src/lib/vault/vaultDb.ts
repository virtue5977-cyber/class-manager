import { AppDB } from '../db/schema'
import { encryptionMiddleware } from './middleware'
import { stashDek } from './blobCrypto'

export { blobCrypto } from './blobCrypto'

export { VAULT_STORES, UNENCRYPTED_TABLES } from '../db/schema'

/** 암호화 DB(watson-*)를 연다: vault 스키마 + 암호화 미들웨어. dek는 32바이트. */
export function openVaultDb(name: string, dek: Uint8Array): AppDB {
  const db = new AppDB(name, { vault: true, immutableCache: true })
  db.use(encryptionMiddleware(dek))
  stashDek(db, dek)
  return db
}
