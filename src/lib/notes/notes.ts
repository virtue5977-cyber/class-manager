import type { AppDB } from '../db/schema'
import type { NoteFileRec, NoteRec } from '../db/types'
import { newRecord, save, softDelete } from '../db/records'

export const MAX_FILE = 50 * 1024 * 1024

export const newBlockId = () => crypto.randomUUID().slice(0, 8)

export async function createNote(db: AppDB, title = '새 노트', blocks: NoteRec['blocks'] = [{ id: newBlockId(), type: 'p', text: '' }]): Promise<NoteRec> {
  const rec = newRecord({ title, blocks, pinned: false }) as NoteRec
  await db.notes.add(rec)
  return rec
}

export const saveNote = (db: AppDB, rec: NoteRec) => save(db.notes, rec)

/** 고정 먼저, 그다음 최근에 고친 순 */
export async function listNotes(db: AppDB): Promise<NoteRec[]> {
  return (await db.notes.toArray()).filter((n) => !n.deleted).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
}

export async function deleteNote(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.note_files, async () => {
    await softDelete(db.notes, id)
    for (const f of await db.note_files.where('note_id').equals(id).toArray()) if (!f.deleted) await softDelete(db.note_files, f.id)
  })
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromB64(b: string): Uint8Array {
  const s = atob(b)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function attachFile(db: AppDB, noteId: string, file: { name: string; mime: string; bytes: Uint8Array }): Promise<NoteFileRec> {
  if (file.bytes.length > MAX_FILE) throw new Error('50MB까지 붙일 수 있습니다.')
  const rec = newRecord({ note_id: noteId, name: file.name, mime: file.mime || 'application/octet-stream', size: file.bytes.length, data: toB64(file.bytes) }) as NoteFileRec
  await db.note_files.add(rec)
  return rec
}

export async function readFile(db: AppDB, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  const f = await db.note_files.get(fileId)
  if (!f || f.deleted) throw new Error('첨부 파일을 찾을 수 없습니다.')
  return { name: f.name, mime: f.mime, bytes: fromB64(f.data) }
}

/** 노트 본문 글(검색·내보내기용) */
export const noteText = (n: NoteRec) => [n.title, ...n.blocks.map((b) => b.text ?? '')].join('\n')
