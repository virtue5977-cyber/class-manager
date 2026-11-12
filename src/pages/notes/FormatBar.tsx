import { useEffect, useState } from 'react'
import { COLORS, FONTS, HIGHLIGHTS, type Style } from '../../lib/notes/marks'

type Key = 'b' | 'u' | 'i' | 's' | 'color' | 'bg' | 'font' | 'size'

/** 글자를 고르면 위에 뜨는 서식 막대. 단추는 누를 때 고른 글을 놓치지 않게(mousedown 막음). */
export default function FormatBar({ style, top, left, onApply, onClose }: { style: Style; top: number; left: number; onApply: (k: Key, v?: string) => void; onClose: () => void }) {
  const [open, setOpen] = useState<'color' | 'bg' | 'font' | 'size'>()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  const keep = (e: React.MouseEvent) => e.preventDefault()
  const btn = (k: 'b' | 'u' | 'i' | 's', label: string, text: React.ReactNode) => (
    <button type="button" className={`fb-btn${style[k] ? ' on' : ''}`} aria-label={label} aria-pressed={!!style[k]} title={label} onMouseDown={keep} onClick={() => onApply(k)}>
      {text}
    </button>
  )
  const y = Math.max(8, top - 44)
  const x = Math.max(8, Math.min(left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 360))
  return (
    <div className="format-bar" role="toolbar" aria-label="글자 서식" style={{ top: y, left: x }} onMouseDown={keep}>
      {btn('b', '굵게(Ctrl+B)', <b>가</b>)}
      {btn('u', '밑줄(Ctrl+U)', <u>가</u>)}
      {btn('i', '기울임(Ctrl+I)', <i>가</i>)}
      {btn('s', '취소선', <s>가</s>)}
      <span className="fb-sep" aria-hidden="true" />
      <span className="fb-pop">
        <button type="button" className="fb-btn" aria-label="글자색" aria-expanded={open === 'color'} title="글자색" onClick={() => setOpen(open === 'color' ? undefined : 'color')}>
          <span style={{ borderBottom: `3px solid ${style.color ?? 'currentColor'}`, lineHeight: 1 }}>A</span>
        </button>
        {open === 'color' && (
          <span className="fb-menu fb-swatches" role="menu" aria-label="글자색 고르기">
            {COLORS.map((c) => (
              <button key={c} type="button" role="menuitem" aria-label={`글자색 ${c}`} className={`fb-swatch${style.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => (onApply('color', c), setOpen(undefined))} />
            ))}
          </span>
        )}
      </span>
      <span className="fb-pop">
        <button type="button" className="fb-btn" aria-label="형광펜" aria-expanded={open === 'bg'} title="형광펜" onClick={() => setOpen(open === 'bg' ? undefined : 'bg')}>
          <span style={{ background: style.bg ?? HIGHLIGHTS[0], padding: '0 3px' }}>가</span>
        </button>
        {open === 'bg' && (
          <span className="fb-menu fb-swatches" role="menu" aria-label="형광펜 고르기">
            {HIGHLIGHTS.map((c) => (
              <button key={c} type="button" role="menuitem" aria-label={`형광펜 ${c}`} className={`fb-swatch${style.bg === c ? ' on' : ''}`} style={{ background: c }} onClick={() => (onApply('bg', c), setOpen(undefined))} />
            ))}
          </span>
        )}
      </span>
      <span className="fb-pop">
        <button type="button" className="fb-btn fb-wide" aria-label="글꼴" aria-expanded={open === 'font'} title="글꼴" onClick={() => setOpen(open === 'font' ? undefined : 'font')}>
          {style.font ?? '글꼴'} ▾
        </button>
        {open === 'font' && (
          <span className="fb-menu" role="menu" aria-label="글꼴 고르기">
            <button type="button" role="menuitem" onClick={() => (style.font && onApply('font', style.font), setOpen(undefined))}>기본</button>
            {FONTS.map((f) => (
              <button key={f} type="button" role="menuitem" className={style.font === f ? 'on' : undefined} style={{ fontFamily: `'${f}'` }} onClick={() => (onApply('font', f), setOpen(undefined))}>
                {f}
              </button>
            ))}
          </span>
        )}
      </span>
      <span className="fb-pop">
        <button type="button" className="fb-btn" aria-label="글자 크기" aria-expanded={open === 'size'} title="글자 크기" onClick={() => setOpen(open === 'size' ? undefined : 'size')}>
          가<small>±</small>
        </button>
        {open === 'size' && (
          <span className="fb-menu" role="menu" aria-label="글자 크기 고르기">
            <button type="button" role="menuitem" onClick={() => (onApply('size', 'sm'), setOpen(undefined))}>작게</button>
            <button type="button" role="menuitem" onClick={() => (style.size && onApply('size', style.size), setOpen(undefined))}>보통</button>
            <button type="button" role="menuitem" onClick={() => (onApply('size', 'lg'), setOpen(undefined))}>크게</button>
          </span>
        )}
      </span>
    </div>
  )
}
