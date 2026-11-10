import { useEffect, useMemo, useState } from 'react'
import { useAi, useDb, useFs } from '../../app/context'
import { buildSampleAbsenceHwpx } from '../../lib/hwpx/absence/build'
import { markTemplate, matchByAi, matchByRules, SLOT_FIELDS, type FormCell, type Slot } from '../../lib/hwpx/absence/scan'
import { installTemplate } from '../../lib/hwpx/absence/template'
import { getSettings } from '../../lib/settings'

const where = (c: FormCell) => `${c.row + 1}행 ${c.col + 1}열`

/** 다른 학교 결석신고서: 찾은 자리 확인·바로잡기 → 가상 학생 미리보기 → 저장. */
export default function FormScan({ name, bytes, cells, aiOn, onDone, onCancel }: { name: string; bytes: Uint8Array; cells: FormCell[]; aiOn: boolean; onDone: (msgs: string[]) => void; onCancel: () => void }) {
  const db = useDb()
  const fs = useFs()
  const ai = useAi()
  const [pick, setPick] = useState<Record<string, number | ''>>(() => Object.fromEntries(SLOT_FIELDS.map((f) => [f.field, ''])))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>()
  useEffect(() => {
    const found = matchByRules(cells)
    setPick((p) => ({ ...p, ...Object.fromEntries(found.map((s) => [s.field, s.target])) }))
  }, [cells])
  const empty = useMemo(() => cells.filter((c) => !c.text), [cells])
  /** 빈 칸 옆(왼쪽·위) 글: 고를 때 알아보기 쉽게 */
  const near = (c: FormCell) => cells.find((x) => x.text && x.row === c.row && x.col + x.colSpan === c.col)?.text ?? cells.find((x) => x.text && x.col === c.col && x.row + x.rowSpan === c.row)?.text ?? ''
  const slots = (): Slot[] => SLOT_FIELDS.flatMap((f) => (pick[f.field] === '' ? [] : [{ field: f.field, label: -1, target: pick[f.field] as number }]))
  const count = slots().length
  const hasKey = pick['이름'] !== '' || pick['학번'] !== ''

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMsg(undefined)
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack" aria-label="다른 학교 양식 확인">
      <h4>{`다른 학교 양식: ${name}`}</h4>
      <p className="muted">{`표 칸 ${cells.length}개를 읽어 자리 ${count}곳을 찾았습니다. 틀린 곳은 바꾸고, 없는 자리는 '(없음)'으로 두세요. 학생 이름이나 학번 자리 중 하나는 있어야 합니다.`}</p>
      <table className="grid" aria-label="찾은 자리">
        <thead>
          <tr><th>자리</th><th>값이 들어갈 칸</th></tr>
        </thead>
        <tbody>
          {SLOT_FIELDS.map((f) => (
            <tr key={f.field}>
              <th scope="row">{f.label}</th>
              <td>
                <select aria-label={`${f.label} 자리`} value={String(pick[f.field])} onChange={(e) => setPick({ ...pick, [f.field]: e.target.value === '' ? '' : Number(e.target.value) })}>
                  <option value="">(없음)</option>
                  {empty.map((c) => (
                    <option key={c.id} value={c.id} disabled={Object.entries(pick).some(([k, v]) => k !== f.field && v === c.id)}>
                      {`${where(c)}${near(c) ? ` (옆: ${near(c)})` : ''}`}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className="error" role="alert">{msg}</p>}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={busy || !hasKey}
          onClick={() => run(async () => {
            const r = await installTemplate(db, name, await markTemplate(bytes, slots()))
            if (!r.ok) throw new Error(r.error ?? '양식을 저장하지 못했습니다.')
            onDone(['다른 학교 양식을 저장해 적용했습니다.', `채울 자리 ${r.found.length}곳`])
          })}
        >
          이 양식으로 저장
        </button>
        <button type="button" disabled={busy || !count} onClick={() => run(async () => {
          const s = await getSettings(db)
          fs.downloadFile(`${name}_미리보기.hwpx`, await buildSampleAbsenceHwpx(await markTemplate(bytes, slots()), { teacher: s.teacher_name, school: s.school_name, codeFormat: s.student_code_format }))
        })}>
          가상 학생으로 미리보기
        </button>
        {aiOn && (
          <button type="button" disabled={busy} onClick={() => run(async () => {
            const have = slots()
            const more = await matchByAi(cells, have, ai)
            setPick((p) => ({ ...p, ...Object.fromEntries(more.map((s) => [s.field, s.target])) }))
            setMsg(more.length ? undefined : 'AI도 더 찾지 못했습니다.')
          })}>
            못 찾은 자리 AI로 찾기
          </button>
        )}
        <button type="button" onClick={onCancel}>
          그만두기
        </button>
      </div>
      {aiOn && <p className="muted">AI에는 양식 칸의 글만 보냅니다(학생 자료 없음).</p>}
    </section>
  )
}
