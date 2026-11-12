import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { NoteBlock } from '../../lib/db/types'
import { addCol, addRow, delCol, delRow, setCell, setWidths, tableWidths } from '../../lib/notes/tableOps'
import { startPointerDrag } from '../../lib/ui/pointerDrag'

/** 노트 표 블록: 칸 글 쓰기(Tab으로 옮겨 가기), 줄·칸 더하기·빼기, 칸 경계 끌어 너비, 머리 줄 */
export default function NoteTable({ b, onChange, onDelete, autoFocus }: { b: NoteBlock; onChange: (p: Partial<NoteBlock>) => void; onDelete: () => void; autoFocus?: boolean }) {
  const cells = b.cells ?? [['']]
  const ws = tableWidths(b)
  const box = useRef<HTMLTableElement>(null)
  const [at, setAt] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const want = useRef<{ r: number; c: number } | null>(autoFocus ? { r: 0, c: 0 } : null)
  const cellEl = (r: number, c: number) => box.current?.querySelector<HTMLTextAreaElement>(`textarea[data-rc="${r}-${c}"]`)
  useEffect(() => {
    const w = want.current
    if (!w) return
    want.current = null
    const el = cellEl(w.r, w.c)
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  })
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  const go = (r: number, c: number) => {
    want.current = { r, c }
    setAt({ r, c })
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>, r: number, c: number) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const rows = cells.length
    const cols = cells[0]?.length ?? 1
    const el = e.currentTarget
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) return c > 0 ? go(r, c - 1) : r > 0 ? go(r - 1, cols - 1) : undefined
      if (c < cols - 1) return go(r, c + 1)
      if (r < rows - 1) return go(r + 1, 0)
      // 마지막 칸에서 Tab: 줄 하나 더
      onChange(addRow(b, rows - 1))
      return go(rows, 0)
    }
    const before = el.value.slice(0, el.selectionStart ?? 0)
    const after = el.value.slice(el.selectionEnd ?? 0)
    if (e.key === 'ArrowUp' && !before.includes('\n') && r > 0) return (e.preventDefault(), go(r - 1, c))
    if (e.key === 'ArrowDown' && !after.includes('\n') && r < rows - 1) return (e.preventDefault(), go(r + 1, c))
  }
  /** 칸 경계(c와 c+1 사이) 끌기 */
  function beginResize(e: React.PointerEvent, c: number) {
    e.preventDefault()
    e.stopPropagation()
    const width = box.current?.getBoundingClientRect().width || 1
    const x0 = e.clientX
    const start = [...ws]
    startPointerDrag(e, {
      threshold: 1,
      onMove: (x) => {
        const d = ((x - x0) / width) * 100
        const next = [...start]
        next[c] = start[c] + d
        next[c + 1] = start[c + 1] - d
        if (next[c] < 6 || next[c + 1] < 6) return
        onChange(setWidths(b, next))
      },
    })
  }
  return (
    <div className="nb-table">
      <div className="nb-table-tools" role="toolbar" aria-label="표 도구">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange(addRow(b, at.r)), go(at.r + 1, at.c))}>줄 더하기</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} disabled={cells.length <= 1} onClick={() => (onChange(delRow(b, at.r)), go(Math.max(0, at.r - 1), at.c))}>줄 빼기</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange(addCol(b, at.c)), go(at.r, at.c + 1))}>칸 더하기</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} disabled={(cells[0]?.length ?? 1) <= 1} onClick={() => (onChange(delCol(b, at.c)), go(at.r, Math.max(0, at.c - 1)))}>칸 빼기</button>
        <button type="button" aria-pressed={!!b.head} className={b.head ? 'on' : undefined} onClick={() => onChange({ head: !b.head })}>머리 줄</button>
        <button type="button" className="danger-text" onClick={onDelete}>표 지우기</button>
      </div>
      <table ref={box} className={`nb-tbl${b.head ? ' has-head' : ''}`} aria-label="표">
        <colgroup>
          {ws.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <tbody>
          {cells.map((row, r) => (
            <tr key={r}>
              {row.map((t, c) => (
                <td key={c} className={at.r === r && at.c === c ? 'on' : undefined}>
                  <textarea
                    rows={1}
                    data-rc={`${r}-${c}`}
                    aria-label={`${r + 1}줄 ${c + 1}칸`}
                    value={t}
                    ref={grow}
                    onFocus={() => setAt({ r, c })}
                    onChange={(e) => {
                      grow(e.target)
                      onChange(setCell(b, r, c, e.target.value))
                    }}
                    onKeyDown={(e) => onKey(e, r, c)}
                  />
                  {c < row.length - 1 && <span className="nb-col-handle" {...(r === 0 ? { role: 'separator', 'aria-orientation': 'vertical' as const, 'aria-label': `${c + 1}칸 너비 바꾸기` } : { 'aria-hidden': true })} title="끌어서 칸 너비" onPointerDown={(e) => beginResize(e, c)} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
