import { MENU } from '../../components/Nav'
import { movePref, PANEL_LABEL, resetPrefs, savePrefs, togglePref, useLayoutPrefs, type PrefItem } from '../../lib/ui/layoutPrefs'

const menuLabel = (key: string) => MENU.find((m) => m.to === key)?.label ?? key

/** 설정 > 화면: 왼쪽 메뉴 순서·숨기기, 홈 오른쪽 칸 순서·숨기기, 사이드바 너비. 이 기기에 기억. */
export default function LayoutSettings() {
  const p = useLayoutPrefs()
  function List<K extends string>({ items, label, onChange, locked }: { items: PrefItem<K>[]; label: (k: K) => string; onChange: (l: PrefItem<K>[]) => void; locked?: (k: K) => boolean }) {
    return (
      <ul className="plain fields-list">
        {items.map((x, i) => (
          <li key={x.key} className="row">
            <input type="checkbox" aria-label={`${label(x.key)} 보이기`} checked={!x.hidden} disabled={locked?.(x.key)} onChange={(e) => onChange(togglePref(items, x.key, !e.target.checked))} />
            <span className="fields-name">{label(x.key)}</span>
            <span className="spacer" />
            <button type="button" className="link" aria-label={`${label(x.key)} 위로`} disabled={i === 0} onClick={() => onChange(movePref(items, x.key, -1))}>↑</button>
            <button type="button" className="link" aria-label={`${label(x.key)} 아래로`} disabled={i === items.length - 1} onClick={() => onChange(movePref(items, x.key, 1))}>↓</button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <section className="card stack wide" aria-label="메뉴와 홈 배치">
      <h3>메뉴와 홈 배치</h3>
      <p className="muted">이 컴퓨터에만 기억합니다. 홈과 설정은 숨길 수 없습니다. 홈의 대화 높이·오른쪽 칸 너비는 홈에서 경계선을 끌어 바꿉니다.</p>
      <div className="layout-prefs">
        <div className="stack">
          <h4>왼쪽 메뉴</h4>
          <List items={p.menu} label={menuLabel} locked={(k) => k === '/'} onChange={(menu) => savePrefs({ ...p, menu })} />
        </div>
        <div className="stack">
          <h4>홈 오른쪽 칸</h4>
          <List items={p.panels} label={(k) => PANEL_LABEL[k]} onChange={(panels) => savePrefs({ ...p, panels })} />
        </div>
      </div>
      <label className="inline">
        왼쪽 메뉴 너비
        <input type="range" min={160} max={320} step={8} value={p.sidebarW} aria-valuetext={`${p.sidebarW}px`} onChange={(e) => savePrefs({ ...p, sidebarW: Number(e.target.value) })} />
        <span className="muted">{`${p.sidebarW}px`}</span>
      </label>
      <div className="row">
        <button type="button" onClick={() => resetPrefs()}>
          메뉴·배치 기본으로
        </button>
      </div>
    </section>
  )
}
