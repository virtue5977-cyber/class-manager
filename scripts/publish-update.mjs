// 업데이트 묶음 만들기: node scripts/publish-update.mjs <개인키.pem> <출력 폴더> [설명]
// dist(화면) + manifest.json(파일별 sha256) → bundle-<버전>.zip, update.json(sig·sig2·expires) 작성.
// 출력 폴더 내용을 GitHub 저장소의 updates 브랜치에 올리면 앱들이 받아 간다. HTML판은 폐지(복사하지 않음).
// 개인 키는 명령줄에 준 경로에서만 읽는다.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const core = require('../electron/updateCore.cjs')

/** 1.0부터 기본 MIN_SHELL은 7(main.cjs SHELL이 더 크면 그것). 환경 변수 MIN_SHELL이 늘 우선. */
export function defaultShell(version, mainShell, env = {}) {
  if (env.MIN_SHELL !== undefined && env.MIN_SHELL !== '') return Number(env.MIN_SHELL)
  return core.versionGte(version, '1.0.0') ? Math.max(7, mainShell) : mainShell
}

/** 'YYYY-MM-DD' + days → 'YYYY-MM-DD'(UTC) */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** dist를 zip으로(맨 위에 manifest.json). */
export async function buildBundle(distDir) {
  const manifest = core.buildManifest(distDir)
  const zip = new JSZip()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else {
        const rel = relative(distDir, p).split('\\').join('/')
        if (rel !== 'manifest.json') zip.file(rel, readFileSync(p))
      }
    }
  }
  walk(distDir)
  zip.file('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { bytes, manifest }
}

export async function publish({ distDir, outDir, keyPath, version, shell, note = '', date = new Date().toISOString().slice(0, 10) }) {
  const key = createPrivateKey(readFileSync(keyPath))
  const { bytes } = await buildBundle(distDir)
  mkdirSync(outDir, { recursive: true })
  const bundle = `bundle-${version}.zip`
  writeFileSync(join(outDir, bundle), bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const info = { version, shell, bundle, sha256, note, date, expires: addDays(date, 120) }
  info.sig = sign(null, Buffer.from(`${version}\n${shell}\n${sha256}`), key).toString('base64')
  info.sig2 = sign(null, Buffer.from(core.canonicalUpdate(info)), key).toString('base64')
  writeFileSync(join(outDir, 'update.json'), JSON.stringify(info, null, 2) + '\n')
  return info
}

async function main() {
  const [keyPath, outDir, note = ''] = process.argv.slice(2)
  if (!keyPath || !outDir) throw new Error('사용법: node scripts/publish-update.mjs <개인키.pem> <출력 폴더> [설명]')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const mainShell = Number(readFileSync('electron/main.cjs', 'utf8').match(/const SHELL = (\d+)/)[1])
  const version = pkg.version
  const shell = defaultShell(version, mainShell, process.env)
  await publish({ distDir: 'dist', outDir, keyPath, version, shell, note })
  console.log(`update ${version} (shell ${shell}) → ${outDir}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
