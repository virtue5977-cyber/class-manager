import { HeadTools } from '../../components/PageHead'
import { useEffect, useMemo, useState } from 'react'
import ExportMenu from '../../components/ExportMenu'
import { exportPdf } from '../../lib/export/pdf'
import { useDb, useFs } from '../../app/context'
import type { ClassRec, StudentRec } from '../../lib/db/types'
import { listStudents } from '../../lib/roster/roster'
import {
  buildRosterHwpx, buildRosterXlsx, defaultRosterDocOptions, rosterFileName, rosterTable, type RosterDocOptions,
} from '../../lib/docs/roster-doc'

const FONT_SIZES = [9, 10, 11, 12, 14]
const clampBlanks = (v: number) => (Number.isFinite(v) ? Math.min(10, Math.max(0, Math.floor(v))) : 0)

export default function RosterDocTab({ classRec }: { classRec: ClassRec }) {
  const db = useDb()
  const fs = useFs()
  const [students, setStudents] = useState<StudentRec[] | null>(null)
  const [opts, setOpts] = useState<RosterDocOptions>(() => defaultRosterDocOptions(classRec))
  const [blankText, setBlankText] = useState(String(opts.blankColumns))
  const [error, setError] = useState<string>()

  useEffect(() => {
    listStudents(db, classRec.id).then(setStudents)
    setOpts(defaultRosterDocOptions(classRec))
  }, [db, classRec])

  const table = useMemo(() => rosterTable(students ?? [], opts), [students, opts])

  async function exportFile(kind: 'hwpx' | 'xlsx') {
    setError(undefined)
    try {
      const bytes = kind === 'hwpx' ? await buildRosterHwpx(students ?? [], opts) : await buildRosterXlsx(students ?? [], opts)
      fs.downloadFile(rosterFileName(classRec, kind), bytes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!students) return null
  return (
    <div className="stack">
      <div className="card row options">
        <label>
          제목
          <input value={opts.title} onChange={(e) => setOpts({ ...opts, title: e.target.value })} />
        </label>
        <label>
          빈 열 개수
          <input
            type="number"
            min={0}
            max={10}
            value={blankText}
            onChange={(e) => {
              setBlankText(e.target.value)
              setOpts({ ...opts, blankColumns: clampBlanks(Number(e.target.value)) })
            }}
          />
        </label>
        <label>
          글자 크기
          <select value={String(opts.fontSizePt)} onChange={(e) => setOpts({ ...opts, fontSizePt: Number(e.target.value) })}>
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>{`${s}pt`}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.includeInactive} onChange={(e) => setOpts({ ...opts, includeInactive: e.target.checked })} />
          전출 학생 포함
        </label>
      </div>
      <HeadTools>
        <ExportMenu items={[{ format: 'hwpx', run: () => exportFile('hwpx') }, { format: 'xlsx', run: () => exportFile('xlsx') }, { format: 'pdf', run: () => exportPdf(rosterFileName(classRec, 'hwpx').replace(/\.hwpx$/, '.pdf')) }]} />
      </HeadTools>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="print-area" style={{ fontSize: `${opts.fontSizePt}pt` }}>
        <h3 className="print-title">{opts.title}</h3>
        <table className="grid roster-sheet" aria-label="명렬표 미리보기">
          <thead>
            <tr>
              {table[0].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.slice(1).map((row) => (
              <tr key={row[0]}>
                {row.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
