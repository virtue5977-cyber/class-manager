/** 글 안 '@노트제목' ↔ 링크. 전달사항은 parts(할 일과 같은 형식: 글 조각과 {note}), 노트 줄은 links(글 안 위치). */
import type { TodoPart } from '../db/types'
import type { NoteLink } from './marks'

export interface NoteTitle {
  id: string
  title: string
}

/** 글에서 '@제목'(있는 노트 제목, 긴 것 먼저)을 찾아 parts로. 하나도 없으면 undefined */
export function parseNoteParts(text: string, notes: NoteTitle[]): TodoPart[] | undefined {
  const titles = notes.filter((n) => n.title.trim()).sort((a, b) => b.title.length - a.title.length)
  const out: TodoPart[] = []
  let buf = ''
  let found = false
  for (let i = 0; i < text.length; ) {
    if (text[i] === '@') {
      const hit = titles.find((n) => text.startsWith(n.title, i + 1))
      if (hit) {
        if (buf) out.push(buf)
        buf = ''
        out.push({ note: hit.id })
        i += 1 + hit.title.length
        found = true
        continue
      }
    }
    buf += text[i++]
  }
  if (buf) out.push(buf)
  return found ? out : undefined
}

/** parts(글 조각 + {note}) → 그 글 안 링크 위치. 노트 조각은 글에서 '@제목' 자리다(제목은 titleOf로). */
export function linksFromParts(text: string, parts: TodoPart[] | undefined, titleOf: (id: string) => string | undefined): NoteLink[] {
  if (!parts) return []
  const out: NoteLink[] = []
  let at = 0
  for (const p of parts) {
    if (typeof p === 'string') {
      const j = text.indexOf(p, at)
      if (j < 0) return out
      at = j + p.length
    } else if ('note' in p) {
      const t = titleOf(p.note)
      if (t === undefined || !text.startsWith(`@${t}`, at)) continue
      out.push({ from: at, to: at + 1 + t.length, note: p.note })
      at += 1 + t.length
    }
  }
  return out
}

/** 커서 앞이 '@글자'이면 노트 찾기: 시작 위치와 찾는 글 */
export function mentionAt(text: string, caret: number): { start: number; q: string } | null {
  const m = /(^|[\s(])@([^\s@]{0,20})$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[2].length - 1, q: m[2] } : null
}

/** 노트 후보(제목에 글이 든 것, 앞에서 맞는 것 먼저) 8개 */
export function matchNotes<T extends NoteTitle>(notes: T[], q: string, exclude?: string): T[] {
  const t = q.trim()
  return notes
    .filter((n) => n.id !== exclude && n.title.trim() && (!t || n.title.includes(t)))
    .sort((a, b) => Number(b.title.startsWith(t)) - Number(a.title.startsWith(t)))
    .slice(0, 8)
}
