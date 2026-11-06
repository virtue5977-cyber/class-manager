import { escapeXml } from './xml'

export const PLACEHOLDER_RE = /\{\{([0-9A-Za-z_가-힣]+)\}\}/g

const T_RE = /<hp:t>([\s\S]*?)<\/hp:t>/g

const NAME = '[0-9A-Za-z_가-힣]'
const COMPLETE_RE = new RegExp(`^\\{\\{${NAME}+\\}\\}`)
const PARTIAL_RE = new RegExp(`^\\{(\\{${NAME}*\\}?)?$`)
/** 두 <hp:t> 사이가 같은 문단의 run 경계뿐인지(탭·줄바꿈·개체가 끼면 합치지 않는다). */
const RUN_GAP_RE = /^(?:\s|<\/hp:run>|<hp:run\b[^>]*>)*$/

/** 표시가 열린 채 끝나는 위치(마지막 '{{' 또는 끝의 '{'), 없으면 -1. */
function openAt(text: string): number {
  const p = text.lastIndexOf('{{')
  if (p >= 0 && text.indexOf('}}', p) < 0) return p
  return text.endsWith('{') ? text.length - 1 : -1
}

/**
 * 한글이 표시 하나를 여러 <hp:t>로 쪼개 저장한 경우, 같은 문단의 이어지는 run이면 앞 조각으로 글자를 모은다.
 * 합친 글자가 실제로 {{이름}}을 완성할 때만 합치므로, 표시가 아닌 '{{'가 뒤 글자를 끌어오지 않는다.
 */
export function joinSplitPlaceholders(xml: string): string {
  const segs: { start: number; end: number; text: string }[] = []
  for (const m of xml.matchAll(T_RE)) segs.push({ start: m.index!, end: m.index! + m[0].length, text: m[1] })
  for (let i = 0; i < segs.length; i++) {
    for (;;) {
      const p = openAt(segs[i].text)
      if (p < 0) break
      let tail = segs[i].text.slice(p)
      let j = i + 1
      let done = -1
      while (j < segs.length && RUN_GAP_RE.test(xml.slice(segs[j - 1].end, segs[j].start))) {
        tail += segs[j].text
        if (COMPLETE_RE.test(tail)) { done = j; break }
        if (!PARTIAL_RE.test(tail)) break
        j++
      }
      if (done < 0) break
      for (let k = i + 1; k <= done; k++) {
        segs[i].text += segs[k].text
        segs[k].text = ''
      }
    }
  }
  let out = ''
  let pos = 0
  for (const s of segs) {
    out += xml.slice(pos, s.start) + `<hp:t>${s.text}</hp:t>`
    pos = s.end
  }
  return out + xml.slice(pos)
}

export function findPlaceholders(xml: string): string[] {
  return [...new Set([...xml.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))]
}

/** 값은 escape해서 넣고, 값이 없는 표시는 빈칸으로 바꾼 뒤 unknown에 모은다. */
export function fillPlaceholders(xml: string, values: Record<string, string>): { xml: string; unknown: string[] } {
  const unknown = new Set<string>()
  const out = xml.replace(PLACEHOLDER_RE, (_m, name: string) => {
    if (!(name in values)) {
      unknown.add(name)
      return ''
    }
    return escapeXml(values[name])
  })
  return { xml: out, unknown: [...unknown] }
}

const OBJ_ID_RE = /<hp:(tbl|pic|rect|ellipse|line|container|polygon|arc|curve) id="(\d+)"/g

/** 섹션 본문을 count쪽으로 복제한다. 2쪽부터 쪽 설정·머리말을 빼고 쪽 나눔을 넣으며 개체 id를 겹치지 않게 바꾼다. */
export function repeatPages(sectionXml: string, count: number, fill: (pageXml: string, i: number) => string): string {
  const open = sectionXml.match(/<hs:sec\b[^>]*>/)
  const close = sectionXml.lastIndexOf('</hs:sec>')
  if (!open || close < 0) throw new Error('양식 구조(hs:sec)를 찾지 못했습니다.')
  const head = sectionXml.slice(0, open.index! + open[0].length)
  const body = sectionXml.slice(head.length, close)
  const used = [...body.matchAll(OBJ_ID_RE)].map((m) => Number(m[2]))
  let next = Math.max(1000, ...used) + 1
  if (next > 2_000_000_000) next = 1000
  const pages = [fill(body, 0)]
  for (let i = 1; i < count; i++) {
    let copy = body
      .replace(/<hp:secPr\b[\s\S]*?<\/hp:secPr>/, '')
      .replace(/<hp:ctrl><hp:colPr\b[^>]*\/><\/hp:ctrl>/, '')
      .replace(/<hp:ctrl><hp:(header|footer)\b[\s\S]*?<\/hp:\1><\/hp:ctrl>/g, '')
      .replace(OBJ_ID_RE, (_m, tag: string) => `<hp:${tag} id="${next++}"`)
    copy = copy.replace(/<hp:p\b([^>]*?)pageBreak="0"/, '<hp:p$1pageBreak="1"')
    pages.push(fill(copy, i))
  }
  return head + pages.join('') + sectionXml.slice(close)
}
