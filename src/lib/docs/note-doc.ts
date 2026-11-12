/** 노트 → 한글(hwpx): 문단·글자 서식(굵게·기울임·밑줄·취소선·색·형광펜·글꼴·크기)·들여쓰기·목록 기호·체크·학생 표를 한글 구조 그대로. */
import type { NoteBlock, NoteRec } from '../db/types'
import { buildHwpx, BASE_CHARPR_COUNT, BASE_HEADER_XML } from '../hwpx/package'
import { escapeXml } from '../hwpx/xml'
import { tableXml, PARA_CENTER, PARA_JUSTIFY } from '../hwpx/xml'
import { outlineMarks } from '../notes/blocks'
import { tableWidths } from '../notes/tableOps'
import { imageExt, imageMime, imageSize } from '../notes/images'
import { fillHeaderFooter, MARGINS } from '../notes/paginate'
import { toYmd } from '../schoolDays'
import { ptOf, segments, type Style } from '../notes/marks'
import { A4_PORTRAIT_BODY_WIDTH } from './roster-doc'
import { tableColWidths } from './table-doc'

const BASE_PT = 10
/** 기본 양식 HANGUL 글꼴 목록(id 순) */
const BASE_FONTS = [...(BASE_HEADER_XML.match(/<hh:fontface lang="HANGUL"[\s\S]*?<\/hh:fontface>/)?.[0] ?? '').matchAll(/face="([^"]+)"/g)].map((m) => m[1])
const MALGUN = Math.max(0, BASE_FONTS.indexOf('맑은 고딕'))
const BASE_CP = (BASE_HEADER_XML.match(/<hh:charPr id="6"[\s\S]*?<\/hh:charPr>/)?.[0] ?? '').replace(/<hh:bold\/>/g, '').replace(/<hh:italic\/>/g, '')
const BASE_PARA = BASE_HEADER_XML.match(/<hh:paraPr id="13"[\s\S]*?<\/hh:paraPr>/)?.[0] ?? ''
const PARA_COUNT = Number(/<hh:paraProperties itemCnt="(\d+)"/.exec(BASE_HEADER_XML)?.[1] ?? 16)

interface CpSpec extends Style {
  pt: number
}

