/** 노트 그림: 형식·크기 읽기, 큰 그림 줄이기(브라우저에서만) */
export const MAX_IMAGE = 10 * 1024 * 1024
export const MAX_SIDE = 2000

export const isImageName = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name)

/** 첫 바이트로 형식 알기 */
export function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}
export const imageExt = (mime: string) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' })[mime] ?? 'png'

/** 픽셀 크기(못 읽으면 null) */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const mime = imageMime(b)
  try {
    if (mime === 'image/png' && b.length >= 24) return { w: dv.getUint32(16), h: dv.getUint32(20) }
    if (mime === 'image/gif' && b.length >= 10) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
    if (mime === 'image/webp' && b.length >= 30) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
      if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
      if (kind === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff }
      if (kind === 'VP8L') {
        const v = dv.getUint32(21, true)
        return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }
      }
      return null
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const m = b[i + 1]
        const len = dv.getUint16(i + 2)
        // SOF0~SOF15(DHT·JPG·DAC 빼고)
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) }
        i += 2 + len
      }
    }
  } catch {
    return null
  }
  return null
}

/** 긴 쪽이 MAX_SIDE를 넘으면 줄인다(브라우저 캔버스가 없으면 그대로). gif는 움직임을 지키려고 그대로 둔다. */
export async function shrinkImage(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const sz = imageSize(bytes)
  if (!sz || Math.max(sz.w, sz.h) <= MAX_SIDE || mime === 'image/gif') return { bytes, mime }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return { bytes, mime }
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
    const k = MAX_SIDE / Math.max(sz.w, sz.h)
    const c = document.createElement('canvas')
    c.width = Math.round(sz.w * k)
    c.height = Math.round(sz.h * k)
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
    const out = mime === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, out, 0.88))
    if (!blob) return { bytes, mime }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: out }
  } catch {
    return { bytes, mime }
  }
}
