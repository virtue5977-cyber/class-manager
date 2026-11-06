// @vitest-environment node
import { createDb } from './db/schema'
import { setPin, verifyPin, clearPin, pinActive, validatePin, lockoutMs } from './pin'
import { exportSnapshot } from './backup/snapshot'

test('PIN 설정·확인·해제, 기기 전용(백업에 없음)', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  expect(await pinActive(db)).toBe(false)
  await expect(setPin(db, '12a4', 10)).rejects.toThrow('숫자 4~8자리')
  await setPin(db, '1234', 10)
  expect(await pinActive(db)).toBe(true)
  expect(await verifyPin(db, '1234')).toBe(true)
  expect(await verifyPin(db, '4321')).toBe(false)
  expect(JSON.stringify(await exportSnapshot(db))).not.toContain('"pin"')
  await clearPin(db)
  expect(await pinActive(db)).toBe(false)
  expect(validatePin('12345678')).toBeNull()
  expect([lockoutMs(4), lockoutMs(5), lockoutMs(6)]).toEqual([0, 30000, 60000])
})
