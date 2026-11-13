import Icon from './Icon'
import type { NoteTitle } from '../lib/notes/noteLinks'

/** '@' 다음에 뜨는 노트 후보 */
export default function NoteMentionList({ items, sel, onPick }: { items: NoteTitle[]; sel: number; onPick: (n: NoteTitle) => void }) {
  if (!items.length) return null
  return (
    <ul className="suggest mention-list" role="listbox" aria-label="연결할 노트">
      {items.map((n, i) => (
        <li key={n.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : undefined} onMouseDown={(e) => (e.preventDefault(), onPick(n))}>
          <span className="sg-kind" aria-hidden="true"><Icon name="note" size={14} /></span>
          <span className="pii">{n.title}</span>
        </li>
      ))}
    </ul>
  )
}
