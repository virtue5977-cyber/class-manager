/** 노트 → 한글(hwpx): 문단·글자 서식(굵게·기울임·밑줄·취소선·색·형광펜·글꼴·크기)·들여쓰기·목록 기호·체크·학생 표를 한글 구조 그대로. */
import type { NoteBlock, NoteRec } from '../db/types'
import { buildHwpx, BASE_CHARPR_COUNT, BASE_HEADER_XML } from '../hwpx/package'
import { escapeXml } from '../hwpx/xml'
import { tableXml, PARA_JUSTIFY } from '../hwpx/xml'
import { outlineMarks } from '../notes/blocks'
import { segments, type Style } from '../notes/marks'
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
  paras: number[] = []
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
  /** 왼쪽 여백(pt)별 문단 모양(줄 간격 160%) */
  para(leftPt: number): number {
    if (!leftPt) return PARA_JUSTIFY
    let i = this.paras.indexOf(leftPt)
    if (i < 0) i = this.paras.push(leftPt) - 1
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
      const add = this.paras.map((pt, k) => {
        const v = Math.round(pt * 100)
        return BASE_PARA.replace(/<hh:paraPr id="13"/, `<hh:paraPr id="${PARA_COUNT + k}"`)
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
  return segs.map((s) => `<hp:run charPrIDRef="${reg.cp({ ...base, ...s.style, pt: s.style.size ? pt * (s.style.size === 'sm' ? 0.85 : 1.25) : pt })}">${tx(s.text)}</hp:run>`).join('')
}
const para = (paraPr: number, inner: string) => `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p>`

export async function buildNoteHwpx(note: Pick<NoteRec, 'title' | 'blocks'>, files: Map<string, string> = new Map(), now?: Date): Promise<Uint8Array> {
  const reg = new Registry()
  const marks = outlineMarks(note.blocks)
  const body: string[] = []
  if (note.title) body.push(para(PARA_JUSTIFY, `<hp:run charPrIDRef="${reg.cp({ pt: 18, b: true })}">${tx(note.title)}</hp:run>`))
  note.blocks.forEach((b, i) => {
    const ind = b.indent ?? 0
    const text = b.text ?? ''
    const lead = (s: string) => `<hp:run charPrIDRef="${reg.cp({ pt: BASE_PT })}">${tx(s + ' ')}</hp:run>`
    switch (b.type) {
      case 'h1':
        return body.push(para(reg.para(ind * 20), runs(reg, text, b, 16, { b: true })))
      case 'h2':
        return body.push(para(reg.para(ind * 20), runs(reg, text, b, 13, { b: true })))
      case 'bullet':
      case 'number':
        return body.push(para(reg.para((ind + 1) * 20), lead(marks[i]) + runs(reg, text, b, BASE_PT)))
      case 'check':
        return body.push(para(reg.para(ind * 20), lead(b.checked ? '☑' : '☐') + runs(reg, text, b, BASE_PT, b.checked ? { s: true } : {})))
      case 'divider':
        return body.push(para(PARA_JUSTIFY, `<hp:run charPrIDRef="${reg.cp({ pt: BASE_PT, color: '#888888' })}">${tx('―'.repeat(30))}</hp:run>`))
      case 'file':
        return body.push(para(reg.para(ind * 20), lead(`[첨부] ${files.get(b.file_id ?? '') ?? '파일'}`)))
      case 'folder':
        return body.push(para(reg.para(ind * 20), lead(`[폴더] ${b.path ?? ''}`)))
      case 'roster': {
        if (text) body.push(para(PARA_JUSTIFY, `<hp:run charPrIDRef="${reg.cp({ pt: BASE_PT, b: true })}">${tx(text)}</hp:run>`))
        const cp = reg.cp({ pt: BASE_PT })
        const rows = b.rows ?? []
        if (rows.length)
          body.push(
            tableXml({
              rows: rows.map((r) => [{ text: r.label, charPr: cp }, { text: r.checked ? '✔' : '', charPr: cp }]),
              colWidths: tableColWidths([5, 1], Math.round(A4_PORTRAIT_BODY_WIDTH * 0.5)),
              rowHeights: rows.map(() => 1700),
            }),
          )
        return
      }
      default:
        return body.push(para(reg.para(ind * 20), runs(reg, text, b, BASE_PT)))
    }
  })
  const previewText = [note.title, ...note.blocks.map((b) => b.text ?? '')].join('\n').slice(0, 2000)
  return buildHwpx({ landscape: false, bodyXml: body.join(''), charPrXml: reg.charPrXml(), previewText, title: note.title || '노트', headerXml: reg.header() }, now)
}
