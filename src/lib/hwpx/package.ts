import { escapeXml } from './xml'
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
  /** 글꼴·문단 모양을 더한 header(없으면 기본 양식) */
  headerXml?: string
  /** 그림 등 BinData(id는 hp:pic의 binaryItemIDRef) */
  bins?: { id: string; ext: string; mime: string; bytes: Uint8Array }[]
  /** secPr 바꾸기(여백 등) */
  secPr?: (xml: string) => string
  /** 첫 문단 secPr 뒤에 넣을 것(머리말·꼬리말 컨트롤 등) */
  firstRunExtra?: string
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'

const esc = escapeXml

function sectionXml(doc: HwpxDoc): string {
  let secPr = secPrXml.replace(/landscape="[A-Z]+"/, `landscape="${doc.landscape ? 'NARROWLY' : 'WIDELY'}"`)
  if (doc.secPr) secPr = doc.secPr(secPr)
  return (
    XML_DECL +
    sectionOpen +
    '<hp:p id="0" paraPrIDRef="13" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">' +
    secPr +
    '</hp:run>' +
    (doc.firstRunExtra ? `<hp:run charPrIDRef="0">${doc.firstRunExtra}</hp:run>` : '') +
    '</hp:p>' +
    doc.bodyXml +
    '</hs:sec>'
  )
}

function headerWith(charPrXml: string[], base = headerXml): string {
  if (!charPrXml.length) return base
  return base
    .replace(/<hh:charProperties itemCnt="\d+"/, `<hh:charProperties itemCnt="${BASE_CHARPR_COUNT + charPrXml.length}"`)
    .replace('</hh:charProperties>', charPrXml.join('') + '</hh:charProperties>')
}

export async function buildHwpx(doc: HwpxDoc, now: Date = new Date()): Promise<Uint8Array> {
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const bins = doc.bins ?? []
  const hpf = contentHpf
    .replace(/\{\{DATE\}\}/g, date)
    .replace('{{TITLE}}', esc(doc.title))
    .replace('</opf:manifest>', bins.map((b) => `<opf:item id="${b.id}" href="BinData/${b.id}.${b.ext}" media-type="${b.mime}" isEmbeded="1"/>`).join('') + '</opf:manifest>')
  const zip = new JSZip()
  const add = (name: string, body: string) => zip.file(name, body, { createFolders: false })
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE', createFolders: false })
  add('version.xml', versionXml)
  add('Contents/header.xml', headerWith(doc.charPrXml, doc.headerXml))
  add('Contents/section0.xml', sectionXml(doc))
  add('Preview/PrvText.txt', doc.previewText)
  add('settings.xml', settingsXml)
  add('META-INF/container.rdf', containerRdf)
  add('Contents/content.hpf', hpf)
  add('META-INF/container.xml', containerXml)
  add('META-INF/manifest.xml', manifestXml)
  for (const b of bins) zip.file(`BinData/${b.id}.${b.ext}`, b.bytes, { createFolders: false, compression: 'STORE' })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
