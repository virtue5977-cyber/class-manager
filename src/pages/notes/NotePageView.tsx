import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import type { NoteBlock, NotePage } from '../../lib/db/types'
import { A4, fillHeaderFooter, MARGINS, paginate } from '../../lib/notes/paginate'

export const DEFAULT_PAGE: NotePage = { view: false, margin: 'normal', grid: false }

/** 도구 막대 오른쪽 '쪽' 메뉴: 쪽 보기·여백·격자·확대·머리말·꼬리말 */
export function PageMenu({ page, onChange }: { page: NotePage; onChange: (p: NotePage) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="tb-pop">
      <button type="button" className={`tb-btn tb-labeled${page.view ? ' on' : ''}`} aria-label="쪽 설정" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4" />
        </svg>
        <span>쪽</span>
      </button>
      {open && (
        <span className="tb-menu tb-page" role="group" aria-label="쪽 설정 고르기">
          <label className="inline">
            <input type="checkbox" checked={page.view} onChange={(e) => onChange({ ...page, view: e.target.checked })} />
            쪽 보기(A4 종이)
          </label>
          <span className="row" role="radiogroup" aria-label="여백">
            <span className="muted">여백</span>
            {(['narrow', 'normal', 'wide'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={page.margin === m} className={page.margin === m ? 'on' : undefined} onClick={() => onChange({ ...page, margin: m })}>
                {m === 'narrow' ? '좁게' : m === 'normal' ? '보통' : '넓게'}
              </button>
            ))}
          </span>
          <label className="inline">
            <input type="checkbox" checked={page.grid} onChange={(e) => onChange({ ...page, grid: e.target.checked })} />
            격자 보기
          </label>
          <label className="inline">
            확대
            <select aria-label="확대" value={page.zoom ?? 100} onChange={(e) => onChange({ ...page, zoom: Number(e.target.value) === 100 ? undefined : Number(e.target.value) })}>
              {[50, 75, 100, 125, 150, 200].map((z) => (
                <option key={z} value={z}>{`${z}%`}</option>
              ))}
            </select>
          </label>
          <label className="wide">
            머리말
            <input aria-label="머리말" placeholder="예: 1학년 5반 {날짜}" value={page.header ?? ''} onChange={(e) => onChange({ ...page, header: e.target.value || undefined })} />
          </label>
          <label className="wide">
            꼬리말
            <input aria-label="꼬리말" placeholder="예: - {쪽} -" value={page.footer ?? ''} onChange={(e) => onChange({ ...page, footer: e.target.value || undefined })} />
          </label>
          <span className="muted small">{'{쪽} {전체쪽} {날짜}를 쓰면 바뀌어 나옵니다.'}</span>
        </span>
      )}
    </span>
  )
}

/** 쪽 보기에서 각 쪽 첫 블록 index와 쪽 높이(px). 블록 높이가 바뀌면 다시 잰다. */
export function usePageStarts(on: boolean, box: RefObject<HTMLElement | null>, probe: RefObject<HTMLElement | null>, blocks: NoteBlock[], margin: NotePage['margin']): { starts: number[]; used: number[]; pageH: number; pxPerMm: number } {
  const [st, setSt] = useState<{ starts: number[]; used: number[]; pageH: number; pxPerMm: number }>({ starts: [0], used: [], pageH: 0, pxPerMm: 3.78 })
  const [tick, setTick] = useState(0)
  useLayoutEffect(() => {
    if (!on || !box.current || !probe.current) return
    const pxPerMm = probe.current.offsetHeight / 100 || 3.78
    const m = MARGINS[margin] ?? MARGINS.normal
    const pageH = (A4.h - m.top - m.bottom) * pxPerMm
    const els = Array.from(box.current.querySelectorAll<HTMLElement>(':scope > .nb'))
    const gap = parseFloat(getComputedStyle(box.current).rowGap || '0') || 0
    const heights = els.map((el, i) => (blocks[i]?.type === 'pagebreak' ? 0 : el.offsetHeight + gap))
    const forced = blocks.map((_, i) => i > 0 && blocks[i - 1].type === 'pagebreak')
    const starts = paginate(heights, forced, pageH)
    // 쪽마다 쓴 높이(마지막 쪽 채우기용)
    const used = starts.map((s, k) => heights.slice(s, starts[k + 1] ?? heights.length).reduce((a, b) => a + b, 0))
    setSt((o) => (JSON.stringify(o) === JSON.stringify({ starts, used, pageH, pxPerMm }) ? o : { starts, used, pageH, pxPerMm }))
  }, [on, blocks, margin, tick, box, probe])
  useEffect(() => {
    if (!on || !box.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTick((t) => t + 1))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [on, box])
  return st
}

/** 쪽 사이: 앞 쪽 남은 칸 + 아래 여백(꼬리말) + 회색 틈 + 다음 쪽 위 여백(머리말) */
export function PageGap({ fill, page, n, total, today, last }: { fill: number; page: NotePage; n: number; total: number; today: string; last?: boolean }) {
  const m = MARGINS[page.margin] ?? MARGINS.normal
  return (
    <div className="pg-gap" aria-hidden="true">
      <div style={{ height: Math.max(0, fill) }} />
      <div className="pg-foot" style={{ height: `${m.bottom}mm` }}>
        {page.footer && <span>{fillHeaderFooter(page.footer, n, total, today)}</span>}
      </div>
      {!last && (
        <>
          <div className="pg-band" style={{ marginLeft: `-${m.left}mm`, marginRight: `-${m.right}mm` }} />
          <div className="pg-head" style={{ height: `${m.top}mm` }}>
            {page.header && <span>{fillHeaderFooter(page.header, n + 1, total, today)}</span>}
          </div>
        </>
      )}
    </div>
  )
}
