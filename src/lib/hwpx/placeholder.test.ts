// @vitest-environment node
import { joinSplitPlaceholders, findPlaceholders, fillPlaceholders, repeatPages } from './placeholder'
import { xmlErrors } from './testUtil'

const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"'
const P = (inner: string, attrs = '') => `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"${attrs}>${inner}</hp:p>`
const R = (t: string, cp = 1) => `<hp:run charPrIDRef="${cp}"><hp:t>${t}</hp:t></hp:run>`
const SEC = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${NS}>${body}</hs:sec>`

test('같은 <hp:t> 안 표시는 그대로 찾는다', () => {
  expect(findPlaceholders(SEC(P(R('성명: {{이름}} / {{학번}} {{이름}}'))))).toEqual(['이름', '학번'])
})

test('두 run으로 쪼개진 {{이름}}을 합쳐 채운다', () => {
  const x = SEC(P(R('성명: {{이') + R('름}} 님', 2)))
  const joined = joinSplitPlaceholders(x)
  expect(findPlaceholders(joined)).toEqual(['이름'])
  const { xml } = fillPlaceholders(joined, { 이름: '홍길동' })
  expect(xml).toContain('성명: 홍길동 님')
  expect(xmlErrors(xml)).toEqual([])
})

test('세 조각 {{증빙_3일이상}}도 합친다', () => {
  const x = SEC(P(R('{{증') + R('빙_3일') + R('이상}}')))
  expect(findPlaceholders(joinSplitPlaceholders(x))).toEqual(['증빙_3일이상'])
})

test('표 안 문단의 쪼개진 표시도 합친다', () => {
  const tbl = `<hp:run charPrIDRef="1"><hp:tbl id="5"><hp:tr><hp:tc><hp:subList>${P(R('{{학') + R('번}}'))}</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run>`
  expect(findPlaceholders(joinSplitPlaceholders(SEC(P(tbl))))).toEqual(['학번'])
})

test('값의 & < >는 escape, 알 수 없는 표시는 빈칸과 unknown 목록', () => {
  const { xml, unknown } = fillPlaceholders(SEC(P(R('[{{이름}}][{{이룸}}]'))), { 이름: '김&<이>' })
  expect(xml).toContain('[김&amp;&lt;이&gt;][]')
  expect(unknown).toEqual(['이룸'])
})

test('repeatPages 3쪽: secPr 1개, pageBreak="1" 2개, 개체 id 중복 없음, XML 오류 0', () => {
  const first = P(`<hp:run charPrIDRef="0"><hp:secPr id=""><hp:pagePr landscape="WIDELY"/></hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER"/></hp:ctrl></hp:run><hp:run charPrIDRef="1"><hp:tbl id="100"><hp:tr><hp:tc><hp:subList>${P(R('{{이름}}'))}</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run>`)
  const sec = SEC(first + P(R('끝')))
  const out = repeatPages(sec, 3, (page, i) => fillPlaceholders(page, { 이름: `학생${i}` }).xml)
  expect(xmlErrors(out)).toEqual([])
  expect(out.match(/<hp:secPr /g)).toHaveLength(1)
  expect(out.match(/pageBreak="1"/g)).toHaveLength(2)
  const ids = [...out.matchAll(/<hp:tbl id="(\d+)"/g)].map((m) => m[1])
  expect(new Set(ids).size).toBe(3)
  expect(out).toContain('학생0')
  expect(out).toContain('학생2')
})

test('완성되지 않는 {{ 는 뒤 글자를 끌어오지 않고, 탭 너머로도 합치지 않는다', () => {
  const lit = '<hp:p><hp:run><hp:t>a {{ b</hp:t></hp:run><hp:run charPrIDRef="9"><hp:t>long text</hp:t></hp:run></hp:p>'
  expect(joinSplitPlaceholders(lit)).toBe(lit)
  const tab = '<hp:p><hp:run><hp:t>{{이</hp:t><hp:tab/></hp:run><hp:run charPrIDRef="2"><hp:t>름}}</hp:t></hp:run></hp:p>'
  expect(joinSplitPlaceholders(tab)).toBe(tab)
})

test('{ + {이름}} 처럼 중괄호 하나로 쪼개진 것도 합친다', () => {
  const x = '<hp:p><hp:run><hp:t>성명: {</hp:t></hp:run><hp:run><hp:t>{이름}} 님</hp:t></hp:run></hp:p>'
  expect(fillPlaceholders(joinSplitPlaceholders(x), { 이름: '홍' }).xml).toContain('성명: 홍 님')
})
