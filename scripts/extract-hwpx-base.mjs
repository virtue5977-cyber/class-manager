// 한글이 만든 hwpx에서 서식 정의만 뽑아 기본 양식으로 저장한다(본문·미리보기·작성자 제외).
// 사용: node scripts/extract-hwpx-base.mjs <예시.hwpx> <출력 폴더>
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'

const [, , input, outDir] = process.argv
if (!input || !outDir) {
  console.error('사용: node scripts/extract-hwpx-base.mjs <예시.hwpx> <출력 폴더>')
  process.exit(1)
}
const zip = await JSZip.loadAsync(await readFile(input))
const text = (p) => {
  const f = zip.file(p)
  if (!f) throw new Error(`없음: ${p}`)
  return f.async('string')
}
await mkdir(outDir, { recursive: true })
const out = (name, body) => writeFile(join(outDir, name), body, 'utf8')

await out('version.xml', await text('version.xml'))
await out('header.xml', await text('Contents/header.xml'))
await out('container.rdf', await text('META-INF/container.rdf'))
await out('manifest.xml', await text('META-INF/manifest.xml'))
await out('container.xml', await text('META-INF/container.xml'))
await out('settings.xml', (await text('settings.xml')).replace(/<ha:CaretPosition[^>]*\/>/, '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>'))

let hpf = await text('Contents/content.hpf')
hpf = hpf
  .replace(/<opf:title\/>|<opf:title>[^<]*<\/opf:title>/, '<opf:title>{{TITLE}}</opf:title>')
  .replace(/(<opf:meta name="(?:creator|lastsaveby)" content="text">)[^<]*(<\/opf:meta>)/g, '$1$2')
  .replace(/(<opf:meta name="(?:CreatedDate|ModifiedDate)" content="text">)[^<]*(<\/opf:meta>)/g, '$1{{DATE}}$2')
  .replace(/(<opf:meta name="date" content="text">)[^<]*(<\/opf:meta>)/, '$1$2')
await out('content.hpf', hpf)

const sec = await text('Contents/section0.xml')
const open = sec.match(/<hs:sec\b[^>]*>/)
const secPr = sec.match(/<hp:secPr\b[\s\S]*?<\/hp:ctrl>/)
if (!open || !secPr) throw new Error('section0.xml에서 hs:sec 또는 secPr을 찾지 못했습니다.')
await out('section-open.xml', open[0])
await out('secPr.xml', secPr[0])

for (const f of await readdir(outDir)) {
  const body = await readFile(join(outDir, f), 'utf8')
  if (body.includes('<hp:t>') || body.includes('<hp:t ')) throw new Error(`본문 글자가 남아 있습니다: ${f}`)
}
console.log('기본 양식을 추출했습니다:', (await readdir(outDir)).join(', '))
