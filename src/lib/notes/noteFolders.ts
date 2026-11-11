/** 노트함 폴더: 설정(note_folders)에 폴더 목록, 노트에는 folder_id. 깊이는 3단까지. */
import type { AppDB } from '../db/schema'
import type { NoteFolder, NoteRec } from '../db/types'
import { save } from '../db/records'
import { updateSettings } from '../settings'
import { APP_SETTINGS_ID } from '../backup/service'

export const MAX_FOLDER_DEPTH = 3
const TOO_DEEP = `폴더는 ${MAX_FOLDER_DEPTH}단까지 만들 수 있습니다.`

/** 읽기만 한다(화면의 liveQuery 안에서도 부르므로 설정 행을 만들지 않는다). */
export async function listFolders(db: AppDB): Promise<NoteFolder[]> {
  return (await db.app_settings.get(APP_SETTINGS_ID))?.note_folders ?? []
}

/** 폴더 깊이(맨 위 = 1) */
function depthOf(list: NoteFolder[], id: string | null): number {
  let d = 0
  for (let cur = id, guard = 0; cur && guard < 50; guard++) {
    d++
    cur = list.find((f) => f.id === cur)?.parent ?? null
  }
  return d
}
/** id 아래 폴더들의 가장 깊은 단(자기 포함 = 1) */
function heightOf(list: NoteFolder[], id: string): number {
  const kids = list.filter((f) => f.parent === id)
  return 1 + (kids.length ? Math.max(...kids.map((k) => heightOf(list, k.id))) : 0)
}
const cleanName = (name: string) => {
  const t = name.trim().slice(0, 40)
  if (!t) throw new Error('폴더 이름을 쓰세요.')
  return t
}

export async function addFolder(db: AppDB, name: string, parent: string | null = null): Promise<NoteFolder> {
  const list = await listFolders(db)
  const n = cleanName(name)
  if (parent && !list.some((f) => f.id === parent)) parent = null
  if (depthOf(list, parent) + 1 > MAX_FOLDER_DEPTH) throw new Error(TOO_DEEP)
  const f: NoteFolder = { id: crypto.randomUUID().slice(0, 8), name: n, parent }
  await updateSettings(db, (cur) => ({ note_folders: [...(cur.note_folders ?? []), f] }))
  return f
}

export async function renameFolder(db: AppDB, id: string, name: string): Promise<void> {
  const n = cleanName(name)
  await updateSettings(db, (cur) => ({ note_folders: (cur.note_folders ?? []).map((f) => (f.id === id ? { ...f, name: n } : f)) }))
}

/** 폴더를 다른 폴더 아래(또는 맨 위 null)로. 자기 아래로는 안 되고 3단을 넘으면 오류. */
export async function moveFolder(db: AppDB, id: string, parent: string | null): Promise<void> {
  const list = await listFolders(db)
  for (let cur = parent, guard = 0; cur && guard < 50; guard++) {
    if (cur === id) throw new Error('폴더를 자기 안으로 옮길 수 없습니다.')
    cur = list.find((f) => f.id === cur)?.parent ?? null
  }
  if (depthOf(list, parent) + heightOf(list, id) > MAX_FOLDER_DEPTH) throw new Error(TOO_DEEP)
  await updateSettings(db, (cur) => ({ note_folders: (cur.note_folders ?? []).map((f) => (f.id === id ? { ...f, parent } : f)) }))
}

/** 폴더 지우기: 하위 폴더와 안의 노트는 위 폴더로 옮긴다(노트는 지우지 않는다). */
export async function deleteFolder(db: AppDB, id: string): Promise<void> {
  const list = await listFolders(db)
  const gone = list.find((f) => f.id === id)
  if (!gone) return
  await updateSettings(db, (cur) => ({ note_folders: (cur.note_folders ?? []).filter((f) => f.id !== id).map((f) => (f.parent === id ? { ...f, parent: gone.parent } : f)) }))
  const inside = (await db.notes.toArray()).filter((n) => !n.deleted && n.folder_id === id)
  for (const n of inside) await moveNote(db, n.id, gone.parent)
}

/** 노트를 폴더로(null = 맨 위). 최신 노트 기준으로 folder_id만 바꾼다. */
export async function moveNote(db: AppDB, noteId: string, folderId: string | null): Promise<void> {
  await db.transaction('rw', db.notes, async () => {
    const cur = await db.notes.get(noteId)
    if (cur && !cur.deleted) await save(db.notes, { ...cur, folder_id: folderId })
  })
}

export interface FolderNode {
  folder: NoteFolder
  folders: FolderNode[]
  notes: NoteRec[]
  /** 이 폴더와 하위 폴더 안 노트 수 */
  count: number
}

/** 나무로 묶기: 폴더는 이름순, 노트는 받은 순서(고정·최근 순) 그대로. 없는 폴더를 가리키는 노트는 맨 위. */
export function folderTree(folders: NoteFolder[], notes: NoteRec[]): { folders: FolderNode[]; notes: NoteRec[] } {
  const ids = new Set(folders.map((f) => f.id))
  const live = notes.filter((n) => !n.deleted)
  const build = (parent: string | null): FolderNode[] =>
    folders
      .filter((f) => (f.parent && ids.has(f.parent) ? f.parent : null) === parent)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((folder) => {
        const sub = build(folder.id)
        const own = live.filter((n) => n.folder_id === folder.id)
        return { folder, folders: sub, notes: own, count: own.length + sub.reduce((s, x) => s + x.count, 0) }
      })
  return { folders: build(null), notes: live.filter((n) => !n.folder_id || !ids.has(n.folder_id)) }
}
