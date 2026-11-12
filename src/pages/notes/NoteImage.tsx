import { useEffect, useRef, useState } from 'react'
import { useDb } from '../../app/context'
import type { NoteBlock } from '../../lib/db/types'
import { readFile } from '../../lib/notes/notes'
import { startPointerDrag } from '../../lib/ui/pointerDrag'

/** 노트 그림 블록: 너비(모서리 끌기)·정렬·설명 */
export default function NoteImage({ b, onChange, onDelete }: { b: NoteBlock; onChange: (p: Partial<NoteBlock>) => void; onDelete: () => void }) {
  const db = useDb()
  const [url, setUrl] = useState<string>()
  const [err, setErr] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let u: string | undefined
    let live = true
    readFile(db, b.file_id ?? '').then(
      (f) => {
        if (!live) return
        u = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
        setUrl(u)
      },
      () => live && setErr(true),
    )
    return () => {
      live = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [db, b.file_id])
  const width = b.width ?? 100
  const align = b.align ?? 'center'
  function beginResize(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const full = box.current?.getBoundingClientRect().width || 1
    const x0 = e.clientX
    const w0 = width
    startPointerDrag(e, {
      threshold: 1,
      // 가운데 정렬이면 양쪽으로 커지므로 두 배로
      onMove: (x) => onChange({ width: Math.max(10, Math.min(100, Math.round(w0 + (((x - x0) / full) * 100 * (align === 'center' ? 2 : 1))))) }),
    })
  }
  return (
    <div className={`nb-image al-${align}`} ref={box}>
      <div className="nb-image-tools" role="toolbar" aria-label="그림 도구">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} type="button" aria-pressed={align === a} className={align === a ? 'on' : undefined} onClick={() => onChange({ align: a === 'center' ? undefined : a })}>
            {a === 'left' ? '왼쪽' : a === 'center' ? '가운데' : '오른쪽'}
          </button>
        ))}
        {[25, 50, 100].map((w) => (
          <button key={w} type="button" aria-pressed={width === w} className={width === w ? 'on' : undefined} onClick={() => onChange({ width: w === 100 ? undefined : w })}>
            {`${w}%`}
          </button>
        ))}
        <button type="button" className="danger-text" onClick={onDelete}>그림 지우기</button>
      </div>
      <figure style={{ width: `${width}%` }}>
        {err ? <div className="nb-image-missing">그림 파일을 찾을 수 없습니다.</div> : url ? <img src={url} alt={b.caption || '노트 그림'} draggable={false} /> : <div className="nb-image-missing">불러오는 중…</div>}
        <span className="nb-image-handle" role="separator" aria-label="그림 크기 바꾸기" title="끌어서 크기" onPointerDown={beginResize} />
        <input className="nb-image-caption" aria-label="그림 설명" placeholder="그림 설명(선택)" value={b.caption ?? ''} onChange={(e) => onChange({ caption: e.target.value || undefined })} />
      </figure>
    </div>
  )
}
