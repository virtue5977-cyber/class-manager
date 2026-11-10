// @vitest-environment node
import JSZip from 'jszip'
import { buildTableHwpx } from '../../docs/table-doc'
import { inspectTemplate } from './template'
import { markTemplate, matchByAi, matchByRules, scanCells } from './scan'

/** 2×4 표: 성 명|빈|기 간|빈 / 사 유|위 학생은 결석하였기에|작성일|빈 */
async function form() {
  return buildTableHwpx({ title: '결석계', header: ['성 명', '', '기 간', ''], rows: [['사 유', '위 학생은 결석하였기에', '작성일', '']] })
}
async function section(bytes: Uint8Array) {
  return (await JSZip.loadAsync(bytes)).file('Contents/section0.xml')!.async('string')
}

test('scanCells: 칸마다 줄·열과 글', async () => {
  const cells = scanCells(await section(await form()))
  expect(cells).toHaveLength(8)
  expect(cells[0]).toMatchObject({ id: 0, row: 0, col: 0, text: '성 명' })
  expect(cells[5]).toMatchObject({ row: 1, col: 1, text: '위 학생은 결석하였기에' })
  expect(cells[7]).toMatchObject({ row: 1, col: 3, text: '' })
})

test('matchByRules: 이름표 오른쪽 빈 칸, 글이 있으면 건너뜀', async () => {
  const slots = matchByRules(scanCells(await section(await form())))
  expect(slots).toEqual(expect.arrayContaining([
    { field: '이름', label: 0, target: 1 },
    { field: '기간', label: 2, target: 3 },
    { field: '작성날짜', label: 6, target: 7 },
  ]))
  expect(slots.some((s) => s.field === '사유')).toBe(false)
})

test('matchByAi: 못 찾은 자리만 묻고, 잘못된 답·글 있는 칸은 버린다. 칸 글만 보낸다', async () => {
  const cells = scanCells(await section(await form()))
  const have = matchByRules(cells)
  const sent: string[] = []
  const ai = async (req: { messages: { content: string }[] }) => {
    sent.push(JSON.stringify(req))
    return JSON.stringify({ pairs: [{ field: '사유', label: 4 }, { field: '없는칸', label: 0 }, { field: '일수', label: 99 }] })
  }
  const more = await matchByAi(cells, have, ai as never)
  expect(more).toEqual([])
  expect(sent[0]).toContain('성 명')
  expect(sent[0]).not.toContain('"이름"') // 이미 찾은 자리는 묻지 않는다
  expect(sent[0]).toContain('사유')
})

test('markTemplate: 빈 칸에 {{표시}}, 글 있는 칸은 그대로 → 양식 검사 통과', async () => {
  const bytes = await form()
  const cells = scanCells(await section(bytes))
  const marked = await markTemplate(bytes, matchByRules(cells))
  const r = await inspectTemplate(marked)
  expect(r.ok).toBe(true)
  expect(r.found).toEqual(expect.arrayContaining(['이름', '기간', '작성날짜']))
  expect(scanCells(await section(marked))[5].text).toBe('위 학생은 결석하였기에')
  expect(scanCells(await section(marked))[1].text).toBe('{{이름}}')
})

/** 표 XML 직접 만들기(겹친 표·두 표·그림 칸 시험용) */
const tc = (r: number, c: number, inner: string) =>
  `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="3"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0"><hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p></hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="1000" height="500"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>`
const t = (s: string) => `<hp:run charPrIDRef="0"><hp:t>${s}</hp:t></hp:run>`
const tbl = (rows: string[][]) => `<hp:run charPrIDRef="0"><hp:tbl id="1" rowCnt="${rows.length}" colCnt="${rows[0].length}">${rows.map((r) => `<hp:tr>${r.join('')}</hp:tr>`).join('')}</hp:tbl></hp:run>`
async function hwpxWith(body: string) {
  const bytes = await form()
  const z = await JSZip.loadAsync(bytes)
  const sec = await z.file('Contents/section0.xml')!.async('string')
  const out = sec.replace(/(<hs:sec\b[^>]*>)[\s\S]*(<\/hs:sec>)/, (_m, a: string, b: string) => `${a}<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${body}</hp:p>${b}`)
  z.file('Contents/section0.xml', out)
  return z.generateAsync({ type: 'uint8array' })
}

test('겹친 표(바깥 상자 안의 표)도 첫 칸까지 읽는다', async () => {
  const inner = tbl([[tc(0, 0, t('성명')), tc(0, 1, '')], [tc(1, 0, t('기간')), tc(1, 1, '')]])
  const bytes = await hwpxWith(tbl([[tc(0, 0, inner)]]))
  const cells = scanCells(await section(bytes))
  expect(cells.map((c) => c.text)).toEqual(['성명', '', '기간', ''])
  const slots = matchByRules(cells)
  expect(slots.map((s) => s.field).sort()).toEqual(['기간', '이름'])
  const marked = await markTemplate(bytes, slots)
  const { xmlErrors } = await import('../testUtil')
  expect(xmlErrors(await section(marked))).toEqual([])
  expect(scanCells(await section(marked)).map((c) => c.text)).toEqual(['성명', '{{이름}}', '기간', '{{기간}}'])
})

test('다른 표(결재란)의 같은 줄·열 빈 칸으로 가지 않는다', async () => {
  const sign = tbl([[tc(0, 0, t('담임')), tc(0, 1, t('교감'))], [tc(1, 0, ''), tc(1, 1, '')]])
  const main = tbl([[tc(0, 0, t('학년')), tc(0, 1, t('1'))], [tc(1, 0, t('성명')), tc(1, 1, '')]])
  const cells = scanCells(await section(await hwpxWith(sign + main)))
  const s = matchByRules(cells).find((x) => x.field === '이름')!
  expect(cells[s.target].table).toBe(cells[s.label].table)
  expect(s.target).toBe(7)
})

test('그림·누름틀만 있는 칸은 빈 칸이 아니다(지우지 않음)', async () => {
  const pic = '<hp:run charPrIDRef="0"><hp:pic id="9"><hp:sz width="10" height="10"/></hp:pic></hp:run>'
  const cells = scanCells(await section(await hwpxWith(tbl([[tc(0, 0, t('성명')), tc(0, 1, pic)]]))))
  expect(cells[1].filled).toBe(true)
  expect(matchByRules(cells)).toEqual([])
})
