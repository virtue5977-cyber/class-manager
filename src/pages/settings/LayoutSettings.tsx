import Icon from '../../components/Icon'
import { MENU } from '../../components/Nav'
import { movePref, PANEL_LABEL, panelPlace, resetPrefs, savePrefs, setPlace, togglePref, useLayoutPrefs, type PanelPlace, type PrefItem } from '../../lib/ui/layoutPrefs'

const menuLabel = (key: string) => MENU.find((m) => m.to === key)?.label ?? key

/** 설정 > 화면: 왼쪽 메뉴 순서·숨기기, 홈 칸 순서·자리(오른쪽/왼쪽 탭/숨김), 사이드바 너비. 이 기기에 기억. */
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
            <button type="button" className="link" aria-label={`${label(x.key)} 위로`} disabled={i === 0} onClick={() => onChange(movePref(items, x.key, -1))}><Icon name="arrowUp" size={14} /></button>
            <button type="button" className="link" aria-label={`${label(x.key)} 아래로`} disabled={i === items.length - 1} onClick={() => onChange(movePref(items, x.key, 1))}><Icon name="arrowDown" size={14} /></button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <section className="card stack wide" aria-label="메뉴와 홈 배치">
      <h3>메뉴와 홈 배치</h3>
      <p className="muted">이 컴퓨터에만 기억합니다. 홈과 설정은 숨길 수 없습니다. 홈 칸은 오른쪽에 두거나 대화·전달사항 옆 탭으로 옮길 수 있습니다(홈에서 칸에 마우스를 올려 '탭으로' 단추로도 옮깁니다). 대화 높이·오른쪽 칸 너비·칸마다 높이는 홈에서 경계선을 끌어 바꿉니다.</p>
      <div className="layout-prefs">
        <div className="stack">
          <h4>왼쪽 메뉴</h4>
          <List items={p.menu} label={menuLabel} locked={(k) => k === '/'} onChange={(menu) => savePrefs({ ...p, menu })} />
        </div>
        <div className="stack">
          <h4>홈 칸 자리</h4>
          <ul className="plain fields-list" aria-label="홈 칸 자리">
            {p.panels.map((x, i) => (
              <li key={x.key} className="row">
                <span className="fields-name">{PANEL_LABEL[x.key]}</span>
                <span className="spacer" />
                <select aria-label={`홈 ${PANEL_LABEL[x.key]} 자리`} value={panelPlace(x)} onChange={(e) => savePrefs({ ...p, panels: setPlace(p.panels, x.key, e.target.value as PanelPlace) })}>
                  <option value="side">오른쪽</option>
                  <option value="tab">왼쪽 탭</option>
                  <option value="hidden">숨김</option>
                </select>
                <button type="button" className="link" aria-label={`홈 ${PANEL_LABEL[x.key]} 위로`} disabled={i === 0} onClick={() => savePrefs({ ...p, panels: movePref(p.panels, x.key, -1) })}><Icon name="arrowUp" size={14} /></button>
                <button type="button" className="link" aria-label={`홈 ${PANEL_LABEL[x.key]} 아래로`} disabled={i === p.panels.length - 1} onClick={() => savePrefs({ ...p, panels: movePref(p.panels, x.key, 1) })}><Icon name="arrowDown" size={14} /></button>
              </li>
            ))}
          </ul>
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
