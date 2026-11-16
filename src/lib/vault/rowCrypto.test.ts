import { describe, it, expect } from 'vitest'
import { sealRow, openRow, encryptBytes, decryptBytes, OpenTextCache } from './rowCrypto'
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

describe('OpenTextCache(푼 글 캐시)', () => {
  it('같은 암호문이면 캐시에서, 행 객체는 매번 새것이고 내용은 같다', () => {
    const k = key()
    const c = new OpenTextCache()
    const s = sealRow('t', row, k, PLAIN)
    const a = openRow('t', s, k, PLAIN, c)
    expect(c.size).toBe(1)
    const b = openRow('t', { ...s }, k, PLAIN, c)
    expect(b).not.toBe(a)
    expect(canonicalJson(b)).toBe(canonicalJson(row))
    ;(a as Record<string, unknown>).name = '바뀜' // 돌려준 객체를 고쳐도 다음 읽기에 번지지 않는다
    expect((openRow('t', s, k, PLAIN, c) as Record<string, unknown>).name).toBe('가상학생')
  })
  it('캐시가 있어도 변조된 암호문은 _broken(바이트가 다르면 다시 풀어 확인)', () => {
    const k = key()
    const c = new OpenTextCache()
    const s = sealRow('t', row, k, PLAIN)
    openRow('t', s, k, PLAIN, c)
    const bad = (s._enc as Uint8Array).slice(); bad[bad.length - 1] ^= 1
    expect(openRow('t', { ...s, _enc: bad }, k, PLAIN, c)).toEqual({ id: 7, _broken: true })
    // 캐시는 이전 암호문 바이트를 따로 들고 있어 원본 배열을 고쳐도 속지 않는다
    const enc = s._enc as Uint8Array
    enc[enc.length - 1] ^= 1
    expect(openRow('t', s, k, PLAIN, c)).toEqual({ id: 7, _broken: true })
  })
  it('캐시가 있어도 평문 칸 변조·다른 표·다른 id는 _broken', () => {
    const k = key()
    const c = new OpenTextCache()
    const s = sealRow('t', row, k, PLAIN)
    openRow('t', s, k, PLAIN, c)
    expect(openRow('t', { ...s, student_id: 4 }, k, PLAIN, c)).toEqual({ id: 7, _broken: true })
    expect(openRow('other', s, k, PLAIN, c)).toEqual({ id: 7, _broken: true })
    expect(openRow('t', { ...s, id: 8 }, k, PLAIN, c)).toEqual({ id: 8, _broken: true })
  })
  it('바이트 한도를 넘으면 오래된 것부터 버린다', () => {
    const c = new OpenTextCache(1200)
    const enc = (n: number) => new Uint8Array(50).fill(n)
    for (let i = 0; i < 10; i++) c.set('r' + i, enc(i), 'x'.repeat(50)) // 하나에 150바이트
    expect(c.size).toBe(8)
    expect(c.get('r0', enc(0))).toBeUndefined()
    expect(c.get('r1', enc(1))).toBeUndefined()
    expect(c.get('r2', enc(2))).toBe('x'.repeat(50))
    expect(c.get('r9', enc(9))).toBe('x'.repeat(50))
    expect(c.get('r9', enc(8))).toBeUndefined()
    c.set('big', enc(1), 'y'.repeat(100)) // 한도의 1/8(150)보다 크면 두지 않는다
    expect(c.get('big', enc(1))).toBeUndefined()
  })
})
