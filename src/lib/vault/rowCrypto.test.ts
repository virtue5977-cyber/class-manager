import { describe, it, expect } from 'vitest'
import { sealRow, openRow, encryptBytes, decryptBytes } from './rowCrypto'
import { canonicalJson } from './canon'

const key = () => crypto.getRandomValues(new Uint8Array(32))
const PLAIN = new Set(['id', 'student_id'])
const row = { id: 7, student_id: 3, name: '가상학생', memo: undefined, bin: new Uint8Array([1, 2, 3]) }

describe('rowCrypto', () => {
  it('seal/open 왕복: 정규 JSON 같고 _enc 없음', () => {
    const k = key()
    const s = sealRow('t', row, k, PLAIN)
    expect(s._enc).toBeInstanceOf(Uint8Array)
    expect(s.id).toBe(7)
    expect(s.name).toBeUndefined()
    const o = openRow('t', s, k, PLAIN)
    expect('_enc' in o).toBe(false)
    expect(canonicalJson(o)).toBe(canonicalJson(row))
  })
  it('aad가 다르면(다른 표·id로 옮긴 암호문) _broken', () => {
    const k = key()
    const s = sealRow('t', row, k, PLAIN)
    expect(openRow('other', s, k, PLAIN)).toEqual({ id: 7, _broken: true })
    expect(openRow('t', { ...s, id: 8 }, k, PLAIN)).toEqual({ id: 8, _broken: true })
  })
  it('평문 칸 변조(student_id 바꿈) → _broken', () => {
    const k = key()
    const s = sealRow('t', row, k, PLAIN)
    expect(openRow('t', { ...s, student_id: 4 }, k, PLAIN)).toEqual({ id: 7, _broken: true })
  })
  it('다른 열쇠 → _broken', () => {
    const s = sealRow('t', row, key(), PLAIN)
    expect(openRow('t', s, key(), PLAIN)).toEqual({ id: 7, _broken: true })
  })
  it('Uint8Array 칸 왕복', () => {
    const k = key()
    const o = openRow('t', sealRow('t', row, k, PLAIN), k, PLAIN) as { bin: Uint8Array }
    expect(Array.from(o.bin)).toEqual([1, 2, 3])
  })
  it('CryptoKey 칸은 TypeError', async () => {
    const ck = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    expect(() => sealRow('t', { id: 1, k: ck }, key(), PLAIN)).toThrow(TypeError)
  })
  it('판 바이트가 1이 아니면 오류, 손상·_enc 없음은 _broken', () => {
    const k = key()
    const sealed = encryptBytes(k, new Uint8Array([1]), 'a')
    expect(Array.from(decryptBytes(k, sealed, 'a'))).toEqual([1])
    const bad = sealed.slice(); bad[0] = 2
    expect(() => decryptBytes(k, bad, 'a')).toThrow()
    expect(openRow('t', { id: 1 }, k, PLAIN)).toEqual({ id: 1, _broken: true })
    expect(openRow('t', { id: 1, _enc: new Uint8Array(3) }, k, PLAIN)).toEqual({ id: 1, _broken: true })
  })
  it('성긴 배열 칸 왕복', () => {
    const k = key()
    // eslint-disable-next-line no-sparse-arrays
    const r = { id: 1, list: [, 2] }
    const o = openRow('t', sealRow('t', r, k, PLAIN), k, PLAIN)
    expect(o).toEqual({ id: 1, list: [null, 2] })
  })
  it('열쇠 길이가 32가 아니면 TypeError', () => {
    expect(() => encryptBytes(new Uint8Array(16), new Uint8Array(1), 'a')).toThrow()
    expect(() => decryptBytes(new Uint8Array(31), new Uint8Array(40), 'a')).toThrow()
  })
  it('id 없는 행은 암호화 불가', () => {
    expect(() => sealRow('t', { name: 'x' }, key(), PLAIN)).toThrow('id 없는 행은 암호화할 수 없습니다')
    expect(() => sealRow('t', { id: null }, key(), PLAIN)).toThrow(TypeError)
  })
})