/** 글꼴·글자 모양·문단 모양을 모아 header에 덧붙인다 */
class Registry {
  fonts: string[] = []
  cps: CpSpec[] = []
  paras: string[] = []
  font(name?: string): number {
    if (!name) return MALGUN
    const i = BASE_FONTS.indexOf(name)
    if (i >= 0) return i
    let j = this.fonts.indexOf(name)
    if (j < 0) j = this.fonts.push(name) - 1
    return BASE_FONTS.length + j
  }
  cp(s: CpSpec): number {
    const key = (x: CpSpec) => JSON.stringify([x.pt, !!x.b, !!x.i, !!x.u, !!x.s, x.color ?? '', x.bg ?? '', x.font ?? ''])
    let i = this.cps.findIndex((x) => key(x) === key(s))
    if (i < 0) i = this.cps.push(s) - 1
    this.font(s.font)
    return BASE_CHARPR_COUNT + i
  }
  /** 왼쪽 여백(pt)·정렬·줄 간격별 문단 모양 */
  para(leftPt: number, align: NoteBlock['align'] = 'justify', line = 160): number {
    if (!leftPt && align === 'justify' && line === 160) return PARA_JUSTIFY
    const key = `${leftPt}|${align}|${line}`
    let i = this.paras.indexOf(key)
    if (i < 0) i = this.paras.push(key) - 1
    return PARA_COUNT + i
  }
  charPrXml(): string[] {
    return this.cps.map((s, i) => {
      const f = this.font(s.font)
      let x = BASE_CP.replace(/<hh:charPr id="6" height="\d+" textColor="[^"]*" shadeColor="[^"]*"/, `<hh:charPr id="${BASE_CHARPR_COUNT + i}" height="${Math.round(s.pt * 100)}" textColor="${s.color ?? '#000000'}" shadeColor="${s.bg ?? 'none'}"`)
      x = x.replace(/<hh:fontRef [^>]*\/>/, `<hh:fontRef hangul="${f}" latin="${f}" hanja="${f}" japanese="${f}" other="${f}" symbol="${f}" user="${f}"/>`)
      x = x.replace(/(<hh:offset [^>]*\/>)/, `$1${s.i ? '<hh:italic/>' : ''}${s.b ? '<hh:bold/>' : ''}`)
      if (s.u) x = x.replace(/<hh:underline [^>]*\/>/, '<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>')
      if (s.s) x = x.replace(/<hh:strikeout [^>]*\/>/, '<hh:strikeout shape="SOLID" color="#000000"/>')
      return x
    })
  }
  header(): string {
    let h = BASE_HEADER_XML
    if (this.fonts.length) {
      h = h.replace(/<hh:fontface lang="([A-Z]+)" fontCnt="(\d+)">([\s\S]*?)<\/hh:fontface>/g, (_m, lang: string, cnt: string, body: string) => {
        const add = this.fonts.map((name, k) => `<hh:font id="${Number(cnt) + k}" face="${escapeXml(name)}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="${/바탕|궁서/.test(name) ? 'FCAT_MYUNGJO' : 'FCAT_GOTHIC'}" weight="5" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`)
        return `<hh:fontface lang="${lang}" fontCnt="${Number(cnt) + this.fonts.length}">${body}${add.join('')}</hh:fontface>`
      })
    }
    if (this.paras.length) {
      const add = this.paras.map((key, k) => {
        const [left, align, line] = key.split('|')
        const v = Math.round(Number(left) * 100)
        return BASE_PARA.replace(/<hh:paraPr id="13"/, `<hh:paraPr id="${PARA_COUNT + k}"`)
          .replace(/<hh:align horizontal="[A-Z]+"/, `<hh:align horizontal="${align.toUpperCase()}"`)
          .replace(/<hh:lineSpacing type="PERCENT" value="160"/g, `<hh:lineSpacing type="PERCENT" value="${line}"`)
          .replace(/(<hp:case[\s\S]*?)<hc:left value="0"/, `$1<hc:left value="${v}"`)
          .replace(/(<hp:default[\s\S]*?)<hc:left value="0"/, `$1<hc:left value="${v * 2}"`)
      })
      h = h.replace(/<hh:paraProperties itemCnt="\d+"/, `<hh:paraProperties itemCnt="${PARA_COUNT + this.paras.length}"`).replace('</hh:paraProperties>', add.join('') + '</hh:paraProperties>')
    }
    return h
  }
}

const tx = (t: string) => `<hp:t>${t.split('\n').map(escapeXml).join('<hp:lineBreak/>')}</hp:t>`

function runs(reg: Registry, text: string, b: NoteBlock, pt: number, base: Style = {}): string {
  const segs = segments(text, b.marks, b.links)
  if (!segs.length) return `<hp:run charPrIDRef="${reg.cp({ pt, ...base })}"/>`
  return segs.map((s) => {
    const { size: _s, pt: _p, ...look } = s.style
    void _s
    void _p
    return `<hp:run charPrIDRef="${reg.cp({ ...base, ...look, pt: ptOf(s.style, pt) })}">${tx(s.text)}</hp:run>`
  }).join('')
}
const para = (paraPr: number, inner: string, pageBreak = false) => `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${inner}</hp:p>`

