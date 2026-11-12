import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { applySuggestion, suggest, type Suggestion } from '../../lib/command/suggest'
import { describe, parseCommand } from '../../lib/command/parse'
import { COMMAND_META, commandLabel, commandNames, commandSubs } from '../../lib/command/registry'
import { executeInput, type Executed } from '../../lib/command/run'
import { aiFallback } from '../../lib/command/ai'
import { useCommandCtx } from './useCommandCtx'
import { remember, undoLast } from './session'
import { addPending, enqueue, removePending, resolvePending } from '../../lib/command/pending'
import { currentThread } from '../../lib/command/chatThreads'

const history: string[] = []

/** 명령 입력 막대: 자동완성 · 알아들은 내용 한 줄 · 실행. */
export default function CommandBar({ onRan, autoFocus, onEscape, inputRef, today }: { onRan?: (r: Executed) => void; autoFocus?: boolean; onEscape?: () => void; inputRef?: React.RefObject<HTMLInputElement>; today?: string }) {
  const { ctx, env } = useCommandCtx(today)
  const own = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? own
  const [value, setValue] = useState('')
  const [caret, setCaret] = useState(0)
  const [sel, setSel] = useState(0)
  const [closed, setClosed] = useState(false)
  const [undoNote, setUndoNote] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [hist, setHist] = useState(-1)

  // 학급을 읽어 입력 칸이 켜진 뒤에 커서를 둔다.
  const ready = !!env
  useEffect(() => {
    // 다른 칸에 이미 쓰고 있으면 초점을 빼앗지 않는다
    const busyElsewhere = document.activeElement && document.activeElement !== document.body && document.activeElement !== ref.current
    if (autoFocus && ready && !busyElsewhere) ref.current?.focus()
  }, [autoFocus, ready, ref])

  const list: Suggestion[] = useMemo(() => (closed || !value ? [] : suggest(value, caret, { ...ctx, commands: COMMAND_META })), [value, caret, ctx, closed])
  const parsed = useMemo(() => (value.trim().startsWith('/') ? parseCommand(value, ctx, commandNames(), commandSubs()) : null), [value, ctx])
  const problem = parsed?.errors[0] ?? (parsed?.ambiguous[0] ? `'${parsed.ambiguous[0]}'에 맞는 학생이 여럿입니다 · @를 눌러 고르세요` : parsed?.missing[0] ? `'${parsed.missing[0]}' 학생을 찾지 못했습니다 · @를 눌러 고르세요` : null)

  /** 값 바꾸기. moveCaret은 후보 넣기·기록 불러오기 때만(입력 중에 커서를 옮기면 한글 조합이 깨진다). */
  const set = (v: string, c = v.length, moveCaret = false) => {
    setValue(v)
    setCaret(c)
    setSel(0)
    setClosed(false)
    setUndoNote(undefined)
    if (moveCaret) requestAnimationFrame(() => ref.current?.setSelectionRange(c, c))
  }
  const pick = (s: Suggestion) => {
    const r = applySuggestion(value, caret, s)
    set(r.value, r.caret, true)
  }
  /** 보내면 입력 칸은 바로 비우고 내 말을 대화에 올린다. 실행은 줄 세워 차례로. */
  async function run() {
    const input = value
    if (!input.trim() || !env) return
    const thread = currentThread()
    const pid = addPending({ input: input.trim(), thread })
    history.unshift(input)
    set('')
    setHist(-1)
    setBusy(true)
    let done = false
    try {
      const r = await enqueue(() => executeInput(input, ctx, env, aiFallback, thread))
      resolvePending(pid, r.chat.id)
      done = true
      remember(r.chat.id, r.result)
      onRan?.(r)
    } finally {
      if (!done) removePending(pid)
      setBusy(false)
    }
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // 입력 칸이 비었을 때 Ctrl+Z: 방금 실행한 명령 되돌리기(글 쓰는 중에는 보통 되돌리기)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !value) {
      e.preventDefault()
      void undoLast().then((sum) => setUndoNote(sum ? `되돌렸습니다: ${sum}` : '되돌릴 명령이 없습니다(5초가 지났거나 이미 되돌림).'))
      return
    }
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault()
      setSel((i) => (i + 1) % list.length)
    } else if (e.key === 'ArrowUp' && list.length) {
      e.preventDefault()
      setSel((i) => (i - 1 + list.length) % list.length)
    } else if (e.key === 'ArrowUp' && (!value || hist >= 0) && history.length) {
      e.preventDefault()
      const h = Math.min(hist + 1, history.length - 1)
      setHist(h)
      set(history[h], history[h].length, true)
      setClosed(true)
    } else if ((e.key === 'Enter' || e.key === 'Tab') && list.length) {
      e.preventDefault()
      pick(list[sel])
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run()
    } else if (e.key === 'Escape') {
      if (list.length) setClosed(true)
      else onEscape?.()
    }
  }
  return (
    <div className="command-bar">
      {list.length > 0 && (
        <ul className="suggest" role="listbox" aria-label="자동완성">
          {list.map((s, i) => (
            <li key={s.kind + s.label} role="option" aria-selected={i === sel} className={i === sel ? 'on' : undefined} onMouseDown={(e) => (e.preventDefault(), pick(s))}>
              <span className={`sg-kind sg-${s.kind}`} aria-hidden="true">{s.kind === 'note' ? '📄' : s.kind === 'student' ? '@' : s.kind === 'cmd' ? '' : s.kind === 'tag' ? '#' : '·'}</span>
              <span className="pii">{s.label}</span>
              {s.detail && <span className="muted">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="command-input">
        <input
          ref={ref}
          aria-label="명령 입력"
          placeholder={env ? '/빠른 실행 · !AI 실행 · @학생·노트 — 모르면 /설명서' : '먼저 학급을 만드세요'}
          value={value}
          disabled={!env}
          onChange={(e) => set(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={onKey}
          onBlur={() => setClosed(true)}
          onFocus={() => setClosed(false)}
          role="combobox"
          aria-expanded={list.length > 0}
          aria-autocomplete="list"
        />
        <button type="button" className="primary" disabled={!value.trim() || !env} onClick={run}>
          {busy ? '보내기' : '실행'}
        </button>
      </div>
      {/* 명령 이름을 아직 치는 중(후보가 열림)이면 오류 대신 안내 */}
      {!parsed?.cmd && /^\/\S*$/.test(value.trim()) && (list.length > 0 || Object.keys(commandNames()).some((n) => `/${n}`.startsWith(value.trim()))) ? (
        <p className="command-preview muted">{list.length ? '↑↓로 고르고 Enter' : '명령 이름을 이어 쓰거나 칸을 눌러 고르세요'}</p>
      ) : problem ? (
        <p className="command-problem" role="alert">{problem}</p>
      ) : parsed?.cmd ? (
        <p className="command-preview" role="status">{describe(parsed, commandLabel)}</p>
      ) : undoNote ? (
        <p className="command-preview" role="status">{undoNote}</p>
      ) : (
        <p className="command-preview" aria-hidden="true">{'\u00a0'}</p>
      )}
    </div>
  )
}
