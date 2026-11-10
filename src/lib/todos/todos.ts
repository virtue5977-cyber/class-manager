import type { AppDB } from '../db/schema'
import type { NoteRec, StudentRec, TodoPart, TodoRec } from '../db/types'
import { newRecord, save, scrubDelete } from '../db/records'

export async function addTodo(db: AppDB, parts: TodoPart[], due: string | null = null): Promise<TodoRec> {
  if (!parts.some((p) => (typeof p === 'string' ? p.trim() : true))) throw new Error('할 일을 입력하세요.')
  const order = (await db.todos.toArray()).reduce((m, t) => Math.max(m, t.order), -1) + 1
  const rec = newRecord({ parts, due, done: false, done_at: null, order }) as TodoRec
  await db.todos.add(rec)
  return rec
}

/** 미완료(마감일 있는 것 먼저, 마감일 순 → 순서) 다음에 완료(최근 완료 먼저). */
export async function listTodos(db: AppDB): Promise<TodoRec[]> {
  const all = (await db.todos.toArray()).filter((t) => !t.deleted)
  const open = all.filter((t) => !t.done).sort((a, b) => (a.due ?? '9999') .localeCompare(b.due ?? '9999') || a.order - b.order)
  const done = all.filter((t) => t.done).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))
  return [...open, ...done]
}

export async function setTodoDone(db: AppDB, id: string, done: boolean): Promise<void> {
  const cur = await db.todos.get(id)
  if (cur) await save(db.todos, { ...cur, done, done_at: done ? new Date().toISOString() : null })
}

export const deleteTodo = (db: AppDB, id: string) => scrubDelete(db.todos, id, { parts: [] }).then(() => undefined)

export async function todosLinkingNote(db: AppDB, noteId: string): Promise<TodoRec[]> {
  return (await listTodos(db)).filter((t) => t.parts.some((p) => typeof p === 'object' && 'note' in p && p.note === noteId))
}

/** 조각을 화면 글로: 노트는 지금 제목(지운 노트는 흐리게), 학생은 '3번 박도윤'. */
export function renderParts(parts: TodoPart[], notes: Map<string, NoteRec>, students: Map<string, StudentRec>): { text: string; to?: string; dead?: boolean }[] {
  return parts.map((p) => {
    if (typeof p === 'string') return { text: p }
    if ('note' in p) {
      const n = notes.get(p.note)
      return n && !n.deleted ? { text: n.title || '제목 없음', to: `/notes?id=${n.id}` } : { text: '지운 노트', dead: true }
    }
    const s = students.get(p.student)
    return s && !s.deleted ? { text: `${s.number}번 ${s.name}`, to: `/counseling?sid=${s.id}` } : { text: '없는 학생', dead: true }
  })
}
