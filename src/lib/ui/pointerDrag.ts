/** 마우스(포인터)로 끌기: HTML 끌어놓기 대신 쓴다(목록이 다시 그려져도 끊기지 않고, Electron에서 링크를 끌어 화면이 바뀌지 않는다).
 * threshold(기본 5px)를 넘게 움직여야 끌기로 본다. 끌고 놓은 직후의 클릭 하나는 막는다(놓을 때 링크가 열리지 않게). */
export interface DragHandlers {
  threshold?: number
  onStart?: () => void
  onMove?: (x: number, y: number) => void
  onDrop?: (x: number, y: number) => void
  onCancel?: () => void
}

export function startPointerDrag(e: Pick<PointerEvent, 'clientX' | 'clientY' | 'button'>, h: DragHandlers): void {
  if (e.button !== 0) return
  const th = h.threshold ?? 5
  const x0 = e.clientX
  const y0 = e.clientY
  let dragging = false
  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) <= th) return
      dragging = true
      document.body.classList.add('is-dragging')
      h.onStart?.()
    }
    h.onMove?.(ev.clientX, ev.clientY)
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('keydown', key)
    document.body.classList.remove('is-dragging')
  }
  const up = (ev: PointerEvent) => {
    stop()
    if (!dragging) return
    // 놓은 자리의 클릭(링크 열기)을 한 번 막는다
    const block = (c: Event) => (c.preventDefault(), c.stopPropagation())
    window.addEventListener('click', block, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', block, { capture: true }), 0)
    h.onDrop?.(ev.clientX, ev.clientY)
  }
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    stop()
    if (dragging) h.onCancel?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('keydown', key)
}

/** 줄 가운데 높이들(위→아래)에서 y가 놓일 자리 0..n */
export function dropIndex(mids: number[], y: number): number {
  const i = mids.findIndex((m) => y < m)
  return i < 0 ? mids.length : i
}

/** id를 빼서 자리 at(빼기 전 기준, 0..n)에 끼운다 */
export function reorderIds(ids: string[], id: string, at: number): string[] {
  const from = ids.indexOf(id)
  if (from < 0) return ids
  const rest = ids.filter((x) => x !== id)
  const j = Math.max(0, Math.min(rest.length, at > from ? at - 1 : at))
  return [...rest.slice(0, j), id, ...rest.slice(j)]
}
