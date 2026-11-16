// @vitest-environment node
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const C = require('../../../electron/updateCore.cjs') as {
  verifyInstall: (info: any, sha: string, pem: string, now?: Date) => { ok: boolean; warning?: string }
  checkManifest: (dir: string, m: Record<string, string>) => { ok: boolean; bad: string[] }
}
const scriptUrl = pathToFileURL(path.resolve(__dirname, '../../../scripts/publish-update.mjs')).href
const load = async () => (await import(/* @vite-ignore */ scriptUrl)) as {
  defaultShell: (version: string, mainShell: number, env: Record<string, string | undefined>) => number
  addDays: (date: string, days: number) => string
  publish: (o: { distDir: string; outDir: string; keyPath: string; version: string; shell: number; note?: string; date?: string }) => Promise<any>
}

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

test('기본 MIN_SHELL: 1.0부터 7(환경 변수가 우선), 그 전은 main.cjs SHELL', async () => {
  const P = await load()
  expect(P.defaultShell('1.0.0', 6, {})).toBe(7)
  expect(P.defaultShell('1.2.0', 8, {})).toBe(8)
  expect(P.defaultShell('0.18.2', 6, {})).toBe(6)
  expect(P.defaultShell('1.0.0', 6, { MIN_SHELL: '9' })).toBe(9)
  expect(P.addDays('2026-11-16', 120)).toBe('2027-03-16')
})

test('publish: zip 안 manifest.json, update.json에 expires·sig·sig2, dist-single 없이도 된다', async () => {
  const P = await load()
  const dist = path.join(tmp, 'dist')
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>')
  fs.writeFileSync(path.join(dist, 'assets', 'index-x.js'), 'js')
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const keyPath = path.join(tmp, 'test-key.pem')
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const out = path.join(tmp, 'out')
  const info = await P.publish({ distDir: dist, outDir: out, keyPath, version: '1.0.0', shell: 7, note: '시험', date: '2026-11-16' })
  expect(fs.readdirSync(out).sort()).toEqual(['bundle-1.0.0.zip', 'update.json'])
  const written = JSON.parse(fs.readFileSync(path.join(out, 'update.json'), 'utf8'))
  expect(written).toEqual(info)
  expect(written).toMatchObject({ version: '1.0.0', shell: 7, bundle: 'bundle-1.0.0.zip', note: '시험', date: '2026-11-16', expires: '2027-03-16' })
  const bytes = fs.readFileSync(path.join(out, 'bundle-1.0.0.zip'))
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  expect(C.verifyInstall(written, sha, pem, new Date('2026-11-20'))).toMatchObject({ ok: true })
  const zip = await JSZip.loadAsync(bytes)
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  expect(Object.keys(manifest).sort()).toEqual(['assets/index-x.js', 'index.html'])
  // 풀어 놓으면 manifest 전체 확인이 통과한다
  const un = path.join(tmp, 'un')
  for (const [name, e] of Object.entries(zip.files)) {
    if (e.dir) continue
    fs.mkdirSync(path.dirname(path.join(un, name)), { recursive: true })
    fs.writeFileSync(path.join(un, name), await e.async('nodebuffer'))
  }
  expect(C.checkManifest(un, manifest)).toMatchObject({ ok: true })
})

test('스크립트는 dist-single을 복사하지 않는다(HTML판 폐지)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/publish-update.mjs'), 'utf8')
  expect(src).not.toMatch(/dist-single/)
})
