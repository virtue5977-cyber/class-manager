/** 노트 → 한글(HWP)에 붙여 넣어도 모양이 남는 HTML. 한글이 잘 읽는 것만 쓴다: p·b·u·i·s·span(style)·table. 목록 기호는 글자로 넣는다. */
import type { NoteBlock, NoteRec } from '../db/types'
import { outlineMarks } from './blocks'
import { tableWidths } from './tableOps'
import { ptOf, segments, type Mark, type NoteLink, type Style } from './marks'

const BASE_PT = 10
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function runHtml(text: string, st: Style): string {
  let h = esc(text).replace(/\n/g, '<br>')
  const css: string[] = []
  if (st.color) css.push(`color:${st.color}`)
  if (st.bg) css.push(`background-color:${st.bg}`)
  if (st.font) css.push(`font-family:'${st.font}'`)
  if (st.pt || st.size) css.push(`font-size:${ptOf(st, BASE_PT)}pt`)
  if (st.s) h = `<s>${h}</s>`
  if (st.i) h = `<i>${h}</i>`
  if (st.u) h = `<u>${h}</u>`
  if (st.b) h = `<b>${h}</b>`
  return css.length ? `<span style="${css.join(';')}">${h}</span>` : h
}

/** 한 줄 글(서식 포함) → 인라인 HTML */
export function lineHtml(text: string, marks?: Mark[], links?: NoteLink[]): string {
  return segments(text, marks, links)
    .map((s) => runHtml(s.text, s.style))
    .join('')
}

function para(inner: string, o: { pt?: number; bold?: boolean; indent?: number; align?: string; line?: number } = {}): string {
  const css = [`font-size:${o.pt ?? BASE_PT}pt`, `line-height:${o.line ?? 160}%`, 'margin:0']
  if (o.align && o.align !== 'justify') css.push(`text-align:${o.align}`)
  if (o.bold) css.push('font-weight:bold')
  if (o.indent) css.push(`margin-left:${o.indent * 20}pt`)
  return `<p style="${css.join(';')}">${inner || '&nbsp;'}</p>`
}

function blockHtml(b: NoteBlock, mark: string, files: Map<string, string>): string {
  const ind = b.indent ?? 0
  const look = { align: b.align, line: b.line }
  const body = lineHtml(b.text ?? '', b.marks, b.links)
  switch (b.type) {
    case 'h1':
      return para(body, { pt: 16, bold: true, indent: ind, ...look })
    case 'h2':
      return para(body, { pt: 13, bold: true, indent: ind, ...look })
    case 'bullet':
    case 'number':
      return para(`${esc(mark)} ${body}`, { indent: ind + 1, ...look })
    case 'check':
      return para(`${b.checked ? '☑' : '☐'} ${b.checked ? `<s>${body}</s>` : body}`, { indent: ind, ...look })
    case 'divider':
      return para('―――――――――――――――――――――――――――――――')
    case 'file':
      return para(`[첨부] ${esc(files.get(b.file_id ?? '') ?? '파일')}`, { indent: ind })
    case 'folder':
      return para(`[폴더] ${esc(b.path ?? '')}`, { indent: ind })
    case 'table': {
      const ws = tableWidths(b)
      const cell = (t: string, r: number, c: number) => {
        const tag = b.head && r === 0 ? 'th' : 'td'
        return `<${tag} style="border:1px solid #000;padding:2pt 6pt;font-size:${BASE_PT}pt;width:${ws[c]}%;${tag === 'th' ? 'font-weight:bold;background:#f2f2f2;' : ''}">${esc(t).replace(/\n/g, '<br>') || '&nbsp;'}</${tag}>`
      }
      return `<table style="border-collapse:collapse;border:1px solid #000;width:100%">${(b.cells ?? []).map((row, r) => `<tr>${row.map((t, c) => cell(t, r, c)).join('')}</tr>`).join('')}</table>`
    }
    case 'pagebreak':
      return '<p style="page-break-before:always;margin:0"></p>'
    case 'roster': {
      const rows = (b.rows ?? []).map((r) => `<tr><td style="border:1px solid #000;padding:2pt 6pt;font-size:${BASE_PT}pt">${esc(r.label)}</td><td style="border:1px solid #000;padding:2pt 6pt;text-align:center;font-size:${BASE_PT}pt">${r.checked ? '✔' : ''}</td></tr>`)
      const title = b.text ? para(esc(b.text), { bold: true }) : ''
      return `${title}<table style="border-collapse:collapse;border:1px solid #000">${rows.join('')}</table>`
    }
    default:
      return para(body, { indent: ind, ...look })
  }
}

/** 노트 전체(또는 고른 블록들) → HTML 조각. 제목을 맨 위에. files: 첨부 id → 이름 */
export function noteToHtml(note: Pick<NoteRec, 'title' | 'blocks'>, o: { withTitle?: boolean; files?: Map<string, string> } = {}): string {
  const marks = outlineMarks(note.blocks)
  const files = o.files ?? new Map()
  const parts = note.blocks.map((b, i) => blockHtml(b, marks[i], files))
  if (o.withTitle !== false && note.title) parts.unshift(para(esc(note.title), { pt: 18, bold: true }))
  return `<html><head><meta charset="utf-8"></head><body><!--StartFragment-->${parts.join('')}<!--EndFragment--></body></html>`
}

/** 서식 없는 글(붙여넣기 대비용) */
export function noteToPlain(note: Pick<NoteRec, 'title' | 'blocks'>, o: { withTitle?: boolean } = {}): string {
  const marks = outlineMarks(note.blocks)
  const lines = note.blocks.map((b, i) => {
    const pad = '  '.repeat(b.indent ?? 0)
    const t = b.text ?? ''
    if (b.type === 'bullet' || b.type === 'number') return `${pad}${marks[i]} ${t}`
    if (b.type === 'check') return `${pad}${b.checked ? '☑' : '☐'} ${t}`
    if (b.type === 'divider') return '―――――'
    if (b.type === 'roster') return [t, ...(b.rows ?? []).map((r) => `${r.label}\t${r.checked ? '✔' : ''}`)].filter(Boolean).join('\n')
    return pad + t
  })
  return [o.withTitle !== false && note.title ? note.title : null, ...lines].filter((x) => x !== null).join('\n')
}

/** 클립보드에 HTML+글 넣기(안 되면 숨긴 칸을 골라 복사) */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (CI && navigator.clipboard?.write) {
      await navigator.clipboard.write([new CI({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])
      return true
    }
  } catch {
    /* 아래 방법으로 */
  }
  try {
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault()
      e.clipboardData?.setData('text/html', html)
      e.clipboardData?.setData('text/plain', plain)
    }
    document.addEventListener('copy', onCopy)
    const ok = document.execCommand?.('copy') ?? false
    document.removeEventListener('copy', onCopy)
    return ok
  } catch {
    return false
  }
}
