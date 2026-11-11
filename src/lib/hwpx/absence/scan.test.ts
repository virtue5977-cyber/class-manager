// @vitest-environment node
import JSZip from 'jszip'
import { buildTableHwpx } from '../../docs/table-doc'
import { inspectTemplate } from './template'
import { findDateLines, markTemplate, matchByAi, matchByRules, scanCells } from './scan'

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

test('matchByAi: 채워진 양식이라 칸에 학생 이름이 있으면 가려서 보낸다', async () => {
  const bytes = await buildTableHwpx({ title: '결석계', header: ['성 명', '홍길동', '비고', ''], rows: [['사 유', '', '작성일', '']] })
  const cells = scanCells(await section(bytes))
  const sent: string[] = []
  await matchByAi(cells, [], (async (r: unknown) => (sent.push(JSON.stringify(r)), '{"pairs":[]}')) as never, ['홍길동'])
  expect(sent[0]).not.toContain('홍길동')
  expect(sent[0]).toContain('성 명')
})

/** 사용자 예시(11/11)와 같은 구조의 가상 양식: 채워진 예시 값, 쌍점·괄호 이름표, ◯ 표시 칸, 표 밖 날짜 줄 */
async function exampleForm() {
  const info = tbl([[tc(0, 0, t('학 번:')), tc(0, 1, t('9901'))], [tc(1, 0, t('이 름:')), tc(1, 1, t('가상일'))]])
  const period = tbl([[tc(0, 0, t('기  간')), tc(0, 1, t(' 2026년 11월 09일(월) ~ 11월 10일(화) (2일간)'))]])
  const kinds = tbl([
    [tc(0, 0, t('  질  병¹')), tc(0, 1, t('  인  정²')), tc(0, 2, t('  미 인 정³')), tc(0, 3, t('기  타'))],
    [tc(1, 0, t('◯')), tc(1, 1, ''), tc(1, 2, ''), tc(1, 3, '')],
    [tc(2, 0, t('결  석')), tc(2, 1, t('지  각')), tc(2, 2, t('조  퇴')), tc(2, 3, t('결  과'))],
    [tc(3, 0, t('◯')), tc(3, 1, ''), tc(3, 2, ''), tc(3, 3, '')],
  ])
  const reason = tbl([[tc(0, 0, t('사  유')), tc(0, 1, t('(학부모 의견)')), tc(0, 2, t('감기로 병원 진료'))]])
  const reason2 = tbl([[tc(0, 0, t('사  유(학부모 의견)')), tc(0, 1, t('감기로 병원 진료'))]])
  const date = `</hp:p><hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${t('2026년     11월     11일')}`
  return hwpxWith(info + period + kinds + reason2 + date + reason.slice(0, 0))
}

test('채워진 예시 양식: 쌍점·괄호 이름표를 알아보고, 예시 글이 든 칸을 값 칸으로', async () => {
  const cells = scanCells(await section(await exampleForm()))
  const slots = matchByRules(cells)
  const by = Object.fromEntries(slots.map((s) => [s.field, cells[s.target].text]))
  expect(by['학번']).toBe('9901')
  expect(by['이름']).toBe('가상일')
  expect(by['기간']).toContain('2026년 11월 09일')
  expect(by['사유']).toBe('감기로 병원 진료')
  // ◯ 표시 자리: 이름표 바로 아래 칸
  expect(by['표시_질병']).toBe('◯')
  expect(by['표시_인정']).toBe('')
  expect(by['표시_결석']).toBe('◯')
  expect(slots.some((s) => s.field === '표시_조퇴')).toBe(true)
})

test('채워진 예시 양식 → 예시 글을 지우고 {{표시}}로, 표 밖 날짜 줄은 {{작성날짜}}로, 양식 검사 통과', async () => {
  const bytes = await exampleForm()
  const sec = await section(bytes)
  const cells = scanCells(sec)
  expect(findDateLines(sec).map((d) => d.text)).toEqual(['2026년 11월 11일'])
  const marked = await markTemplate(bytes, matchByRules(cells), { dateLine: 0 })
  const out = await section(marked)
  const { xmlErrors } = await import('../testUtil')
  expect(xmlErrors(out)).toEqual([])
  const texts = scanCells(out).map((c) => c.text)
  expect(texts).toEqual(expect.arrayContaining(['{{학번}}', '{{이름}}', '{{기간}}', '{{사유}}', '{{표시_질병}}', '{{표시_결석}}']))
  expect(out).not.toContain('가상일')
  expect(out).not.toContain('9901')
  expect(out).toContain('{{작성날짜}}')
  const r = await inspectTemplate(marked)
  expect(r.ok).toBe(true)
  expect(r.unknown).toEqual([])
})

test('AI에는 이름표 옆 값 칸의 글을 [값]으로 바꿔 보낸다(명단에 없는 이름도 안 나간다)', async () => {
  const cells = scanCells(await section(await exampleForm()))
  const sent: string[] = []
  await matchByAi(cells, [], (async (r: unknown) => (sent.push(JSON.stringify(r)), '{"pairs":[]}')) as never, [])
  expect(sent[0]).not.toContain('가상일')
  expect(sent[0]).not.toContain('9901')
  expect(sent[0]).toContain('[값]')
  expect(sent[0]).toContain('이 름:')
})

test('양식 전체가 큰 상자(표) 안에 있어도 그 안의 날짜 글줄을 찾는다', async () => {
  const inner = tbl([[tc(0, 0, t('성명')), tc(0, 1, '')]])
  const boxCell = `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="3"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0"><hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p><hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${t('2026년     11월     11일')}</hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="1000" height="500"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc>`
  const sec = await section(await hwpxWith(tbl([[boxCell]])))
  expect(findDateLines(sec).map((d) => d.text)).toEqual(['2026년 11월 11일'])
})
