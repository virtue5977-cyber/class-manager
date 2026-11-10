// Watson 아이콘(W)을 그려 build/icon.png(256), electron/assets/icon.png, build/icon.ico(16·32·48·256)로 저장한다.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { writeFileSync } from 'node:fs'

const sizes = [256, 48, 32, 16]
const b = await chromium.launch()
const p = await b.newPage()
const pngs = []
for (const s of sizes) {
  await p.setViewportSize({ width: s, height: s })
  await p.setContent(`<body style="margin:0;background:transparent"><div style="width:${s}px;height:${s}px;border-radius:${s * 0.22}px;background:#0a6fd6;display:flex;align-items:center;justify-content:center;color:#fff;font:800 ${s * 0.62}px/1 'Segoe UI',Arial,sans-serif">W</div></body>`)
  pngs.push(await p.screenshot({ omitBackground: true }))
}
await b.close()
writeFileSync('build/icon.png', pngs[0])
writeFileSync('electron/assets/icon.png', pngs[0])
// ICO: 헤더 6바이트 + 항목 16바이트씩 + PNG 그대로
const head = Buffer.alloc(6 + 16 * pngs.length)
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4)
let off = head.length
pngs.forEach((png, i) => {
  const s = sizes[i], e = 6 + 16 * i
  head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1)
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6)
  head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12)
  off += png.length
})
writeFileSync('build/icon.ico', Buffer.concat([head, ...pngs]))
console.log('icon ok', off)
