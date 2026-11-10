import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../../app/context'
import type { NoteRec, StudentRec, TodoRec } from '../../lib/db/types'
import { addTodo, deleteTodo, listTodos, renderParts, setTodoDone } from '../../lib/todos/todos'
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
  const [caret, setCaret] = useState(0)
  const [sel, setSel] = useState(0)
  const [err, setErr] = useState<string>()
  const ref = useRef<HTMLInputElement>(null)
  const list = text.slice(0, caret).match(/@\S*$/) ? suggest(text, caret, { ...ctx, commands: [] }) : []
  const pick = (i: number) => {
    const r = applySuggestion(text, caret, list[i])
    setText(r.value)
    setCaret(r.caret)
    setSel(0)
    requestAnimationFrame(() => ref.current?.setSelectionRange(r.caret, r.caret))
  }
  async function add() {
    if (!text.trim()) return
    const p = parseCommand(`/할일 ${text}`, ctx, commandNames(), commandSubs())
    try {
      await addTodo(db, p.parts, p.dateGiven ? p.date : null)
      setText('')
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
  return (
    <section className="panel-card" aria-label="할 일">
      <h3>할 일</h3>
      <ul className="plain todo-list">
        {todos.map((t) => {
          const parts = renderParts(t.parts, notes, studs)
          const label = parts.map((p) => p.text).join('')
          return (
            <li key={t.id} className={t.done ? 'done' : undefined}>
              <input type="checkbox" aria-label={label} checked={t.done} onChange={(e) => setTodoDone(db, t.id, e.target.checked)} />
              <span className="todo-text pii">
                {parts.map((p, i) => (p.to ? <Link key={i} to={p.to}>{p.text}</Link> : p.dead ? <span key={i} className="dead" title="지운 노트입니다">{p.text}</span> : <span key={i}>{p.text}</span>))}
              </span>
              {t.due && <span className={`todo-due${!t.done && t.due < ctx.today ? ' late' : ''}`}>{shortDate(t.due)}</span>}
              <button type="button" className="icon-btn" aria-label={`${label} 지우기`} onClick={() => deleteTodo(db, t.id)}>×</button>
            </li>
          )
        })}
      </ul>
      <div className="todo-add">
        {list.length > 0 && (
          <ul className="suggest" role="listbox" aria-label="연결할 학생·노트">
            {list.map((s, i) => (
              <li key={s.kind + s.label} role="option" aria-selected={i === sel} className={i === sel ? 'on' : undefined} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                <span className="sg-kind" aria-hidden="true">{s.kind === 'note' ? '📄' : '@'}</span>
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
          placeholder="할 일 — @로 노트·학생 연결, '내일'은 마감일"
          value={text}
          onChange={(e) => {
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
