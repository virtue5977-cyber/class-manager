import { useCallback, useEffect, useState, type DragEvent } from 'react'
import ExportMenu from '../../components/ExportMenu'
import { exportPdf } from '../../lib/export/pdf'
import { useDb, useFs } from '../../app/context'
import type { ClassRec, CleaningChartRec, StudentRec } from '../../lib/db/types'
import { listStudents } from '../../lib/roster/roster'
import {
  addColumn, addRow, addStudent, autoDistribute, cleaningTable, columnsOf, getCleaningChart, moveColumn, moveRow, removeColumn, removeRow,
  removeStudent, renameColumn, rotate, rowsOf, saveCleaningChart, setText, studentsIn, textIn, unassignedIn,
} from '../../lib/cleaning/cleaning'
import { buildTableHwpx } from '../../lib/docs/table-doc'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'

const DRAG = 'text/x-student'

export default function CleaningTab({ classRec }: { classRec: ClassRec }) {
  const db = useDb()
  const fs = useFs()
  const [students, setStudents] = useState<StudentRec[]>([])
  const [chart, setChart] = useState<CleaningChartRec>()
  const [activeCol, setActiveCol] = useState<string>() // 명단·분배·순환 기준 학생 열
  const [picked, setPicked] = useState<string | null>(null)
  const [message, setMessage] = useState<string>()

  const load = useCallback(async () => {
    setStudents(await listStudents(db, classRec.id))
    const c = await getCleaningChart(db, classRec)
    setChart(c)
    setActiveCol((cur) => cur ?? columnsOf(c).find((x) => x.type === 'students')?.id)
  }, [db, classRec])
  useEffect(() => {
    load()
  }, [load])
  if (!chart) return null

  const byId = new Map(students.map((s) => [s.id, s]))
  const name = (sid: string) => byId.get(sid)?.name ?? '(빠진 학생)'
  const cols = columnsOf(chart)
  const studentCols = cols.filter((c) => c.type === 'students')
  const col = studentCols.find((c) => c.id === activeCol) ?? studentCols[0]
  const waiting = col ? unassignedIn(chart, col.id, students.map((s) => s.id)) : []

  // 저장 결과로 화면 값을 다시 덮지 않는다(저장 중에 이어서 입력한 글자가 사라지지 않게). 저장은 부른 순서대로 끝난다.
  async function commit(next: CleaningChartRec) {
    setChart(next)
    await saveCleaningChart(db, next)
  }
  const dragProps = (sid: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG, sid)
      e.dataTransfer.effectAllowed = 'move'
    },
  })

  async function exportAs(kind: 'hwpx' | 'xlsx') {
    const [header, ...rows] = cleaningTable(chart!, name)
    const bytes = kind === 'hwpx' ? await buildTableHwpx({ title: chart!.title, header, rows, fontSizePt: 12, colRatios: cols.map((c) => (c.type === 'students' ? 3 : 2)) }) : await writeSimpleXlsx('청소구역', [header, ...rows])
    const fileName = `${chart!.title.replace(/\s+/g, '_')}.${kind}`
    fs.downloadFile(fileName, bytes)
    setMessage(`${fileName} 파일을 만들었습니다.`)
  }

  return (
    <div className="stack wide">
      <div className="toolbar">
        <label className="inline">
          제목
          <input value={chart.title} onChange={(e) => setChart({ ...chart, title: e.target.value })} onBlur={() => commit(chart)} />
        </label>
        <span className="spacer" />
        <ExportMenu items={[{ format: 'hwpx', run: () => exportAs('hwpx') }, { format: 'xlsx', run: () => exportAs('xlsx') }, { format: 'pdf', run: () => exportPdf(`${chart.title || '청소구역'}.pdf`) }]} />
      </div>
      <div className="toolbar">
        {studentCols.length > 1 && (
          <label className="inline">
            기준 학생 칸
            <select value={col?.id} onChange={(e) => setActiveCol(e.target.value)}>
              {studentCols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" disabled={!col || !chart.rows.length} onClick={() => col && commit(autoDistribute(chart, col.id, students.map((s) => s.id)))}>
          남은 학생 자동 분배
        </button>
        <button type="button" disabled={!col || chart.rows.length < 2} onClick={() => col && commit(rotate(chart, col.id))}>
          순환(한 구역씩 밀기)
        </button>
        <span className="spacer" />
        <button type="button" className="link" aria-label="구역(줄) 추가" onClick={() => commit(addRow(chart))}>
          + 구역(줄)
        </button>
        <button type="button" className="link" aria-label="글자 칸 추가" onClick={() => commit(addColumn(chart, '새 칸', 'text'))}>
          + 글자 칸
        </button>
        <button type="button" className="link" aria-label="학생 칸 추가" onClick={() => commit(addColumn(chart, `${studentCols.length + 1}주차`, 'students'))}>
          + 학생 칸
        </button>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <p className="muted">학생을 끌어 학생 칸에 넣으세요(누른 뒤 칸을 눌러도 됩니다). 칸의 이름표를 끌어 다른 칸으로 옮기고, 아래 명단으로 끌면 뺍니다. 열 이름은 눌러서 고칩니다.</p>
      <div className="table-wrap">
        <table className="grid cleaning">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.id}>
                  <input aria-label={`${i + 1}번째 열 이름`} value={c.name} onChange={(e) => setChart(renameColumn(chart, c.id, e.target.value))} onBlur={() => commit(chart)} />
                  <span className="col-tools">
                    <button type="button" aria-label={`${c.name} 왼쪽으로`} onClick={() => commit(moveColumn(chart, c.id, -1))}>
                      ◀
                    </button>
                    <button type="button" aria-label={`${c.name} 오른쪽으로`} onClick={() => commit(moveColumn(chart, c.id, 1))}>
                      ▶
                    </button>
                    <button type="button" aria-label={`${c.name} 열 지우기`} onClick={() => commit(removeColumn(chart, c.id))}>
                      ✕
                    </button>
                  </span>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rowsOf(chart).length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="muted">
                  "구역(줄) 추가"로 청소 구역을 만드세요.
                </td>
              </tr>
            )}
            {rowsOf(chart).map((r, ri) => (
              <tr key={r.id}>
                {cols.map((c) =>
                  c.type === 'text' ? (
                    <td key={c.id}>
                      <input aria-label={`${ri + 1}번째 줄 ${c.name}`} value={textIn(r, c.id)} onChange={(e) => setChart(setText(chart, r.id, c.id, e.target.value))} onBlur={() => commit(chart)} />
                    </td>
                  ) : (
                    <td
                      key={c.id}
                      aria-label={`${ri + 1}번째 줄 ${c.name}`}
                      className="drop"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const sid = e.dataTransfer.getData(DRAG)
                        if (sid) commit(addStudent(chart, r.id, c.id, sid))
                      }}
                      onClick={() => {
                        if (picked) {
                          commit(addStudent(chart, r.id, c.id, picked))
                          setPicked(null)
                        }
                      }}
                    >
                      {studentsIn(r, c.id).map((sid) => (
                        <span key={sid} className="chip pii" {...dragProps(sid)}>
                          {name(sid)}
                          <button type="button" aria-label={`${name(sid)} 빼기`} onClick={(e) => { e.stopPropagation(); commit(removeStudent(chart, c.id, sid)) }}>
                            ×
                          </button>
                        </span>
                      ))}
                    </td>
                  ),
                )}
                <td className="row-tools">
                  <button type="button" aria-label={`${ri + 1}번째 줄 위로`} onClick={() => commit(moveRow(chart, r.id, -1))}>
                    ▲
                  </button>
                  <button type="button" aria-label={`${ri + 1}번째 줄 아래로`} onClick={() => commit(moveRow(chart, r.id, 1))}>
                    ▼
                  </button>
                  <button type="button" aria-label={`${ri + 1}번째 줄 지우기`} onClick={() => commit(removeRow(chart, r.id))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {col && (
        <div
          className="card wide pool"
          aria-label="배정 안 된 학생"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const sid = e.dataTransfer.getData(DRAG)
            if (sid) commit(removeStudent(chart, col.id, sid))
          }}
        >
          <strong>{`${col.name} 배정 안 된 학생 ${waiting.length}명`}</strong>
          <div className="row">
            {waiting.map((sid) => (
              <button key={sid} type="button" className={`chip pii${picked === sid ? ' picked' : ''}`} onClick={() => setPicked(picked === sid ? null : sid)} {...dragProps(sid)}>
                {`${byId.get(sid)!.number}.${name(sid)}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
