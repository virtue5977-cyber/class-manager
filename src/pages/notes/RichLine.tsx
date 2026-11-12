import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { applyStyle, shiftLinks, shiftMarks, type Mark, type NoteLink } from '../../lib/notes/marks'
import { atLineEdge, getSel, readText, renderHtml, setSel } from '../../lib/notes/richDom'

/** 노트 편집기가 쓰는 한 줄 손잡이(예전 textarea와 같은 이름) */
export interface LineHandle {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly el: HTMLDivElement | null
  focus(): void
  setSelectionRange(start: number, end: number): void
  /** 커서가 화면상 첫(-1)·마지막(1) 줄인지 */
  atEdge(dir: -1 | 1): boolean
}

export interface LineValue {
  text: string
  marks?: Mark[]
  links?: NoteLink[]
}

interface Props {
  text: string
  marks?: Mark[]
  links?: NoteLink[]
  label: string
  placeholder?: string
  className?: string
  /** 글이 바뀜(caret: 바뀐 뒤 커서) */
  onChange(v: LineValue, caret: number): void
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>, h: LineHandle): void
  /** 링크(Ctrl+클릭) */
  onOpenLink?(noteId: string): void
  onSelect?(): void
  onFocus?(): void
}

const SHORT: Record<string, 'b' | 'u' | 'i'> = { KeyB: 'b', KeyU: 'u', KeyI: 'i' }

/** 서식이 보이는 한 줄 편집 칸. DOM은 직접 그리고(innerHTML), 입력이 오면 글을 읽어 서식 위치를 옮긴다. 한글 조합 중에는 다시 그리지 않는다. */
const RichLine = forwardRef<LineHandle, Props>(function RichLine(p, ref) {
  const el = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const want = useRef<{ start: number; end: number } | null>(null)
  const html = useMemo(() => renderHtml(p.text, p.marks, p.links), [p.text, p.marks, p.links])
  const props = useRef(p)
  props.current = p

  useLayoutEffect(() => {
    const d = el.current
    if (!d || composing.current) return
    const focused = d.ownerDocument.activeElement === d
    if (d.innerHTML !== html) {
      const sel = focused ? getSel(d) : null
      d.innerHTML = html
      if (sel) setSel(d, Math.min(sel.start, p.text.length), Math.min(sel.end, p.text.length))
    }
    if (want.current && focused) {
      setSel(d, want.current.start, want.current.end)
      want.current = null
    }
  })

  const handle = useMemo<LineHandle>(
    () => ({
      get value() {
        return props.current.text
      },
      get selectionStart() {
        const d = el.current
        return d ? (getSel(d)?.start ?? props.current.text.length) : 0
      },
      get selectionEnd() {
        const d = el.current
        return d ? (getSel(d)?.end ?? props.current.text.length) : 0
      },
      get el() {
        return el.current
      },
      focus() {
        el.current?.focus()
      },
      setSelectionRange(start: number, end: number) {
        const d = el.current
        if (!d) return
        if (d.ownerDocument.activeElement !== d) d.focus()
        want.current = null
        setSel(d, start, end)
      },
      atEdge(dir: -1 | 1) {
        return el.current ? atLineEdge(el.current, dir) : true
      },
    }),
    [],
  )
  useImperativeHandle(ref, () => handle, [handle])

  /** DOM 글을 읽어 바뀌었으면 알린다 */
  function commit() {
    const d = el.current
    if (!d) return
    const cur = props.current
    const t = readText(d)
    if (t === cur.text) return
    const sel = getSel(d)
    cur.onChange({ text: t, marks: shiftMarks(cur.marks, cur.text, t), links: shiftLinks(cur.links, cur.text, t) }, sel?.end ?? t.length)
  }
  /** 고른 자리에 글 넣기(붙여넣기·Shift+Enter) */
  function insert(s: string) {
    const d = el.current
    if (!d) return
    const cur = props.current
    const sel = getSel(d) ?? { start: cur.text.length, end: cur.text.length }
    const t = cur.text.slice(0, sel.start) + s + cur.text.slice(sel.end)
    want.current = { start: sel.start + s.length, end: sel.start + s.length }
    cur.onChange({ text: t, marks: shiftMarks(cur.marks, cur.text, t), links: shiftLinks(cur.links, cur.text, t) }, sel.start + s.length)
  }

  return (
    <div
      ref={el}
      role="textbox"
      aria-multiline="true"
      aria-label={p.label}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={p.placeholder || undefined}
      className={`nb-text${p.text ? '' : ' is-empty'}${p.className ? ` ${p.className}` : ''}`}
      onInput={() => {
        if (!composing.current) commit()
        else {
          // 조합 중에도 글은 알린다(다시 그리지는 않음)
          commit()
        }
      }}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={() => {
        composing.current = false
        commit()
      }}
      onBeforeInput={(e) => {
        const t = (e.nativeEvent as InputEvent).inputType
        // 브라우저의 굵게·기울임 등(태그를 넣는다)은 막고 우리 서식으로
        if (t && t.startsWith('format')) e.preventDefault()
      }}
      onPaste={(e) => {
        e.preventDefault()
        const s = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
        if (s) insert(s)
      }}
      onDrop={(e) => {
        // 글 끌어 놓기는 받지 않는다(파일은 편집기가 받는다)
        if (!e.dataTransfer?.files?.length) e.preventDefault()
      }}
      onFocus={() => p.onFocus?.()}
      onSelect={() => p.onSelect?.()}
      onKeyUp={() => p.onSelect?.()}
      onMouseUp={() => p.onSelect?.()}
      onClick={(e) => {
        const a = (e.target as Element).closest?.('.nl') as HTMLElement | null
        if (a && (e.ctrlKey || e.metaKey) && a.dataset.note) {
          e.preventDefault()
          p.onOpenLink?.(a.dataset.note)
        }
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        const mod = e.ctrlKey || e.metaKey
        const k = SHORT[e.code] ?? (mod && /^[bui]$/i.test(e.key) ? (e.key.toLowerCase() as 'b' | 'u' | 'i') : undefined)
        if (mod && !e.altKey && !e.shiftKey && k) {
          e.preventDefault()
          const d = el.current!
          const sel = getSel(d)
          if (sel && sel.start !== sel.end) {
            const cur = props.current
            want.current = sel
            cur.onChange({ text: cur.text, marks: applyStyle(cur.marks, cur.text.length, sel.start, sel.end, k), links: cur.links }, sel.end)
          }
          return
        }
        if (e.key === 'Enter' && e.shiftKey && !mod) {
          e.preventDefault()
          insert('\n')
          return
        }
        p.onKeyDown?.(e, handle)
        // 브라우저가 줄(div)을 넣지 않게
        if (e.key === 'Enter' && !e.defaultPrevented) e.preventDefault()
      }}
    />
  )
})

export default RichLine
