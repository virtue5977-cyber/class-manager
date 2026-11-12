import { imageMime, imageSize, isImageName } from './images'

const png = (w: number, h: number) => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
const gif = (w: number, h: number) => {
  const b = new Uint8Array(13)
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  new DataView(b.buffer).setUint16(6, w, true)
  new DataView(b.buffer).setUint16(8, h, true)
  return b
}
const jpg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3])

test('그림 형식·크기 읽기(png·gif·jpg), 지원 안 하면 null', () => {
  expect(imageSize(png(640, 480))).toEqual({ w: 640, h: 480 })
  expect(imageSize(gif(10, 20))).toEqual({ w: 10, h: 20 })
  expect(imageSize(jpg(1200, 900))).toEqual({ w: 1200, h: 900 })
  expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  expect(imageMime(png(1, 1))).toBe('image/png')
  expect(imageMime(jpg(1, 1))).toBe('image/jpeg')
  expect(isImageName('사진.JPG')).toBe(true)
  expect(isImageName('문서.hwpx')).toBe(false)
})
