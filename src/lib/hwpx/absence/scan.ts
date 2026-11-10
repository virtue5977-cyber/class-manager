/** 다른 학교 결석신고서(hwpx) 양식 읽기: 표 칸의 글로 자리를 찾아 {{표시}}를 빈 칸에 써 넣는다. */
import JSZip from 'jszip'
import { extractJson, type AiCaller } from '../../ai/client'
import { escapeXml } from '../xml'

export interface FormCell {
  /** 본문에 나오는 순서 */
  id: number
  row: number
  col: number
  rowSpan: number
  colSpan: number
  text: string
}

/** field = 기존 {{표시}} 이름, label = 이름표 칸 id, target = 값이 들어갈 칸 id */
export interface Slot {
  field: string
  label: number
  target: number
}

/** 찾을 자리(규칙). 칸 글의 띄어쓰기는 무시하지 않고 정규식이 흡수한다. */
export const SLOT_FIELDS: { field: string; label: string; re: RegExp }[] = [
  { field: '이름', label: '학생 이름', re: /^(학생\s*)?(성\s*명|이\s*름)$/ },
  { field: '학번', label: '학번', re: /^학\s*번$/ },
  { field: '학년반번호', label: '학년·반·번호', re: /학\s*년.*반|반.*번\s*호/ },
  { field: '기간', label: '결석 기간', re: /^(결석\s*)?(기\s*간|일\s*시)$/ },
  { field: '일수', label: '일수', re: /일\s*수/ },
  { field: '사유', label: '사유', re: /^(결석\s*)?사\s*유$|^내\s*용$/ },
  { field: '결석종류', label: '결석 종류', re: /^(구\s*분|종\s*류)$/ },
  { field: '작성날짜', label: '작성 날짜', re: /(작성|신고|제출)\s*일/ },
]

const TC_RE = /<hp:tc\b[\s\S]*?<\/hp:tc>/g

function cellInfo(xml: string, id: number): FormCell {
  const addr = xml.match(/<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"/)
  const span = xml.match(/<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"/)
  const text = [...xml.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ''))
    .join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return { id, row: Number(addr?.[2] ?? 0), col: Number(addr?.[1] ?? 0), colSpan: Number(span?.[1] ?? 1), rowSpan: Number(span?.[2] ?? 1), text }
}

/** 본문의 모든 표 칸(겹친 표는 바깥 칸이 안 칸 글까지 담지 않도록 가장 안쪽 칸만). */
export function scanCells(sectionXml: string): FormCell[] {
  const out: FormCell[] = []
  let id = 0
  for (const m of sectionXml.matchAll(TC_RE)) {
    if (/<hp:tbl\b/.test(m[0])) continue // 안에 표가 있는 칸(겹친 표)은 건너뜀
    out.push(cellInfo(m[0], id++))
  }
  return out
}

/** 이름표 칸의 값 칸: 오른쪽(같은 줄) 빈 칸, 없으면 아래(같은 열) 빈 칸. */
function targetOf(cells: FormCell[], label: FormCell): FormCell | undefined {
  const right = cells.find((c) => c.row === label.row && c.col === label.col + label.colSpan && c.id !== label.id)
  if (right && !right.text) return right
  const below = cells.find((c) => c.col === label.col && c.row === label.row + label.rowSpan)
  if (below && !below.text) return below
  return undefined
}

export function matchByRules(cells: FormCell[]): Slot[] {
  const out: Slot[] = []
  const used = new Set<number>()
  for (const f of SLOT_FIELDS) {
    for (const c of cells) {
      if (!c.text || !f.re.test(c.text)) continue
      const t = targetOf(cells, c)
      if (!t || used.has(t.id)) continue
      out.push({ field: f.field, label: c.id, target: t.id })
      used.add(t.id)
      break
    }
  }
  return out
}

/** 규칙으로 못 찾은 자리만 AI에 묻는다. 보내는 것은 양식 칸의 글뿐(학생 자료 없음). */
export async function matchByAi(cells: FormCell[], have: Slot[], ai: AiCaller): Promise<Slot[]> {
  const missing = SLOT_FIELDS.filter((f) => !have.some((s) => s.field === f.field))
  if (!missing.length) return []
  const labels = cells.filter((c) => c.text).map((c) => ({ id: c.id, row: c.row, col: c.col, text: c.text.slice(0, 40) }))
  const raw = await ai({
    system:
      '학교 결석신고서 양식의 표 칸 글 목록을 보고, 각 자리(field)의 이름표가 되는 칸 id를 고른다. 이름표 칸의 오른쪽이나 아래 빈 칸에 값이 들어간다. 맞는 칸이 없으면 그 자리는 빼고, 추측하지 않는다.\n출력은 JSON {"pairs":[{"field":"자리","label":칸id}]} 만.',
    user: JSON.stringify({ fields: missing.map((f) => ({ field: f.field, 뜻: f.label })), cells: labels }),
    maxTokens: 800,
  })
  const pairs = extractJson<{ pairs?: { field?: unknown; label?: unknown }[] }>(raw).pairs ?? []
  const used = new Set(have.map((s) => s.target))
  const out: Slot[] = []
  for (const p of pairs) {
    if (typeof p.field !== 'string' || !missing.some((f) => f.field === p.field) || out.some((s) => s.field === p.field)) continue
    const label = cells.find((c) => c.id === p.label)
    const t = label && targetOf(cells, label)
    if (!t || used.has(t.id)) continue
    used.add(t.id)
    out.push({ field: p.field, label: label!.id, target: t.id })
  }
  return out
}

/** 값 칸의 첫 문단 글을 {{field}} 하나로 바꾼 hwpx. 칸 모양(글자 모양)은 그 칸 첫 run의 것을 쓴다. */
export async function markTemplate(bytes: Uint8Array, slots: Slot[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes)
  const f = zip.file('Contents/section0.xml')
  if (!f) throw new Error('양식에 본문(section0.xml)이 없습니다.')
  const xml = await f.async('string')
  const byTarget = new Map(slots.map((s) => [s.target, s.field]))
  let id = 0
  const out = xml.replace(TC_RE, (tc) => {
    if (/<hp:tbl\b/.test(tc)) return tc
    const field = byTarget.get(id++)
    if (!field) return tc
    return tc.replace(/(<hp:p\b[^>]*>)([\s\S]*?)(<\/hp:p>)/, (_m, open: string, inner: string, close: string) => {
      const cp = inner.match(/<hp:run charPrIDRef="(\d+)"/)?.[1] ?? '0'
      const keep = inner.match(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/)?.[0] ?? ''
      return `${open}<hp:run charPrIDRef="${cp}"><hp:t>${escapeXml(`{{${field}}}`)}</hp:t></hp:run>${keep}${close}`
    })
  })
  const z2 = new JSZip()
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  names.sort((a, b) => Number(b === 'mimetype') - Number(a === 'mimetype'))
  for (const n of names) z2.file(n, n === 'Contents/section0.xml' ? out : await zip.files[n].async('uint8array'), { compression: n === 'mimetype' ? 'STORE' : 'DEFLATE', createFolders: false })
  return z2.generateAsync({ type: 'uint8array' })
}
