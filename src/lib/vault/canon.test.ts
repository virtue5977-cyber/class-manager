import { describe, it, expect } from 'vitest'
import { canonicalJson, parseCanonical, sha256Hex } from './canon'

describe('canonicalJson', () => {
  it('canonicalJson({b:1,a:{d:2,c:3}}) === \'{"a":{"c":3,"d":2},"b":1}\'', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
  it('undefined 칸은 생략하고 null은 유지, 배열 순서 유지', () => {
    expect(canonicalJson({ a: undefined, b: null, c: [3, 1] })).toBe('{"b":null,"c":[3,1]}')
  })
  it('Uint8Array는 $u8 base64로 왕복', () => {
    const u = new Uint8Array([0, 1, 250, 255])
    const s = canonicalJson({ x: u })
    expect(s).toBe('{"x":{"$u8":"AAH6/w=="}}')
    const back = parseCanonical(s) as { x: Uint8Array }
    expect(back.x).toBeInstanceOf(Uint8Array)
    expect(Array.from(back.x)).toEqual([0, 1, 250, 255])
  })
  it('CryptoKey·Blob·함수·Map·Date·비유한 수는 TypeError', () => {
    expect(() => canonicalJson({ k: new Blob(['a']) })).toThrow(TypeError)
    expect(() => canonicalJson({ k: () => 1 })).toThrow('저장할 수 없는 값')
    expect(() => canonicalJson({ k: new Map() })).toThrow(TypeError)
    expect(() => canonicalJson({ k: new Date() })).toThrow(TypeError)
    expect(() => canonicalJson({ k: NaN })).toThrow(TypeError)
    expect(() => canonicalJson({ k: Infinity })).toThrow(TypeError)
  })
  it('성긴 배열 구멍은 null로 쓴다', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(canonicalJson([, 1])).toBe('[null,1]')
  })
  it('sha256Hex', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
