import { createDb } from '../db/schema'

test('WATSON_VAULT_TEST 스위치: 켜면 createDb가 vault DB, 끄면 평문 DB', () => {
  const db = createDb('switch-' + crypto.randomUUID())
  expect(db.isVault).toBe(process.env.WATSON_VAULT_TEST === '1')
})
