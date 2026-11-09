// 업데이트 묶음 만들기: node scripts/publish-update.mjs <개인키.pem> <출력 폴더> [설명]
// dist(화면) → bundle-<버전>.zip, dist-single/담임업무.html 복사, update.json(서명 포함) 작성.
// 출력 폴더 내용을 GitHub 저장소의 updates 브랜치에 올리면 앱들이 받아 간다.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash, createPrivateKey, sign } from 'node:crypto'
import JSZip from 'jszip'

const [keyPath, outDir, note = ''] = process.argv.slice(2)
if (!keyPath || !outDir) throw new Error('사용법: node scripts/publish-update.mjs <개인키.pem> <출력 폴더> [설명]')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const SHELL = Number(process.env.MIN_SHELL ?? readFileSync('electron/main.cjs', 'utf8').match(/const SHELL = (\d+)/)[1])
const version = pkg.version

const zip = new JSZip()
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else zip.file(relative('dist', p).split('\\').join('/'), readFileSync(p))
  }
}
walk('dist')
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
mkdirSync(outDir, { recursive: true })
const bundle = `bundle-${version}.zip`
writeFileSync(join(outDir, bundle), bytes)
copyFileSync('dist-single/담임업무.html', join(outDir, '담임업무.html'))
const sha256 = createHash('sha256').update(bytes).digest('hex')
const sig = sign(null, Buffer.from(`${version}\n${SHELL}\n${sha256}`), createPrivateKey(readFileSync(keyPath))).toString('base64')
writeFileSync(join(outDir, 'update.json'), JSON.stringify({ version, shell: SHELL, bundle, sha256, sig, note, date: new Date().toISOString().slice(0, 10) }, null, 2) + '\n')
console.log(`update ${version} (shell ${SHELL}) → ${outDir}`)
