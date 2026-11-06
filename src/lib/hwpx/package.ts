import JSZip from 'jszip'
import versionXml from './base/version.xml?raw'
import headerXml from './base/header.xml?raw'
import settingsXml from './base/settings.xml?raw'
import contentHpf from './base/content.hpf?raw'
import containerXml from './base/container.xml?raw'
import containerRdf from './base/container.rdf?raw'
import manifestXml from './base/manifest.xml?raw'
import sectionOpen from './base/section-open.xml?raw'
import secPrXml from './base/secPr.xml?raw'

/** 기본 양식 header.xml의 charPr 개수. 새 charPr id는 여기서부터. */
export const BASE_CHARPR_COUNT = 12
export const BASE_HEADER_XML = headerXml

export interface HwpxDoc {
  landscape: boolean
  /** secPr 문단 뒤에 이어질 hp:p 문단들 */
  bodyXml: string
  /** header에 덧붙일 hh:charPr 요소들(id는 BASE_CHARPR_COUNT부터 연속) */
  charPrXml: string[]
  previewText: string
  title: string
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function sectionXml(doc: HwpxDoc): string {
  const secPr = secPrXml.replace(/landscape="[A-Z]+"/, `landscape="${doc.landscape ? 'NARROWLY' : 'WIDELY'}"`)
  return (
    XML_DECL +
    sectionOpen +
    '<hp:p id="0" paraPrIDRef="13" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">' +
    secPr +
    '</hp:run></hp:p>' +
    doc.bodyXml +
    '</hs:sec>'
  )
}

function headerWith(charPrXml: string[]): string {
  if (!charPrXml.length) return headerXml
  return headerXml
    .replace(/<hh:charProperties itemCnt="\d+"/, `<hh:charProperties itemCnt="${BASE_CHARPR_COUNT + charPrXml.length}"`)
    .replace('</hh:charProperties>', charPrXml.join('') + '</hh:charProperties>')
}

export async function buildHwpx(doc: HwpxDoc, now: Date = new Date()): Promise<Uint8Array> {
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const hpf = contentHpf.replace(/\{\{DATE\}\}/g, date).replace('{{TITLE}}', esc(doc.title))
  const zip = new JSZip()
  const add = (name: string, body: string) => zip.file(name, body, { createFolders: false })
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE', createFolders: false })
  add('version.xml', versionXml)
  add('Contents/header.xml', headerWith(doc.charPrXml))
  add('Contents/section0.xml', sectionXml(doc))
  add('Preview/PrvText.txt', doc.previewText)
  add('settings.xml', settingsXml)
  add('META-INF/container.rdf', containerRdf)
  add('Contents/content.hpf', hpf)
  add('META-INF/container.xml', containerXml)
  add('META-INF/manifest.xml', manifestXml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
