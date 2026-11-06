// 사용자의 "결석신고서 생성기" HTML에서 양식 hwpx를 꺼내 자리표시자를 넣고 기본 양식으로 저장한다.
// 사용: node scripts/extract-absence-template.mjs <생성기.html> <출력.hwpx>
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('사용: node scripts/extract-absence-template.mjs <생성기.html> <출력.hwpx>')
  process.exit(1)
}
const html = await readFile(input, 'utf8')
const b64 = html.match(/var TEMPLATE_B64 = '([^']+)'/)?.[1]
if (!b64) throw new Error('TEMPLATE_B64를 찾지 못했습니다.')
const src = await JSZip.loadAsync(b64, { base64: true })

let sec = await src.file('Contents/section0.xml').async('string')
function rep(from, to, nth = 0) {
  let i = -1
  let pos = 0
  for (let k = 0; k <= nth; k++) {
    i = sec.indexOf(from, pos)
    if (i < 0) throw new Error(`양식에서 찾지 못함: ${from} (${nth})`)
    pos = i + from.length
  }
  sec = sec.slice(0, i) + to + sec.slice(i + from.length)
}
const T = (s) => `<hp:t>${s}</hp:t>`

rep(T('  학 번 :      성 명 :  '), T('  학 번 : {{학번}}    성 명 : {{이름띄움}}  '))
rep(T('   1. 기간 : 2026년    월    일  ~      월     일 (   교시),   [  일간]'), T('   1. 기간 : {{기간}} {{교시표시}}   [ {{일수}}일간]'))
rep(T('출석인정 □    질병 □'), T('출석인정 {{결석_출석인정}}    질병 {{결석_질병}}'))
// 지각(0번째)·결과(1번째): 결과를 먼저 바꾸면 순번이 꼬이지 않는다.
rep(T('출석인정 □'), T('출석인정 {{결과_출석인정}}'), 1)
rep(T('출석인정 □'), T('출석인정 {{지각_출석인정}}'), 0)
rep(T('  출석인정 □'), T('  출석인정 {{조퇴_출석인정}}'))
rep(T('   3. 상세 사유 :'), T('   3. 상세 사유 : {{사유}}'))
rep(T('2026년   월    일  '), T('{{작성연도}}년 {{작성월}}월 {{작성일}}일  '))
rep(T('학  생  성명 :            '), T('학  생  성명 : {{학생성명}}      '))
const CHECKS = [
  ['□ 진료확인서 또는 처방전', '{{확인_진료확인서}} 진료확인서 또는 처방전'],
  ['□ 약봉투 또는 진료영수증', '{{확인_약봉투}} 약봉투 또는 진료영수증'],
  ['□ 의사소견서/진단서', '{{확인_진단서}} 의사소견서/진단서'],
  ['□ 보호자와 통화(문자) 확인', '{{확인_보호자통화}} 보호자와 통화(문자) 확인'],
  ['□ 기타 (', '{{확인_기타}} 기타 ('],
]
for (const [from, to] of CHECKS) rep(from, to)
rep(T(' 2026년    월     일  '), T(' {{확인연도}}년 {{확인월}}월 {{확인일}}일  '))
rep(T('담임교사:             '), T('담임교사: {{담임교사}}      '))
// 원본 양식의 학교명 칸을 표시로 바꾼다(학교명은 원본마다 다르므로 실행할 때 넣는다).
rep(T(` ${process.env.SRC_SCHOOL ?? '학교명'}장  귀하 `), T(' {{학교명}}장  귀하 '))

// 증빙 표(6행 3열): 1~5행의 빈 '보호자 확인' run에 ○ 자리표시자
const EV = ['증빙_2일이내', '증빙_3일이상', '증빙_법정전염병', '증빙_경조사', '증빙_기타']
const m = /<hp:tbl id="\d+"[^>]*rowCnt="6" colCnt="3"/.exec(sec)
if (!m) throw new Error('증빙 표를 찾지 못했습니다.')
const t0 = m.index
const t1 = sec.indexOf('</hp:tbl>', t0)
const parts = sec.slice(t0, t1).split('<hp:tr>')
EV.forEach((name, i) => {
  const row = parts[i + 2]
  const empty = '<hp:run charPrIDRef="24"/>'
  if (!row.includes(empty)) throw new Error(`증빙 ${i + 1}행의 확인 칸을 찾지 못했습니다.`)
  parts[i + 2] = row.replace(empty, `<hp:run charPrIDRef="24"><hp:t>{{${name}}}</hp:t></hp:run>`)
})
sec = sec.slice(0, t0) + parts.join('<hp:tr>') + sec.slice(t1)

const found = [...new Set([...sec.matchAll(/\{\{([0-9A-Za-z_가-힣]+)\}\}/g)].map((x) => x[1]))]
if (found.length !== 30) throw new Error(`자리표시자 개수가 30이 아닙니다: ${found.length}`)

let hpf = await src.file('Contents/content.hpf').async('string')
hpf = hpf.replace(/(<opf:meta name="(?:creator|lastsaveby)" content="text">)[^<]*(<\/opf:meta>)/g, '$1$2')

const out = new JSZip()
const names = Object.keys(src.files).filter((n) => !src.files[n].dir)
names.sort((a, b) => (b === 'mimetype') - (a === 'mimetype'))
for (const n of names) {
  const data = n === 'Contents/section0.xml' ? sec : n === 'Contents/content.hpf' ? hpf : await src.file(n).async('uint8array')
  out.file(n, data, { compression: n === 'mimetype' ? 'STORE' : 'DEFLATE', createFolders: false })
}
const bytes = await out.generateAsync({ type: 'uint8array' })
// 문서 속성 외에도 사람 이름이 남지 않았는지 확인(원본 저장자 이름)
const check = await JSZip.loadAsync(bytes)
for (const n of Object.keys(check.files)) {
  if (check.files[n].dir || n.endsWith('.png')) continue
  const text = await check.file(n).async('string')
  if (/lastsaveby" content="text">[^<]+</.test(text) || /creator" content="text">[^<]+</.test(text)) throw new Error(`문서 속성에 이름이 남았습니다: ${n}`)
}
await writeFile(output, bytes)
// 앱·테스트에서 바로 읽도록 base64 모듈도 쓴다.
await writeFile(output.replace(/\.hwpx$/, '.b64.ts'), `// 자동 생성: scripts/extract-absence-template.mjs\nexport default '${Buffer.from(bytes).toString('base64')}'\n`, 'utf8')
console.log('기본 양식 저장:', output, bytes.length, 'bytes, 자리표시자', found.length)
