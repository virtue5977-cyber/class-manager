import JSZip from 'jszip'
import { escapeXml } from '../hwpx/xml'

function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** 문자열 셀만 있는 시트 하나짜리 xlsx. */
export async function writeSimpleXlsx(sheetName: string, rows: string[][]): Promise<Uint8Array> {
  const sheetRows = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`).join('')}</row>`)
    .join('')
  const zip = new JSZip()
  const add = (n: string, b: string) => zip.file(n, b, { createFolders: false })
  add('[Content_Types].xml', `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  add('_rels/.rels', `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  add('xl/workbook.xml', `${DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  add('xl/_rels/workbook.xml.rels', `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  add('xl/worksheets/sheet1.xml', `${DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
