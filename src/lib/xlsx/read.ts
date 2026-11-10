import JSZip from 'jszip'

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m)))
const texts = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1])).join('')

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)![0]
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 첫 번째 시트를 글자 표로 읽는다(숫자는 그대로 문자열, 날짜 서식은 엑셀 일련번호로 남음). */
/** 명렬표에 충분한 크기. 이보다 먼 줄·칸은 버린다(셀 주소만 커다란 파일로 메모리를 채우지 못하게). */
const MAX_ROWS = 5000
const MAX_COLS = 200

export async function readFirstSheet(bytes: Uint8Array): Promise<string[][]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('xlsx 파일을 읽지 못했습니다. 예전 형식(.xls)이면 엑셀에서 "다른 이름으로 저장 → .xlsx"로 바꿔 올리거나, 내용을 복사해 붙여넣으세요.')
  }
  const wb = await zip.file('xl/workbook.xml')?.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!wb) throw new Error('엑셀 파일 형식이 아닙니다.')
  const firstId = wb.match(/<(?:\w+:)?sheet\b[^>]*r:id="([^"]+)"/)?.[1]
  let target = 'worksheets/sheet1.xml'
  if (firstId && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${firstId}"`))
    const t = rel?.match(/Target="([^"]+)"/)?.[1]
    if (t) target = t.replace(/^\/?xl\//, '').replace(/^\//, '')
  }
  const sheet = await zip.file(`xl/${target}`)?.async('string')
  if (!sheet) throw new Error('엑셀 시트를 찾지 못했습니다.')
  const ssXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const shared = [...ssXml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => texts(m[1]))
  const out: string[][] = []
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const r = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? out.length + 1) - 1
    if (r >= MAX_ROWS) continue
    const row: string[] = []
    let next = 0
    for (const cm of rm[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cm[1]
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      const ci = ref ? colIndex(ref) : next
      next = ci + 1
      if (ci >= MAX_COLS) continue
      const body = cm[2] ?? ''
      const type = attrs.match(/\bt="(\w+)"/)?.[1]
      const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1]
      let val = ''
      if (type === 's') val = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') val = texts(body)
      else if (v !== undefined) val = decode(v)
      while (row.length < ci) row.push('')
      row[ci] = val
    }
    out[r] = row
  }
  return Array.from({ length: out.length }, (_, i) => out[i] ?? [])
}
