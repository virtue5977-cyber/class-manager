// @vitest-environment node
import JSZip from 'jszip'
import { writeSimpleXlsx } from './simple'
import { xmlErrors } from '../hwpx/testUtil'

test('xlsx는 sheet1에 셀 값이 들어 있고 zip 구조가 올바르다', async () => {
  const bytes = await writeSimpleXlsx('명렬표', [['번호', '이름'], ['1', '김&이']])
  const zip = await JSZip.loadAsync(bytes)
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
    const text = await zip.file(f)!.async('string')
    expect([f, xmlErrors(text)]).toEqual([f, []])
  }
  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t>김&amp;이</t></is></c>')
  expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('name="명렬표"')
})

test('27열 이상이면 열 이름이 AA', async () => {
  const row = Array.from({ length: 28 }, (_, i) => String(i))
  const sheet = await (await JSZip.loadAsync(await writeSimpleXlsx('s', [row]))).file('xl/worksheets/sheet1.xml')!.async('string')
  expect(sheet).toContain('r="AA1"')
  expect(sheet).toContain('r="AB1"')
})
