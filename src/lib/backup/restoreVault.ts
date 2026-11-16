import Dexie from 'dexie'
import { decrypt, deriveKey } from './crypto'
import { decodeBackupFile } from './format'
import { importSnapshot, parseSnapshot, validateSnapshot } from './snapshot'
import { setupPassphrase } from './service'
import { openVaultDb } from '../vault/vaultDb'
import {
  buildVaultPayload, dbNameFor, newDek, newRecoveryCode, recoveryKeyRaw, PASS_ITER, RECOVERY_ITER,
  type VaultPayload,
} from '../vault/keys'

export interface RestoreVaultDeps { store: (payload: VaultPayload) => Promise<unknown> }

/**
 * 열쇠를 잃은 PC용: 백업을 먼저 암호구로 풀어 확인한 뒤(틀리면 아무것도 만들지 않는다),
 * 새 DEK·새 암호화 DB·열쇠 보관(vault)을 만들고 백업으로 채운다.
 * 암호구 열쇠(passKey)는 한 번만 유도해 vault의 pass 감싸기와 DB의 backupKeyRaw에 함께 쓴다.
 * DB를 만든 뒤 실패하면 그 새 DB만 지우고 오류를 다시 올린다.
 */
export async function restoreIntoNewVault(
  bytes: Uint8Array,
  passphrase: string,
  deps: RestoreVaultDeps,
): Promise<{ dbName: string; recoveryCode: string }> {
  const { header, headerBytes, iv, ciphertext } = decodeBackupFile(bytes)
  const key = await deriveKey(passphrase, header.salt, header.iterations)
  const snapshot = validateSnapshot(parseSnapshot(await decrypt(key, iv, ciphertext, headerBytes)))

  // 이미 있는 DB 이름과 겹치면(드묾) 새 열쇠로 다시 만든다. 남의 DB를 건드리지 않기 위해서다.
  const existing = new Set(await Dexie.getDatabaseNames())
  let { dek, keyId } = newDek()
  while (existing.has(dbNameFor(keyId))) ({ dek, keyId } = newDek())
  const dbName = dbNameFor(keyId)
  const db = openVaultDb(dbName, dek)
  try {
    await db.open()
    await importSnapshot(db, snapshot)
    const k = await setupPassphrase(db, passphrase, { iterations: PASS_ITER }) // 새 salt, 백업 열쇠 캐시도 같은 값
    const recoveryCode = newRecoveryCode()
    const recSalt = crypto.getRandomValues(new Uint8Array(16))
    const recoveryRaw = await recoveryKeyRaw(recoveryCode, recSalt, RECOVERY_ITER)
    const payload = buildVaultPayload({
      keyId, dek, passRaw: k.raw, passSalt: k.salt, passIter: k.iter,
      recoveryRaw, recoverySalt: recSalt, recoveryIter: RECOVERY_ITER,
    })
    // 완료 표시 → 닫기 → vault.store는 맨 마지막. store가 성공한 뒤에는 DB를 지우지 않는다.
    await db.meta.put({ id: 'vault', complete: true })
    db.close()
    await deps.store(payload)
    return { dbName, recoveryCode }
  } catch (e) {
    try { db.close() } catch { /* ignore */ }
    try { await Dexie.delete(dbName) } catch { /* ignore */ }
    throw e
  }
}
