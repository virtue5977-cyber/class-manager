import { BASE_CHARPR_COUNT, BASE_HEADER_XML } from './package'

/** 복제 기준: 기본 양식 charPr 6(맑은 고딕). */
const BASE_CHARPR = (() => {
  const m = BASE_HEADER_XML.match(/<hh:charPr id="6"[\s\S]*?<\/hh:charPr>/)
  if (!m) throw new Error('기본 양식에서 charPr 6을 찾지 못했습니다.')
  return m[0].replace(/<hh:bold\/>/g, '')
})()

/** 글자 크기·굵기별 charPr를 만들고 id를 돌려준다. id는 기본 양식 개수(12)부터. */
export class CharPrRegistry {
  private specs: { sizePt: number; bold: boolean }[] = []

  id(sizePt: number, bold = false): number {
    let i = this.specs.findIndex((s) => s.sizePt === sizePt && s.bold === bold)
    if (i < 0) i = this.specs.push({ sizePt, bold }) - 1
    return BASE_CHARPR_COUNT + i
  }

  xml(): string[] {
    return this.specs.map((s, i) => {
      let x = BASE_CHARPR.replace(/<hh:charPr id="6" height="\d+"/, `<hh:charPr id="${BASE_CHARPR_COUNT + i}" height="${Math.round(s.sizePt * 100)}"`)
      if (s.bold) x = x.replace(/(<hh:offset [^>]*\/>)/, '$1<hh:bold/>')
      return x
    })
  }
}
