/** WATSON_VAULT_TEST=1(모든 createDb를 암호화 DB로 돌리는 회귀 실행)인지. */
export const VAULT_MODE = process.env.WATSON_VAULT_TEST === '1'