let picSeq = 0
/** 글자처럼 놓인 그림(hp:pic). w·h는 HWPUNIT */
function picXml(binId: string, w: number, h: number): string {
  const id = 1_500_000_000 + ++picSeq
  return (
    `<hp:pic id="${id}" zOrder="${picSeq}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0">` +
    `<hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/>` +
    `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
    `<hc:img binaryItemIDRef="${binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${w}" dimheight="${h}"/><hp:effects/>` +
    `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`
  )
}

/** images: 그림 블록 file_id → 그림 바이트 */
export async function buildNoteHwpx(note: Pick<NoteRec, 'title' | 'blocks' | 'page'>, files: Map<string, string> = new Map(), now?: Date, images: Map<string, Uint8Array> = new Map()): Promise<Uint8Array> {
  const bins: { id: string; ext: string; mime: string; bytes: Uint8Array }[] = []
  const reg = new Registry()
  const marks = outlineMarks(note.blocks)
  const body: string[] = []
  if (note.title) body.push(para(PARA_JUSTIFY, `<hp:run charPrIDRef="${reg.cp({ pt: 18, b: true })}">${tx(note.title)}</hp:run>`))
  // 쪽 나누기 블록 다음 문단은 새 쪽에서 시작한다
  let breakNext = false
  const push = (x: string) => {
    body.push(breakNext ? x.replace('pageBreak="0"', 'pageBreak="1"') : x)
    breakNext = false
  }
  note.blocks.forEach((b, i) => {
    if (b.type === 'pagebreak') {
      breakNext = true
      return
    }
    const ind = b.indent ?? 0
    const text = b.text ?? ''
    const P = (left: number) => reg.para(left, b.align, b.line)
    const lead = (s: string) => `<hp:run charPrIDRef="${reg.cp({ pt: BASE_PT })}">${tx(s + ' ')}</hp:run>`
    switch (b.type) {
      case 'h1':
        return push(para(P(ind * 20), runs(reg, text, b, 16, { b: true })))
      case 'h2':
        return push(para(P(ind * 20), runs(reg, text, b, 13, { b: true })))
      case 'bullet':
      case 'number':
        return push(para(P((ind + 1) * 20), lead(marks[i]) + runs(reg, text, b, BASE_PT)))
      case 'check':
        return push(para(P(ind * 20), lead(b.checked ? '☑' : '☐') + runs(reg, text, b, BASE_PT, b.checked ? { s: true } : {})))
      case 'divider':
        return push(para(PARA_JUSTIFY, `<hp:run charPrIDRef="${reg.cp({ pt: BASE_PT, color: '#888888' })}">${tx('―'.repeat(30))}</hp:run>`))
      case 'file':
        return push(para(P(ind * 20), lead(`[첨부] ${files.get(b.file_id ?? '') ?? '파일'}`)))
      case 'folder':
        return push(para(P(ind * 20), lead(`[폴더] ${b.path ?? ''}`)))
      case 'table': {
        const cp = reg.cp({ pt: BASE_PT })
        const cpHead = reg.cp({ pt: BASE_PT, b: true })
        const cells = b.cells ?? []
        if (!cells.length) return
        const total = A4_PORTRAIT_BODY_WIDTH
        return push(
          tableXml({
            rows: cells.map((row, r) => row.map((t) => ({ text: t, charPr: b.head && r === 0 ? cpHead : cp }))),
            colWidths: tableColWidths(tableWidths(b), total),
            rowHeights: cells.map(() => 1700),
            repeatHeader: !!b.head,
          }),
        )
      }
      case 'image': {
        const bytes = images.get(b.file_id ?? '')
        const mime = bytes && imageMime(bytes)
        const sz = bytes && imageSize(bytes)
        if (!bytes || !mime || !sz) return push(para(P(0), lead('[그림]')))
        const id = `image${bins.length + 1}`
        bins.push({ id, ext: imageExt(mime), mime, bytes })
        const w = Math.round((A4_PORTRAIT_BODY_WIDTH * Math.max(10, Math.min(100, b.width ?? 100))) / 100)
        const h = Math.round((w * sz.h) / sz.w)
        const center = reg.para(0, b.align ?? 'center')
        push(para(center, `<hp:run charPrIDRef="${reg.cp({ pt: BASE_PT })}">${picXml(id, w, h)}<hp:t/></hp:run>`))
        if (b.caption) push(para(center, `<hp:run charPrIDRef="${reg.cp({ pt: 9, color: '#555555' })}">${tx(b.caption)}</hp:run>`))
        return
      }
      case 'roster': {
        if (text) push(para(PARA_JUSTIFY, `<hp:run charPrIDRef="${reg.cp({ pt: BASE_PT, b: true })}">${tx(text)}</hp:run>`))
        const cp = reg.cp({ pt: BASE_PT })
        const rows = b.rows ?? []
        if (rows.length)
          push(
            tableXml({
              rows: rows.map((r) => [{ text: r.label, charPr: cp }, { text: r.checked ? '✔' : '', charPr: cp }]),
              colWidths: tableColWidths([5, 1], Math.round(A4_PORTRAIT_BODY_WIDTH * 0.5)),
              rowHeights: rows.map(() => 1700),
            }),
          )
        return
      }
      default:
        return push(para(P(ind * 20), runs(reg, text, b, BASE_PT)))
    }
  })
  if (breakNext) body.push(para(PARA_JUSTIFY, '<hp:run charPrIDRef="0"/>', true))
  const previewText = [note.title, ...note.blocks.map((b) => b.text ?? '')].join('\n').slice(0, 2000)
  return buildHwpx({ landscape: false, bodyXml: body.join(''), charPrXml: reg.charPrXml(), previewText, title: note.title || '노트', headerXml: reg.header(), bins, ...pageSetup(note.page, reg, now) }, now)
}

const MM = 283.465
/** 쪽 여백·머리말·꼬리말: secPr 여백을 바꾸고, 첫 문단에 머리말·꼬리말 컨트롤을 넣는다 */
function pageSetup(page: NoteRec['page'], reg: Registry, now?: Date): { secPr?: (x: string) => string; firstRunExtra?: string } {
  if (!page) return {}
  const m = MARGINS[page.margin] ?? MARGINS.normal
  const u = (mm: number) => Math.round(mm * MM)
  const secPr = (x: string) => x.replace(/<hp:margin [^>]*\/>/, `<hp:margin header="${u(Math.min(10, m.top / 2))}" footer="${u(Math.min(10, m.bottom / 2))}" gutter="0" left="${u(m.left)}" right="${u(m.right)}" top="${u(m.top)}" bottom="${u(m.bottom)}"/>`)
  const today = toYmd(now ?? new Date())
  const cp = reg.cp({ pt: 9, color: '#555555' })
  const width = u(210 - m.left - m.right)
  /** 글 + {쪽}·{전체쪽}은 쪽 번호 컨트롤로 */
  const runs = (t: string) =>
    t
      .split(/(\{쪽\})/)
      .filter(Boolean)
      .map((part) =>
        part === '{쪽}'
          ? `<hp:run charPrIDRef="${cp}"><hp:ctrl><hp:autoNum num="1" numType="PAGE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl></hp:run>`
          : // {전체쪽}은 편집기 쪽 보기에서 센 쪽 수(한글 TOTAL_PAGE는 읽지 못하는 프로그램이 있어 글로)
            `<hp:run charPrIDRef="${cp}">${tx(fillHeaderFooter(part, 1, page.pages ?? 1, today))}</hp:run>`,
      )
      .join('')
  const box = (tag: 'header' | 'footer', id: number, t: string) =>
    `<hp:ctrl><hp:${tag} id="${id}" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${tag === 'header' ? 'TOP' : 'BOTTOM'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="${width}" textHeight="${u(8)}" hasTextRef="0" hasNumRef="0"><hp:p id="0" paraPrIDRef="${PARA_CENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runs(t)}</hp:p></hp:subList></hp:${tag}></hp:ctrl>`
  const extra = [page.header?.trim() ? box('header', 1, page.header) : '', page.footer?.trim() ? box('footer', 2, page.footer) : ''].join('')
  return { secPr, firstRunExtra: extra || undefined }
}
