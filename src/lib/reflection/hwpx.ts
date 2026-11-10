import { escapeXml } from '../hwpx/xml'
import JSZip from 'jszip'
import { bodyOpts, fitLine, MODES, titleOpts, type PaperMode } from './fit'
import { REFLECTION_HWPX_B64 } from './template'

const b64ToU8 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0))
const xesc = (s: string) => escapeXml(s)

export interface ReflectionDoc {
  date: string
  no: string
  name: string
  t1: string
  t2: string
  lines: string[]
  mode: PaperMode
  fitOpts?: { auto?: boolean; minSp?: number; minPt?: number }
}

/** 보내 주신 양식의 글자만 바꿔 저장(생성기 saveHwpx 이식). 맞춤 크기·자간은 글자 서식을 복제해 넣는다. */
export async function buildReflectionHwpx(d: ReflectionDoc): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(b64ToU8(REFLECTION_HWPX_B64))
  let header = await zip.file('Contents/header.xml')!.async('string')
  let sec = await zip.file('Contents/section0.xml')!.async('string')
  let nextId = +header.match(/<hh:charProperties itemCnt="(\d+)"/)![1]
  const made: Record<string, number> = {}
  const add: string[] = []
  const getCp = (baseId: number, pt: number, sp: number) => {
    const key = `${baseId}|${pt}|${sp}`
    if (made[key] !== undefined) return made[key]
    const m = header.match(new RegExp(`<hh:charPr id="${baseId}"[\\s\\S]*?</hh:charPr>`))![0]
    const id = nextId++
    add.push(
      m
        .replace(/<hh:charPr id="\d+"/, `<hh:charPr id="${id}"`)
        .replace(/height="\d+"/, `height="${Math.round(pt * 100)}"`)
        .replace(/<hh:spacing [^>]*\/>/, `<hh:spacing hangul="${sp}" latin="${sp}" hanja="${sp}" japanese="${sp}" other="${sp}" symbol="${sp}" user="${sp}"/>`),
    )
    return (made[key] = id)
  }
  const run = (cp: number, text: string) => (text ? `<hp:run charPrIDRef="${cp}"><hp:t>${xesc(text)}</hp:t></hp:run>` : `<hp:run charPrIDRef="${cp}"/>`)
  const rows = sec.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g)!
  const out = rows.slice()
  // 0행: 날짜·학번·이름
  {
    const vals = [d.date.trim(), d.no.trim(), d.name.trim()]
    let k = 0
    out[0] = rows[0].replace(/<hp:run charPrIDRef="7"\/>/g, (m) => {
      const v = vals[k++]
      return v ? run(7, v) : m
    })
  }
  // 1행: 위 안내 두 줄(12=굵게, 10=보통)
  {
    const tt = [d.t1, d.t2]
    let k = 0
    out[1] = rows[1].replace(/<hp:run charPrIDRef="(\d+)"><hp:t>[\s\S]*?<\/hp:t><\/hp:run>/g, () => {
      const v = tt[k] ?? ''
      const f = fitLine(v, titleOpts(d.mode, d.fitOpts))
      const base = k === 0 ? 12 : 10
      k++
      return run(getCp(base, f.pt, f.sp), v)
    })
  }
  // 2~33행: 16줄(짝수 행). 1번은 양식의 자동 번호를 쓴다.
  for (let i = 0; i < 16; i++) {
    const idx = 2 + i * 2
    const v = d.lines[i] ?? ''
    const f = fitLine(v ? `${i + 1}. ${v}` : '', bodyOpts(d.mode, d.fitOpts))
    const text = v ? (i === 0 ? v : `${i + 1}. ${v}`) : ''
    const r = run(getCp(14, f.pt, f.sp), text)
    // 바꿀 글에 $&·$' 같은 것이 있어도 그대로 들어가게 함수로 넘긴다.
    out[idx] = rows[idx].replace(/<hp:run charPrIDRef="\d+">(?:<hp:t>[\s\S]*?<\/hp:t>)?<\/hp:run>|<hp:run charPrIDRef="\d+"\/>/, () => r)
  }
  rows.forEach((r, i) => (sec = sec.replace(r, `\u0000${i}\u0000`)))
  sec = sec.replace(/\u0000(\d+)\u0000/g, (_m, i) => out[+i])
  const m = MODES[d.mode]
  if (m.k !== 1) {
    sec = sec
      .replace(/<hp:pagePr landscape="WIDELY" width="\d+" height="\d+"/, `<hp:pagePr landscape="WIDELY" width="${m.pageW}" height="${m.pageH}"`)
      .replace(/<hp:cellSz width="(\d+)" height="(\d+)"\/>/g, (_s, w, h) => `<hp:cellSz width="${Math.round(w * m.k)}" height="${Math.round(h * m.k)}"/>`)
      .replace(/(<hp:tbl [^>]*>\s*<hp:sz width=")(\d+)(" widthRelTo="ABSOLUTE" height=")(\d+)"/, (_s, a, w, b, h) => `${a}${Math.round(w * m.k)}${b}${Math.round(h * m.k)}"`)
  }
  header = header.replace(/<hh:charProperties itemCnt="\d+"/, `<hh:charProperties itemCnt="${nextId}"`).replace('</hh:charProperties>', add.join('') + '</hh:charProperties>')
  zip.file('Contents/header.xml', header)
  zip.file('Contents/section0.xml', sec)
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' })
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/hwp+zip', compression: 'DEFLATE' })
}
