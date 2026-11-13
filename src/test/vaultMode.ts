/** WATSON_VAULT_TEST=1(모든 createDb를 암호화 DB로 돌리는 회귀 실행)인지. */
export const VAULT_MODE = process.env.WATSON_VAULT_TEST === '1'

/**
 * 백업 열쇠 캐시를 CryptoKey로 device_local.backupKey에 두는 흐름. CryptoKey는 정규 JSON으로 봉인할 수 없어(spec §5.3)
 * vault DB에는 저장되지 않는다. spec §3은 이를 암호화된 backupKeyRaw로 바꾼다(계획 Task 8).
 * 그때까지 이 흐름의 시험은 vault 회귀 실행에서만 건너뛴다(평문 실행에서는 그대로 돈다). Task 8에서 지운다.
 */
export const SKIP_UNTIL_BACKUP_KEY_RAW = VAULT_MODE
