import Icon from '../../components/Icon'
import { useState } from 'react'
import type { NoteBlock, NoteBlockType } from '../../lib/db/types'
import { COLORS, FONTS, HIGHLIGHTS, PT_MAX, PT_MIN, type Style } from '../../lib/notes/marks'

export type MarkKey = 'b' | 'u' | 'i' | 's' | 'color' | 'bg' | 'font' | 'pt'
export type InsertKind = 'table' | 'image' | 'divider' | 'pagebreak' | 'file'

const TYPES: { type: NoteBlockType; label: string }[] = [
  { type: 'p', label: '바탕글' },
  { type: 'h1', label: '제목 1' },
  { type: 'h2', label: '제목 2' },
  { type: 'bullet', label: '글머리' },
  { type: 'number', label: '번호' },
  { type: 'check', label: '체크' },
]
const ALIGNS: { v: NonNullable<NoteBlock['align']>; label: string; ico: string }[] = [
  { v: 'left', label: '왼쪽 정렬', ico: 'M4 6h16M4 10h10M4 14h16M4 18h10' },
  { v: 'center', label: '가운데 정렬', ico: 'M4 6h16M7 10h10M4 14h16M7 18h10' },
  { v: 'right', label: '오른쪽 정렬', ico: 'M4 6h16M10 10h10M4 14h16M10 18h10' },
  { v: 'justify', label: '양쪽 정렬', ico: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
]
const basePt = (t?: NoteBlockType) => (t === 'h1' ? 16 : t === 'h2' ? 13 : 10)
const Svg = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

/** 노트 위쪽 도구 막대(두 줄): 넣기·문단 / 글자·정렬. 단추는 누를 때 커서를 놓치지 않게(mousedown 막음). */
export default function NoteToolbar(p: {
  block?: NoteBlock
  /** 고른 글(없으면 커서 앞 글자 + 다음에 칠 서식) */
  style: Style
  onType: (t: NoteBlockType) => void
  onIndent: (dir: 1 | -1) => void
  onAlign: (a: NonNullable<NoteBlock['align']>) => void
  onLine: (n: 130 | 160 | 200) => void
  onMark: (k: MarkKey, v?: string | number) => void
  onInsert: (k: InsertKind, o?: { rows: number; cols: number }) => void
  onUndo: () => void
  onRedo: () => void
  /** 쪽 메뉴 등 오른쪽 끝에 붙일 것 */
  extra?: React.ReactNode
}) {
  const [open, setOpen] = useState<'color' | 'bg' | 'font' | 'table'>()
  const [grid, setGrid] = useState({ r: 2, c: 2 })
  const keep = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('input, select')) e.preventDefault()
  }
  const b = p.block
  const pt = p.style.pt ?? basePt(b?.type)
  const setPt = (n: number) => p.onMark('pt', Math.max(PT_MIN, Math.min(PT_MAX, Math.round(n * 2) / 2)))
  const tog = (k: 'b' | 'i' | 'u' | 's', label: string, text: React.ReactNode) => (
    <button type="button" className={`tb-btn${p.style[k] ? ' on' : ''}`} aria-label={label} aria-pressed={!!p.style[k]} title={label} onClick={() => p.onMark(k)}>
      {text}
    </button>
  )
  const textish = !b || ['p', 'h1', 'h2', 'bullet', 'number', 'check'].includes(b.type)
  return (
    <div className="note-toolbar" role="toolbar" aria-label="노트 도구" onMouseDown={keep}>
      <div className="tb-row">
        <select aria-label="문단 모양" value={textish ? (b?.type ?? 'p') : ''} disabled={!textish} onChange={(e) => p.onType(e.target.value as NoteBlockType)}>
          {!textish && <option value="">—</option>}
          {TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" className="tb-btn" aria-label="수준 올리기(내어쓰기)" title="수준 올리기(Shift+Tab)" onClick={() => p.onIndent(-1)}>
          <Svg d="M20 6H9M20 12H9M20 18H9M6 9l-3 3 3 3" />
        </button>
        <button type="button" className="tb-btn" aria-label="수준 내리기(들여쓰기)" title="수준 내리기(Tab)" onClick={() => p.onIndent(1)}>
          <Svg d="M20 6H9M20 12H9M20 18H9M3 9l3 3-3 3" />
        </button>
        <span className="tb-sep" />
        <span className="tb-pop">
          <button type="button" className="tb-btn tb-labeled" aria-label="표 넣기" aria-expanded={open === 'table'} onClick={() => setOpen(open === 'table' ? undefined : 'table')}>
            <Svg d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14" />
            <span>표</span>
          </button>
          {open === 'table' && (
            <span className="tb-menu tb-grid" role="group" aria-label="표 칸 고르기">
              <span className="tb-grid-cells" onMouseLeave={() => setGrid({ r: 2, c: 2 })}>
                {Array.from({ length: 8 }, (_, r) =>
                  Array.from({ length: 8 }, (_, c) => (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      aria-label={`${r + 1}줄 ${c + 1}칸 표`}
                      className={r < grid.r && c < grid.c ? 'on' : undefined}
                      onMouseEnter={() => setGrid({ r: r + 1, c: c + 1 })}
                      onClick={() => (p.onInsert('table', { rows: r + 1, cols: c + 1 }), setOpen(undefined))}
                    />
                  )),
                )}
              </span>
              <span className="muted">{`${grid.r}줄 × ${grid.c}칸`}</span>
            </span>
          )}
        </span>
        <button type="button" className="tb-btn tb-labeled" aria-label="그림 넣기" onClick={() => p.onInsert('image')}>
          <Svg d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" />
          <span>그림</span>
        </button>
        <button type="button" className="tb-btn tb-labeled" aria-label="구분선 넣기" onClick={() => p.onInsert('divider')}>
          <Svg d="M4 12h16" />
          <span>구분선</span>
        </button>
        <button type="button" className="tb-btn tb-labeled" aria-label="쪽 나누기" title="여기서 다음 쪽으로" onClick={() => p.onInsert('pagebreak')}>
          <Svg d="M6 3v6h12V3M6 21v-6h12v6M3 12h3M9 12h2M13 12h2M18 12h3" />
          <span>쪽 나누기</span>
        </button>
        <button type="button" className="tb-btn tb-labeled" aria-label="파일 붙이기" onClick={() => p.onInsert('file')}>
          <Svg d="M15 7l-6.5 6.5a2 2 0 0 0 2.8 2.8L18 9.6a4 4 0 0 0-5.7-5.7L5.6 10.6a6 6 0 0 0 8.5 8.5L20 13" />
          <span>파일</span>
        </button>
        <span className="tb-sep" />
        <button type="button" className="tb-btn" aria-label="되돌리기" title="되돌리기(Ctrl+Z)" onClick={p.onUndo}>
          <Svg d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" />
        </button>
        <button type="button" className="tb-btn" aria-label="다시 하기" title="다시 하기(Ctrl+Y)" onClick={p.onRedo}>
          <Svg d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12" />
        </button>
        <span className="tb-grow" />
        {p.extra}
      </div>
      <div className="tb-row">
        <span className="tb-pop">
          <button type="button" className="tb-btn tb-font" aria-label="글꼴" aria-expanded={open === 'font'} onClick={() => setOpen(open === 'font' ? undefined : 'font')}>
            <span style={p.style.font ? { fontFamily: `'${p.style.font}'` } : undefined}>{p.style.font ?? '기본 글꼴'}</span> ▾
          </button>
          {open === 'font' && (
            <span className="tb-menu" role="menu" aria-label="글꼴 고르기">
              <button type="button" role="menuitem" onClick={() => (p.style.font && p.onMark('font', p.style.font), setOpen(undefined))}>
                기본 글꼴
              </button>
              {FONTS.map((f) => (
                <button key={f} type="button" role="menuitem" className={p.style.font === f ? 'on' : undefined} style={{ fontFamily: `'${f}'` }} onClick={() => (p.onMark('font', f), setOpen(undefined))}>
                  {f}
                </button>
              ))}
            </span>
          )}
        </span>
        <span className="tb-pt">
          <input
            aria-label="글자 크기(pt)"
            inputMode="decimal"
            key={pt}
            defaultValue={pt}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') (e.preventDefault(), setPt(Number((e.target as HTMLInputElement).value) || pt))
              if (e.key === 'ArrowUp') (e.preventDefault(), setPt(pt + 1))
              if (e.key === 'ArrowDown') (e.preventDefault(), setPt(pt - 1))
            }}
            onBlur={(e) => Number(e.target.value) && Number(e.target.value) !== pt && setPt(Number(e.target.value))}
          />
          <span className="tb-pt-unit">pt</span>
          <span className="tb-pt-step">
            <button type="button" aria-label="글자 크게" onClick={() => setPt(pt + 1)}><Icon name="chevronUp" size={12} /></button>
            <button type="button" aria-label="글자 작게" onClick={() => setPt(pt - 1)}><Icon name="chevronDown" size={12} /></button>
          </span>
        </span>
        <span className="tb-sep" />
        {tog('b', '굵게(Ctrl+B)', <b>가</b>)}
        {tog('i', '기울임(Ctrl+I)', <i>가</i>)}
        {tog('u', '밑줄(Ctrl+U)', <u>간</u>)}
        {tog('s', '취소선', <s>가</s>)}
        <span className="tb-pop">
          <button type="button" className="tb-btn" aria-label="글자색" aria-expanded={open === 'color'} onClick={() => setOpen(open === 'color' ? undefined : 'color')}>
            <span className="tb-color" style={{ borderBottomColor: p.style.color ?? 'currentColor' }}>가</span>
          </button>
          {open === 'color' && (
            <span className="tb-menu tb-swatches" role="menu" aria-label="글자색 고르기">
              {COLORS.map((c) => (
                <button key={c} type="button" role="menuitem" aria-label={`글자색 ${c}`} className={p.style.color === c ? 'on' : undefined} style={{ background: c }} onClick={() => (p.onMark('color', c), setOpen(undefined))} />
              ))}
            </span>
          )}
        </span>
        <span className="tb-pop">
          <button type="button" className="tb-btn" aria-label="형광펜" aria-expanded={open === 'bg'} onClick={() => setOpen(open === 'bg' ? undefined : 'bg')}>
            <span className="tb-hl" style={{ background: p.style.bg ?? HIGHLIGHTS[0] }}>가</span>
          </button>
          {open === 'bg' && (
            <span className="tb-menu tb-swatches" role="menu" aria-label="형광펜 고르기">
              {HIGHLIGHTS.map((c) => (
                <button key={c} type="button" role="menuitem" aria-label={`형광펜 ${c}`} className={p.style.bg === c ? 'on' : undefined} style={{ background: c }} onClick={() => (p.onMark('bg', c), setOpen(undefined))} />
              ))}
            </span>
          )}
        </span>
        <span className="tb-sep" />
        {ALIGNS.map((a) => (
          <button key={a.v} type="button" className={`tb-btn${(b?.align ?? 'justify') === a.v ? ' on' : ''}`} aria-label={a.label} aria-pressed={(b?.align ?? 'justify') === a.v} title={a.label} onClick={() => p.onAlign(a.v)}>
            <Svg d={a.ico} />
          </button>
        ))}
        <select aria-label="줄 간격" value={b?.line ?? 160} onChange={(e) => p.onLine(Number(e.target.value) as 130 | 160 | 200)}>
          <option value={130}>줄 간격 130%</option>
          <option value={160}>줄 간격 160%</option>
          <option value={200}>줄 간격 200%</option>
        </select>
      </div>
    </div>
  )
}
