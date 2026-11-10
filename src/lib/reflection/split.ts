import { bodyOpts, fitLine, type PaperMode } from './fit'

/** 문장 단위로 나누기(문장 앞 번호 '1.' '2)'는 지운다). 보내 주신 생성기 규칙 그대로. */
export function splitSentences(raw: string): string[] {
  let t = raw.replace(/\r/g, '')
  t = t.replace(/(^|\n|[.!?”"'’)]\s+)\d{1,2}\s*[.)]\s*(?=[가-힣A-Za-z“"'‘(])/g, '$1')
  const out: string[] = []
  for (const par of t.split(/\n+/)) for (const s of par.match(/[^.!?。…]+(?:[.!?。…]+["”'’)]*|$)/g) ?? []) if (s.trim()) out.push(s.trim())
  return out
}

/** 붙여 넣은 글을 줄에 나눈다: 한 줄에 안 들어가는 문장은 띄어쓰기·쉼표 근처에서 고르게 자른다. */
export function distribute(raw: string, mode: PaperMode): string[] {
  const queue = splitSentences(raw)
  const lines: string[] = []
  const fits = (prefix: string, s: string) => !fitLine(prefix + s, bodyOpts(mode)).over
  while (queue.length) {
    const prefix = `${lines.length + 1}. `
    const s = queue.shift()!
    if (fits(prefix, s)) {
      lines.push(s)
      continue
    }
    const ch = [...s]
    let parts = 2
    while (parts < ch.length && !fits(prefix, ch.slice(0, Math.ceil(ch.length / parts)).join(''))) parts++
    const target = Math.ceil(ch.length / parts)
    let cut = target
    for (let d = 0; d <= 6; d++) {
      const c = [target - d, target + d].find((j) => j > 0 && j < ch.length && (ch[j] === ' ' || ch[j - 1] === ',') && fits(prefix, ch.slice(0, j).join('').trim()))
      if (c) {
        cut = c
        break
      }
    }
    while (cut > 1 && !fits(prefix, ch.slice(0, cut).join('').trim())) cut--
    lines.push(ch.slice(0, cut).join('').trim())
    const rest = ch.slice(cut).join('').trim()
    if (rest) queue.unshift(rest)
  }
  return lines
}
