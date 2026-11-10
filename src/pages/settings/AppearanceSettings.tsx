import { useState } from 'react'
import { setHideNames, useHideNames } from '../../components/HideNames'
import { SHORTCUT_TABLE } from '../../lib/ui/shortcuts'
import { THEMES, ACCENTS, DEFAULT_APPEARANCE, readAppearance, saveAppearance, SIZES, type Appearance } from '../../lib/ui/appearance'

export default function AppearanceSettings() {
  const [a, setA] = useState<Appearance>(readAppearance)
  const hidden = useHideNames()
  const set = (p: Partial<Appearance>) => {
    const next = { ...a, ...p }
    setA(next)
    saveAppearance(next)
  }
  return (
    <div className="card stack wide" aria-label="화면 설정">
      <h3>화면</h3>
      <div className="row choice swatches" role="radiogroup" aria-label="테마">
        <span className="muted">테마</span>
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={a.theme === t.id} onClick={() => set({ theme: t.id })}>
            <i style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)`, border: '1px solid var(--line-input)' }} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="row choice" role="radiogroup" aria-label="글자 크기">
        <span className="muted">글자 크기</span>
        {SIZES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={a.size === s.id} onClick={() => set({ size: s.id })}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="row choice swatches" role="radiogroup" aria-label="강조색">
        <span className="muted">강조색</span>
        {ACCENTS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={a.accent === c.id} onClick={() => set({ accent: c.id })}>
            {c.color && <i style={{ background: c.color }} aria-hidden="true" />}
            {c.label}
          </button>
        ))}
      </div>
      <label className="inline">
        <input type="checkbox" checked={hidden} onChange={(e) => setHideNames(e.target.checked)} />
        학생 이름 가리기(교실 TV·프로젝터에 띄울 때, Ctrl+Shift+H)
      </label>
      <table className="grid" aria-label="단축키">
        <thead>
          <tr>
            <th>키</th>
            <th>하는 일</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUT_TABLE.map((r) => (
            <tr key={r.keys}>
              <td>
                <kbd>{r.keys}</kbd>
              </td>
              <td>{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <span className="muted">이 노트북에만 적용됩니다. 출결 색(결석 빨강·지각 주황 등)은 뜻이 있어 바뀌지 않습니다.</span>
        <button type="button" className="link" onClick={() => set(DEFAULT_APPEARANCE)}>
          기본값으로
        </button>
      </div>
    </div>
  )
}
