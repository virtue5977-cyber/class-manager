// @vitest-environment node
import { readFirstSheet } from './read'
import { writeSimpleXlsx } from './simple'
import JSZip from 'jszip'

test('직접 만든 xlsx(inlineStr)를 다시 읽는다', async () => {
  const bytes = await writeSimpleXlsx('명렬표', [['번호', '이름'], ['1', '가&나'], ['2', '다']])
  expect(await readFirstSheet(bytes)).toEqual([['번호', '이름'], ['1', '가&나'], ['2', '다']])
})

test('공유 문자열·숫자·빈 칸 건너뛴 셀 주소', async () => {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/sharedStrings.xml', '<sst><si><t>학년</t></si><si><r><t>성</t></r><r><t>명</t></r></si></sst>')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="B3"><v>5</v></c></row></sheetData></worksheet>')
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  expect(await readFirstSheet(bytes)).toEqual([['학년', '', '성명'], [], ['', '5']])
})

test('xlsx가 아니면 안내', async () => {
  await expect(readFirstSheet(new Uint8Array([1, 2, 3]))).rejects.toThrow('.xlsx')
})

test('셀 주소가 터무니없이 크면 그 줄·칸은 버린다(메모리 보호)', async () => {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>번호</t></is></c><c r="XFD1" t="inlineStr"><is><t>멀리</t></is></c></row><row r="1048576"><c r="A1048576"><v>9</v></c></row></sheetData></worksheet>')
  const out = await readFirstSheet(await zip.generateAsync({ type: 'uint8array' }))
  expect(out).toEqual([['번호']])
})
