import type { AppDB } from '../db/schema'
import type { NoteFileRec, NoteRec } from '../db/types'
import { newRecord, save, scrubDelete } from '../db/records'

export const MAX_FILE = 50 * 1024 * 1024
/** 모든 노트 첨부 합계 한도(브라우저 저장 공간·백업 크기 보호) */
export const MAX_TOTAL = 500 * 1024 * 1024

export const newBlockId = () => crypto.randomUUID().slice(0, 8)

export async function createNote(db: AppDB, title = '새 노트', blocks: NoteRec['blocks'] = [{ id: newBlockId(), type: 'p', text: '' }], folderId: string | null = null): Promise<NoteRec> {
  const rec = newRecord({ title, blocks, pinned: false, ...(folderId ? { folder_id: folderId } : {}) }) as NoteRec
  await db.notes.add(rec)
  return rec
}

export const saveNote = (db: AppDB, rec: NoteRec) => save(db.notes, rec)

/** 편집 저장: 최신 노트에 제목·블록만 바꾼다(그사이 바뀐 고정 표시는 지키고, 지운 노트는 되살리지 않음). */
export async function saveNoteContent(db: AppDB, id: string, content: Pick<NoteRec, 'title' | 'blocks'>, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.notes, async () => {
    const cur = await db.notes.get(id)
    if (!cur || cur.deleted) return
    await save(db.notes, { ...cur, title: content.title, blocks: content.blocks })
  })
  // 블록에서 빠진 지 1분 넘은 첨부는 내용을 비운다(백업이 커지지 않게). 막 붙인 파일은 블록이 저장되기 전일 수 있어 기다린다.
  const used = new Set(content.blocks.filter((b) => b.file_id).map((b) => b.file_id))
  for (const f of await db.note_files.where('note_id').equals(id).toArray())
    if (!f.deleted && !used.has(f.id) && Date.parse(f.created_at) < now - 60_000) await dropFile(db, f.id)
}

/** 고정만 바꾼다(최신 노트 기준). */
export async function setPinned(db: AppDB, id: string, pinned: boolean): Promise<void> {
  await db.transaction('rw', db.notes, async () => {
    const cur = await db.notes.get(id)
    if (cur && !cur.deleted) await save(db.notes, { ...cur, pinned })
  })
}

/** 고정 먼저, 그다음 최근에 고친 순 */
export async function listNotes(db: AppDB): Promise<NoteRec[]> {
  return (await db.notes.toArray()).filter((n) => !n.deleted).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
}

/** 첨부 지우기: 삭제 표시와 함께 내용(base64)을 비운다. */
async function dropFile(db: AppDB, fileId: string): Promise<void> {
  const f = await db.note_files.get(fileId)
  if (f) await save(db.note_files, { ...f, deleted: true, data: '' })
}

export async function deleteNote(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.note_files, async () => {
    await scrubDelete(db.notes, id, { title: '', blocks: [] })
    for (const f of await db.note_files.where('note_id').equals(id).toArray()) if (!f.deleted || f.data) await dropFile(db, f.id)
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
  let used = 0
  await db.note_files.each((f) => { if (!f.deleted) used += f.size || 0 })
  if (used + file.bytes.length > MAX_TOTAL) throw new Error(`첨부 파일은 모두 합쳐 500MB까지입니다(지금 ${Math.round(used / 1048576)}MB). 쓰지 않는 첨부를 지우세요.`)
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
export const noteText = (n: NoteRec) => [n.title, ...n.blocks.map((b) => [b.text ?? '', ...(b.rows ?? []).map((r) => r.label)].join(' '))].join('\n')
