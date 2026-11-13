// @vitest-environment node
import { createRequire } from 'node:module'
import {
  newDek, dbNameFor, passKeyRaw, wrapDek, unwrapDek, newRecoveryCode, normalizeRecoveryCode,
  recoveryKeyRaw, buildVaultPayload,
} from './keys'
import { makeKeyCheck, verifyKeyCheck, deriveKey, toBase64, fromBase64, encrypt } from '../backup/crypto'

const require = createRequire(import.meta.url)
const { validStorePayload } = require('../../../electron/vault.cjs') as { validStorePayload: (p: unknown) => boolean }
const salt = () => crypto.getRandomValues(new Uint8Array(16))
const LOW = 1000

test('newDek: 32바이트와 소문자 uuid, dbName은 앞 8자', () => {
  const { dek, keyId } = newDek()
  expect(dek.length).toBe(32)
  expect(keyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(dbNameFor(keyId)).toBe('watson-' + keyId.slice(0, 8))
})

test('wrap/unwrap 왕복', async () => {
  const { dek, keyId } = newDek()
  const raw = await passKeyRaw('암호구-테스트', salt(), LOW)
  expect(raw.length).toBe(32)
  const w = wrapDek(dek, raw, keyId, 'pass', salt(), LOW)
  expect(unwrapDek(w, raw, keyId, 'pass')).toEqual(dek)
})

test('틀린 열쇠 → 열쇠가 맞지 않습니다', async () => {
  const { dek, keyId } = newDek()
  const w = wrapDek(dek, await passKeyRaw('aaaaaaaa', salt(), LOW), keyId, 'pass', salt(), LOW)
  expect(() => unwrapDek(w, await0(), keyId, 'pass')).toThrow('열쇠가 맞지 않습니다')
})
function await0() { return new Uint8Array(32) }

test('pass로 감싼 것을 recovery로 풀면 오류(aad 분리), keyId가 달라도 오류', async () => {
  const { dek, keyId } = newDek()
  const raw = await passKeyRaw('aaaaaaaa', salt(), LOW)
  const w = wrapDek(dek, raw, keyId, 'pass', salt(), LOW)
  expect(() => unwrapDek(w, raw, keyId, 'recovery')).toThrow('열쇠가 맞지 않습니다')
  expect(() => unwrapDek(w, raw, crypto.randomUUID(), 'pass')).toThrow('열쇠가 맞지 않습니다')
})

test('복원 코드: 25자 문자 집합, 형식', () => {
  for (let i = 0; i < 50; i++) {
    const c = newRecoveryCode()
    expect(c).toMatch(/^[2-9A-HJ-NP-Z]{5}(-[2-9A-HJ-NP-Z]{5}){4}$/)
    expect(c).not.toMatch(/[01OI]/)
  }
  expect(newRecoveryCode()).not.toBe(newRecoveryCode())
})

test('normalizeRecoveryCode: 공백·하이픈·소문자 허용', () => {
  expect(normalizeRecoveryCode('abcde fghjk-mnpqr stuvw xyz23')).toBe('ABCDE-FGHJK-MNPQR-STUVW-XYZ23')
  expect(() => normalizeRecoveryCode('ABCDE')).toThrow('복구 코드')
  expect(() => normalizeRecoveryCode('0BCDE-FGHJK-MNPQR-STUVW-XYZ23')).toThrow('복구 코드')
  expect(() => normalizeRecoveryCode('ABCDE-FGHJK-MNPQR-STUVW-XYZ234')).toThrow('복구 코드')
})

test('recoveryKeyRaw: 하이픈 유무·소문자와 무관', async () => {
  const s = salt()
  const a = await recoveryKeyRaw('ABCDE-FGHJK-MNPQR-STUVW-XYZ23', s, LOW)
  const b = await recoveryKeyRaw('abcdefghjkmnpqrstuvwxyz23', s, LOW)
  expect(a).toEqual(b)
})

test('옛 빈-aad 확인값도 verifyKeyCheck 통과, 새 확인값도 통과', async () => {
  const key = await deriveKey('암호구암호구', salt(), LOW)
  expect(await verifyKeyCheck(key, await makeKeyCheck(key))).toBe(true)
  const { iv, ciphertext } = await encrypt(key, new TextEncoder().encode('class-manager-key-check'), new Uint8Array(0))
  const j = new Uint8Array(12 + ciphertext.length); j.set(iv); j.set(ciphertext, 12)
  expect(await verifyKeyCheck(key, toBase64(j))).toBe(true)
  const other = await deriveKey('다른암호구암호', salt(), LOW)
  expect(await verifyKeyCheck(other, await makeKeyCheck(key))).toBe(false)
})

test('buildVaultPayload는 vault:store 검사를 통과하고 풀린다', async () => {
  const { dek, keyId } = newDek()
  const ps = salt(), rs = salt()
  const passRaw = await passKeyRaw('암호구-테스트', ps, 600000)
  const recoveryRaw = await recoveryKeyRaw(newRecoveryCode(), rs)
  const p = buildVaultPayload({ keyId, dek, passRaw, passSalt: ps, recoveryRaw, recoverySalt: rs })
  expect(validStorePayload(p)).toBe(true)
  expect(p.pass.iter).toBe(600000)
  expect(p.recovery!.iter).toBe(100000)
  expect(unwrapDek(p.pass, passRaw, keyId, 'pass')).toEqual(dek)
  expect(unwrapDek(p.recovery!, recoveryRaw, keyId, 'recovery')).toEqual(dek)
  const noRec = buildVaultPayload({ keyId, dek, passRaw, passSalt: ps })
  expect(noRec.recovery).toBeUndefined()
  expect(validStorePayload(noRec)).toBe(true)
})

test('wrapDek: salt는 16바이트여야 하고 저장된 salt로 다시 유도해 풀린다', async () => {
  const { dek, keyId } = newDek()
  const s = salt()
  const raw = await passKeyRaw('암호구-테스트', s, LOW)
  // @ts-expect-error salt·iter는 필수
  expect(() => wrapDek(dek, raw, keyId, 'pass')).toThrow()
  expect(() => wrapDek(dek, raw, keyId, 'pass', new Uint8Array(8), LOW)).toThrow('salt')
  const w = wrapDek(dek, raw, keyId, 'pass', s, LOW)
  const again = await passKeyRaw('암호구-테스트', fromBase64(w.salt), w.iter)
  expect(unwrapDek(w, again, keyId, 'pass')).toEqual(dek)
})
