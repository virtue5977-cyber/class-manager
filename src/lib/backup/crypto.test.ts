// @vitest-environment node
import { deriveKey, encrypt, decrypt, randomBytes, makeKeyCheck, verifyKeyCheck, PBKDF2_ITERATIONS } from './crypto'
import { BackupDecryptError } from './errors'

const IT = 1000
const enc = new TextEncoder()
const aad = enc.encode('header')

test('암호화 후 복호화하면 원문이 나온다', async () => {
  const salt = randomBytes(16)
  const key = await deriveKey('암호구12345', salt, IT)
  const { iv, ciphertext } = await encrypt(key, enc.encode('학생 데이터'), aad)
  const out = await decrypt(key, iv, ciphertext, aad)
  expect(new TextDecoder().decode(out)).toBe('학생 데이터')
})

test('다른 암호구로 복호화하면 BackupDecryptError', async () => {
  const salt = randomBytes(16)
  const key = await deriveKey('암호구12345', salt, IT)
  const other = await deriveKey('다른암호구999', salt, IT)
  const { iv, ciphertext } = await encrypt(key, enc.encode('x'), aad)
  await expect(decrypt(other, iv, ciphertext, aad)).rejects.toBeInstanceOf(BackupDecryptError)
})

test('암호문 한 바이트를 바꾸면 BackupDecryptError', async () => {
  const key = await deriveKey('암호구12345', randomBytes(16), IT)
  const { iv, ciphertext } = await encrypt(key, enc.encode('abcdef'), aad)
  ciphertext[0] ^= 0xff
  await expect(decrypt(key, iv, ciphertext, aad)).rejects.toBeInstanceOf(BackupDecryptError)
})

test('AAD가 다르면 BackupDecryptError', async () => {
  const key = await deriveKey('암호구12345', randomBytes(16), IT)
  const { iv, ciphertext } = await encrypt(key, enc.encode('abcdef'), aad)
  await expect(decrypt(key, iv, ciphertext, enc.encode('other'))).rejects.toBeInstanceOf(BackupDecryptError)
})

test('유도한 키는 내보낼 수 없다', async () => {
  const k = await deriveKey('암호구12345', randomBytes(16), IT)
  await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow()
})

test('기본 반복 횟수는 600000', () => {
  expect(PBKDF2_ITERATIONS).toBe(600000)
})

test('같은 평문도 매번 다른 IV', async () => {
  const key = await deriveKey('암호구12345', randomBytes(16), IT)
  const a = await encrypt(key, enc.encode('same'), aad)
  const b = await encrypt(key, enc.encode('same'), aad)
  expect(a.iv).toHaveLength(12)
  expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false)
})

test('verifyKeyCheck는 같은 키면 true, 다른 키면 false', async () => {
  const salt = randomBytes(16)
  const key = await deriveKey('암호구12345', salt, IT)
  const other = await deriveKey('다른암호구999', salt, IT)
  const check = await makeKeyCheck(key)
  expect(await verifyKeyCheck(key, check)).toBe(true)
  expect(await verifyKeyCheck(other, check)).toBe(false)
})
