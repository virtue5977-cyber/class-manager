/** 앱의 펼침 메뉴(details.chat-menu, details.menu, details[data-menu])를 한 곳에서 닫는다:
 * 바깥 누르기·다른 메뉴 열기·메뉴 항목 고르기·Esc(초점은 그 메뉴 단추로)·화면 이동. 접는 칸(details.panel 등)은 건드리지 않는다. */
const SEL = 'details.chat-menu[open], details.menu[open], details[data-menu][open]'

/** 열린 메뉴를 모두 닫는다(화면 이동 때). HashRouter의 이동은 hashchange를 내지 않아 화면에서 직접 부른다. */
export const closeAllMenus = (doc: Document) => doc.querySelectorAll<HTMLDetailsElement>(SEL).forEach((d) => (d.open = false))

export function installMenuAutoClose(doc: Document): () => void {
  const win = doc.defaultView ?? window
  const openMenus = () => Array.from(doc.querySelectorAll<HTMLDetailsElement>(SEL))
  const down = (e: Event) => {
    const t = e.target as Node | null
    for (const d of openMenus()) if (!t || !d.contains(t)) d.open = false
  }
  const click = (e: Event) => {
    const t = e.target as Element | null
    const item = t?.closest?.('button, a')
    if (!item || item.closest('summary')) return
    const d = item.closest<HTMLDetailsElement>(SEL)
    if (d) d.open = false
  }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    const list = openMenus()
    if (!list.length) return
    const act = doc.activeElement
    for (const d of list) {
      d.open = false
      if (act && d.contains(act)) d.querySelector<HTMLElement>('summary')?.focus()
    }
  }
  const nav = () => openMenus().forEach((d) => (d.open = false))
  doc.addEventListener('mousedown', down, true)
  doc.addEventListener('click', click)
  doc.addEventListener('keydown', key)
  win.addEventListener('hashchange', nav)
  return () => {
    doc.removeEventListener('mousedown', down, true)
    doc.removeEventListener('click', click)
    doc.removeEventListener('keydown', key)
    win.removeEventListener('hashchange', nav)
  }
}
