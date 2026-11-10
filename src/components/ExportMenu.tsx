import { useCallback, useEffect, useRef, useState } from 'react'
import { useShortcut } from '../lib/ui/shortcuts'

export type ExportFormat = 'hwpx' | 'xlsx' | 'pdf'
const LABEL: Record<ExportFormat, string> = { hwpx: '한글(hwpx)', xlsx: '엑셀(xlsx)', pdf: 'PDF' }

/** 화면마다 하나인 '내보내기 ▾'(한글·엑셀·PDF). Ctrl+E로도 연다. */
export default function ExportMenu({ items }: { items: { format: ExportFormat; run: () => unknown }[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useShortcut('export', useCallback(() => setOpen(true), []))
  useShortcut('close', useCallback(() => setOpen(false), []))
  useEffect(() => {
    if (!open) return
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  return (
    <div className="menu export-menu" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        내보내기 ▾
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((it) => (
            <button
              key={it.format}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void it.run()
              }}
            >
              {LABEL[it.format]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
