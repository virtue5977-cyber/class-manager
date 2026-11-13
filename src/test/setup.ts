import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

// WATSON_VAULT_TEST=1: createDb(name)가 고정 시험 열쇠의 암호화 DB를 돌려준다(전체 회귀 시험용).
if (process.env.WATSON_VAULT_TEST === '1') {
  const { openVaultDb } = await import('../lib/vault/vaultDb')
  const { TEST_KEY } = await import('../lib/vault/testing')
  ;(globalThis as { __watsonTestCreateDb?: (n: string) => unknown }).__watsonTestCreateDb = (n: string) =>
    openVaultDb(n, TEST_KEY)
}
