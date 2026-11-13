import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../../app/context'
import type { NoteRec, StudentRec, TodoRec } from '../../lib/db/types'
import { addTodo, deleteTodo, listTodos, renderParts, reorderTodos, setTodoDone, updateTodo } from '../../lib/todos/todos'
import { dropIndex, reorderIds, startPointerDrag } from '../../lib/ui/pointerDrag'
import Icon from '../../components/Icon'
import { applySuggestion, suggest } from '../../lib/command/suggest'
import { parseCommand, type ParseCtx } from '../../lib/command/parse'
import { commandNames, commandSubs } from '../../lib/command/registry'
import { shortDate } from '../../lib/command/dates'
import { useLive } from '../../lib/ui/useLive'

/** 할 일: 체크·지우기·추가(@로 학생·노트 연결, '내일' 같은 날짜 말은 마감일). */
export default function TodoList({ ctx }: { ctx: ParseCtx }) {
  const db = useDb()
  const todos = useLive<TodoRec[]>(() => listTodos(db), [db], [])
  const notes = useMemo(() => new Map<string, NoteRec>(ctx.notes.map((n) => [n.id, n])), [ctx.notes])
  const studs = useMemo(() => new Map<string, StudentRec>(ctx.students.map((s) => [s.id, s])), [ctx.students])
  const [text, setText] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  /** 고치는 중인 할 일 */
  const [edit, setEdit] = useState<{ id: string; text: string; due: string }>()
  const [dragId, setDragId] = useState<string>()
  const [dropAt, setDropAt] = useState<number>()
  const [caret, setCaret] = useState(0)
  const [sel, setSel] = useState(0)
  const [err, setErr] = useState<string>()
  const ref = useRef<HTMLInputElement>(null)
  // 할 일의 @는 노트만(학생 이름은 후보에 넣지 않는다)
  const noteCtx = useMemo(() => ({ ...ctx, students: [] }), [ctx])
  const [open, setOpen] = useState(true)
  const list = open && text.slice(0, caret).match(/@\S*$/) ? suggest(text, caret, { ...noteCtx, commands: [] }).filter((x) => x.kind === 'note') : []
  const pick = (i: number) => {
    const r = applySuggestion(text, caret, list[i])
    setText(r.value)
    setCaret(r.caret)
    setSel(0)
    requestAnimationFrame(() => ref.current?.setSelectionRange(r.caret, r.caret))
  }
  async function add() {
    if (!text.trim()) return
    const p = parseCommand(`/할일 ${text}`, noteCtx, commandNames(), commandSubs())
    const bad = p.missing[0] ?? p.ambiguous[0]
    if (bad !== undefined) return setErr(`'${bad}' 노트를 찾지 못했습니다.`)
    try {
      await addTodo(db, p.parts, p.dateGiven ? p.date : null)
      setText('')
      setErr(undefined)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  /** 고친 글 저장: '@노트' 는 다시 노트 연결로, 날짜 말이 있으면 마감일로 */
  async function saveEdit() {
    if (!edit) return
    // 고칠 때는 학생 연결(@번호)도 다시 읽는다
    const p = parseCommand(`/할일 ${edit.text}`, ctx, commandNames(), commandSubs())
    const bad = p.missing[0] ?? p.ambiguous[0]
    if (bad !== undefined) return setErr(`'${bad}' 노트를 찾지 못했습니다.`)
    try {
      await updateTodo(db, edit.id, { parts: p.parts, due: p.dateGiven ? p.date : edit.due || null })
      setEdit(undefined)
      setErr(undefined)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
    } else if (list.length && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      pick(sel)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  }
  const openIds = todos.filter((t) => !t.done).map((t) => t.id)
  /** 손잡이를 끌어 미완료 할 일 순서 바꾸기 */
  function beginDrag(e: React.PointerEvent, id: string) {
    e.preventDefault()
    const mids = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('li[data-id]') ?? []).filter((li) => openIds.includes(li.dataset.id!)).map((li) => { const r = li.getBoundingClientRect(); return r.top + r.height / 2 })
    let at = -1
    startPointerDrag(e, {
      onStart: () => setDragId(id),
      onMove: (_x, y) => { at = dropIndex(mids(), y); setDropAt(at) },
      onDrop: () => { setDragId(undefined); setDropAt(undefined); if (at >= 0) void reorderTodos(db, reorderIds(openIds, id, at)) },
      onCancel: () => { setDragId(undefined); setDropAt(undefined) },
    })
  }
  return (
    <section className="panel-card" aria-label="할 일">
      <h3>할 일</h3>
      <ul className="plain todo-list" ref={listRef}>
        {todos.map((t, idx) => {
          const parts = renderParts(t.parts, notes, studs)
          const label = parts.map((p) => p.text).join('')
          return (
            <li key={t.id} data-id={t.id} className={`${t.done ? 'done' : ''}${dragId === t.id ? ' dragging' : ''}${dropAt === idx ? ' drop-before' : ''}${dropAt === idx + 1 && idx === openIds.length - 1 ? ' drop-after' : ''}`}>
              {!t.done && (
                <span className="drag-grip" role="button" tabIndex={-1} aria-label={`${label} 끌어서 순서 바꾸기`} title="끌어서 순서 바꾸기" onPointerDown={(e) => beginDrag(e, t.id)}>
                  <Icon name="grip" size={14} />
                </span>
              )}
              <input type="checkbox" aria-label={label} checked={t.done} onChange={(e) => setTodoDone(db, t.id, e.target.checked)} />
              {edit?.id === t.id ? (
                <span className="todo-edit">
                  <input
                    autoFocus
                    aria-label="할 일 고치기"
                    value={edit.text}
                    onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return
                      if (e.key === 'Enter') (e.preventDefault(), void saveEdit())
                      if (e.key === 'Escape') (e.preventDefault(), setEdit(undefined))
                    }}
                  />
                  <input type="date" aria-label="마감일" value={edit.due} onChange={(e) => setEdit({ ...edit, due: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void saveEdit())} />
                  <button type="button" className="link" onClick={() => void saveEdit()}>저장</button>
                  <button type="button" className="link" onClick={() => setEdit(undefined)}>취소</button>
                </span>
              ) : (
                <>
                  <span className="todo-text pii" onDoubleClick={() => setEdit({ id: t.id, text: editText(t.parts, notes, studs), due: t.due ?? '' })}>
                    {parts.map((p, i) => (p.to ? <Link key={i} to={p.to}>{p.text}</Link> : p.dead ? <span key={i} className="dead" title="지운 노트입니다">{p.text}</span> : <span key={i}>{p.text}</span>))}
                  </span>
                  {t.due && <span className={`todo-due${!t.done && t.due < ctx.today ? ' late' : ''}`}>{shortDate(t.due)}</span>}
                  <button type="button" className="icon-btn row-edit" aria-label={`${label} 고치기`} title="고치기(두 번 눌러도 됨)" onClick={() => setEdit({ id: t.id, text: editText(t.parts, notes, studs), due: t.due ?? '' })}>
                    <Icon name="pencil" size={13} />
                  </button>
                </>
              )}
              <button type="button" className="icon-btn" aria-label={`${label} 지우기`} onClick={() => deleteTodo(db, t.id)}>×</button>
            </li>
          )
        })}
      </ul>
      <div className="todo-add">
        {list.length > 0 && (
          <ul className="suggest" role="listbox" aria-label="연결할 노트">
            {list.map((s, i) => (
              <li key={s.kind + s.label} role="option" aria-selected={i === sel} className={i === sel ? 'on' : undefined} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                <span className="sg-kind" aria-hidden="true">{s.kind === 'note' ? <Icon name="note" size={14} /> : '@'}</span>
                <span className="pii">{s.label}</span>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={ref}
          role="combobox"
          aria-label="할 일 추가"
          aria-expanded={list.length > 0}
          placeholder="할 일 — @로 노트 연결, '내일'은 마감일"
          value={text}
          onBlur={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setOpen(true)
            setText(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setSel(0)
          }}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={onKey}
        />
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  )
}

/** 고칠 글: 노트 연결은 '@노트제목', 학생 연결은 '@번호'로 되돌린다(저장 때 다시 연결). 지운 노트 연결은 뺀다. */
function editText(parts: TodoRec['parts'], notes: Map<string, { title: string }>, studs: Map<string, StudentRec>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : 'note' in p ? (notes.get(p.note) ? `@${notes.get(p.note)!.title}` : '') : studs.get(p.student) ? `@${studs.get(p.student)!.number}` : ''))
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
