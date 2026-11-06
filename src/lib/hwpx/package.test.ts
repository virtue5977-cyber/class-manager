// @vitest-environment node
import JSZip from 'jszip'
import { buildHwpx, BASE_CHARPR_COUNT, type HwpxDoc } from './package'
import { unzipText, xmlErrors } from './testUtil'
import header from './base/header.xml?raw'
import secPr from './base/secPr.xml?raw'
import hpf from './base/content.hpf?raw'
import open from './base/section-open.xml?raw'

const body = '<hp:p id="1" paraPrIDRef="13" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>본문</hp:t></hp:run></hp:p>'
const doc = (over: Partial<HwpxDoc> = {}): HwpxDoc => ({ landscape: false, bodyXml: body, charPrXml: [], previewText: '본문', title: '시험 & 문서', ...over })

test('첫 항목은 무압축 mimetype', async () => {
  const bytes = await buildHwpx(doc())
  const zip = await JSZip.loadAsync(bytes)
  expect(Object.keys(zip.files)[0]).toBe('mimetype')
  expect(await zip.file('mimetype')!.async('string')).toBe('application/hwp+zip')
  // 로컬 파일 헤더: 오프셋 8~9가 압축 방식(0=STORE), 30부터 파일 이름
  expect(bytes[8] | (bytes[9] << 8)).toBe(0)
  expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe('mimetype')
})

test('모든 XML이 올바른 XML이다', async () => {
  const files = await unzipText(await buildHwpx(doc()))
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith('.xml') || name.endsWith('.hpf') || name.endsWith('.rdf')) expect([name, xmlErrors(text)]).toEqual([name, []])
  }
})

test('charPr를 넣으면 itemCnt와 개수가 맞는다', async () => {
  const cp = (id: number) => `<hh:charPr id="${id}" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2"><hh:fontRef hangul="2" latin="2" hanja="2" japanese="2" other="2" symbol="2" user="2"/></hh:charPr>`
  const files = await unzipText(await buildHwpx(doc({ charPrXml: [cp(12), cp(13)] })))
  const h = files['Contents/header.xml']
  expect(h).toContain(`<hh:charProperties itemCnt="${BASE_CHARPR_COUNT + 2}"`)
  expect(h.match(/<hh:charPr /g)).toHaveLength(14)
})

test('세로는 WIDELY, 가로는 NARROWLY', async () => {
  const p = (await unzipText(await buildHwpx(doc({ landscape: false }))))['Contents/section0.xml']
  const l = (await unzipText(await buildHwpx(doc({ landscape: true }))))['Contents/section0.xml']
  expect(p).toContain('landscape="WIDELY"')
  expect(l).toContain('landscape="NARROWLY"')
  expect(p).toContain('width="59528" height="84188"')
})

test('content.hpf에 날짜와 제목이 들어가고 {{ 자리표시자가 남지 않는다', async () => {
  const f = (await unzipText(await buildHwpx(doc(), new Date('2026-11-05T01:02:03.456Z'))))['Contents/content.hpf']
  expect(f).toContain('2026-11-05T01:02:03Z')
  expect(f).toContain('<opf:title>시험 &amp; 문서</opf:title>')
  expect(f).not.toContain('{{')
})

test('기본 양식 파일에 본문 글자(<hp:t>)가 없다', () => {
  for (const t of [header, secPr, hpf, open]) expect(t).not.toMatch(/<hp:t[ >]/)
})

test('본문 문단이 secPr 문단 뒤에 들어간다', async () => {
  const s = (await unzipText(await buildHwpx(doc())))['Contents/section0.xml']
  expect(s.indexOf('</hp:secPr>')).toBeGreaterThan(0)
  expect(s.indexOf('<hp:t>본문</hp:t>')).toBeGreaterThan(s.indexOf('</hp:secPr>'))
  expect(s.trim().endsWith('</hs:sec>')).toBe(true)
})

test('미리보기 텍스트가 들어간다', async () => {
  expect((await unzipText(await buildHwpx(doc())))['Preview/PrvText.txt']).toBe('본문')
})

test('폴더 항목 없이 10개 파일만 들어간다', async () => {
  const zip = await JSZip.loadAsync(await buildHwpx(doc()))
  expect(Object.values(zip.files).filter((f) => f.dir)).toHaveLength(0)
  expect(Object.keys(zip.files)).toHaveLength(10)
})
