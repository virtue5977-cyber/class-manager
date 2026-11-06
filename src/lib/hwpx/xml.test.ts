// @vitest-environment node
import { DOMParser } from '@xmldom/xmldom'
import { escapeXml, paragraphXml, tableXml, type TableCell } from './xml'
import { CharPrRegistry } from './charPr'
import { xmlErrors } from './testUtil'

const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"'
const wrap = (x: string) => `<root ${NS}>${x}</root>`
const cell = (text: string, extra: Partial<TableCell> = {}): TableCell => ({ text, charPr: 0, ...extra })

test('escapeXml', () => expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;'))

test('같은 크기·굵기는 같은 charPr id, 다르면 새 id(12부터)', () => {
  const r = new CharPrRegistry()
  expect(r.id(11)).toBe(12)
  expect(r.id(11)).toBe(12)
  expect(r.id(11, true)).toBe(13)
  expect(r.id(17, true)).toBe(14)
  const xml = r.xml()
  expect(xml).toHaveLength(3)
  expect(xml[0]).toMatch(/^<hh:charPr id="12" height="1100"/)
  expect(xml[2]).toMatch(/^<hh:charPr id="14" height="1700"/)
  for (const x of xml) expect(xmlErrors(wrap(x))).toEqual([])
})

test('굵은 charPr에는 <hh:bold/>가 offset 뒤에 있다', () => {
  const r = new CharPrRegistry()
  r.id(10)
  r.id(10, true)
  const [plain, bold] = r.xml()
  expect(plain).not.toContain('<hh:bold/>')
  expect(bold).toMatch(/<hh:offset [^>]*\/><hh:bold\/>/)
})

test('tableXml: 2행×3열이면 rowCnt=2 colCnt=3, 셀 6개, cellAddr가 격자를 빠짐없이 덮는다', () => {
  const x = tableXml({ rows: [[cell('a'), cell('b'), cell('c')], [cell('d'), cell('e'), cell('f')]], colWidths: [1000, 2000, 3000], rowHeights: [500, 600] })
  expect(xmlErrors(wrap(x))).toEqual([])
  expect(x).toMatch(/rowCnt="2" colCnt="3"/)
  expect(x).toContain('<hp:sz width="6000" widthRelTo="ABSOLUTE" height="1100"')
  const addrs = [...x.matchAll(/colAddr="(\d+)" rowAddr="(\d+)"/g)].map((m) => `${m[2]},${m[1]}`).sort()
  expect(addrs).toEqual(['0,0', '0,1', '0,2', '1,0', '1,1', '1,2'])
  expect(x).toContain('repeatHeader="1"')
  expect(x).toContain('pageBreak="CELL"')
})

test('colSpan 셀은 cellSpan colSpan=2, cellSz width가 두 열 합', () => {
  const x = tableXml({ rows: [[cell('제목', { colSpan: 2 })], [cell('a'), cell('b')]], colWidths: [1000, 2500], rowHeights: [500, 500] })
  expect(x).toContain('<hp:cellSpan colSpan="2" rowSpan="1"/><hp:cellSz width="3500" height="500"/>')
  expect(xmlErrors(wrap(x))).toEqual([])
})

test('특수문자 이름이 든 표도 XML 파싱 오류가 없다', () => {
  const x = tableXml({ rows: [[cell('김&<이>"')]], colWidths: [1000], rowHeights: [500] })
  expect(xmlErrors(wrap(x))).toEqual([])
  const doc = new DOMParser().parseFromString(wrap(x), 'text/xml')
  expect(doc.getElementsByTagName('hp:t')[0].textContent).toBe('김&<이>"')
})

test('paragraphXml의 줄바꿈은 lineBreak', () => {
  const x = paragraphXml('첫줄\n둘째', { charPr: 12 })
  expect(x).toContain('<hp:t>첫줄<hp:lineBreak/>둘째</hp:t>')
  expect(x).toContain('paraPrIDRef="13"')
  expect(x).toContain('charPrIDRef="12"')
  expect(xmlErrors(wrap(x))).toEqual([])
})

test('표와 문단의 id는 매번 달라진다', () => {
  const a = tableXml({ rows: [[cell('a')]], colWidths: [1], rowHeights: [1] })
  const b = tableXml({ rows: [[cell('a')]], colWidths: [1], rowHeights: [1] })
  expect(a.match(/<hp:tbl id="(\d+)"/)![1]).not.toBe(b.match(/<hp:tbl id="(\d+)"/)![1])
})

test('표는 쪽을 넘어 나뉠 수 있게 글자처럼 취급하지 않는다', () => {
  const x = tableXml({ rows: [[cell('a')], [cell('b')]], colWidths: [1000], rowHeights: [500, 500] })
  expect(x).toContain('treatAsChar="0"')
  expect(x).toContain('textWrap="TOP_AND_BOTTOM"')
})

test('header="1"은 첫 행 셀에만 붙는다', () => {
  const x = tableXml({ rows: [[cell('h1'), cell('h2')], [cell('a'), cell('b')], [cell('c'), cell('d')]], colWidths: [1, 1], rowHeights: [1, 1, 1] })
  expect(x.match(/header="1"/g)).toHaveLength(2)
})

test('XML에 쓸 수 없는 제어 문자는 지운다', () => {
  expect(escapeXml('a\u000Bb\u0001c\u001F')).toBe('abc')
  expect(xmlErrors(wrap(tableXml({ rows: [[cell('김\u000B이\u0000')]], colWidths: [1], rowHeights: [1] })))).toEqual([])
})
