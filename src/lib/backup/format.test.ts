// @vitest-environment node
import { encodeBackupFile, decodeBackupFile, encodeHeader, HEADER_LENGTH } from './format'
import { BackupFormatError } from './errors'

const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
const iv = Uint8Array.from({ length: 12 }, (_, i) => 100 + i)
const ct = Uint8Array.from({ length: 20 }, (_, i) => 200 + i)

test('인코딩 후 디코딩하면 머리말·IV·암호문이 같다', () => {
  const f = encodeBackupFile({ formatVersion: 1, iterations: 600000, salt }, iv, ct)
  const d = decodeBackupFile(f)
  expect(d.header.formatVersion).toBe(1)
  expect(d.header.iterations).toBe(600000)
  expect([...d.header.salt]).toEqual([...salt])
  expect([...d.iv]).toEqual([...iv])
  expect([...d.ciphertext]).toEqual([...ct])
  expect(HEADER_LENGTH).toBe(25)
  expect([...d.headerBytes]).toEqual([...encodeHeader({ formatVersion: 1, iterations: 600000, salt })])
})

test('앞 4바이트가 CMBK가 아니면 BackupFormatError', () => {
  const f = encodeBackupFile({ formatVersion: 1, iterations: 1000, salt }, iv, ct)
  f[0] = 0x58
  expect(() => decodeBackupFile(f)).toThrow(BackupFormatError)
})

test('53바이트보다 짧으면 BackupFormatError', () => {
  expect(() => decodeBackupFile(new Uint8Array(52))).toThrow(BackupFormatError)
  const f = encodeBackupFile({ formatVersion: 1, iterations: 1000, salt }, iv, new Uint8Array(16))
  expect(f.length).toBe(53)
  expect(() => decodeBackupFile(f)).not.toThrow()
})

test('formatVersion이 1이 아니면 BackupFormatError', () => {
  const f = encodeBackupFile({ formatVersion: 1, iterations: 1000, salt }, iv, ct)
  f[4] = 2
  expect(() => decodeBackupFile(f)).toThrow(BackupFormatError)
})

test('iterations가 big-endian으로 저장된다', () => {
  const f = encodeBackupFile({ formatVersion: 1, iterations: 600000, salt: new Uint8Array(16) }, new Uint8Array(12), new Uint8Array(16))
  expect([...f.slice(5, 9)]).toEqual([0x00, 0x09, 0x27, 0xc0])
})

test('iterations가 터무니없이 크면(1천만 넘음) 열지 않는다(멈춤 방지)', () => {
  expect(() => decodeBackupFile(encodeBackupFile({ formatVersion: 1, iterations: 4_000_000_000, salt }, iv, ct))).toThrow(BackupFormatError)
  expect(decodeBackupFile(encodeBackupFile({ formatVersion: 1, iterations: 10_000_000, salt }, iv, ct)).header.iterations).toBe(10_000_000)
})
