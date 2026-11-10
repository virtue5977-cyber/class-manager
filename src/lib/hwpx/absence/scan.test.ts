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
