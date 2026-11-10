import MonthPicker, { shiftMonth } from '../../components/MonthPicker'
import PageHead from '../../components/PageHead'
import ExportMenu from '../../components/ExportMenu'
import { exportPdf } from '../../lib/export/pdf'
import { useShortcut } from '../../lib/ui/shortcuts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import type { StudentRec } from '../../lib/db/types'
import { listStudents, classLabel } from '../../lib/roster/roster'
import { listAttendanceByStudent } from '../../lib/attendance/attendance'
import { loadReportContext } from '../../lib/absenceReports/reconcile'
import { CATEGORIES, firstAbsenceDate, KINDS, STAT_COLS, computeAttendanceStats, statsTable } from '../../lib/stats'
import { listReportsByStudents } from '../../lib/absenceReports/reconcile'
import { buildTableHwpx } from '../../lib/docs/table-doc'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { ClassSelect, NoClass, useClasses } from '../common/useClasses'
import { toYmd } from '../../lib/schoolDays'

export default function StatsPage() {
  const db = useDb()
  const fs = useFs()
  const { classes, classId, current, choose } = useClasses()
  /** '' = 학년도 전체, 아니면 YYYY-MM */
  const [month, setMonth] = useState('')
  useShortcut('step', (a) => a.kind === 'step' && month && setMonth(shiftMonth(month, a.dir)))
  const [table, setTable] = useState<string[][]>([])
  /** 표 줄마다 학생 id와 결석 첫 날짜(숫자 링크용) */
  const [rowsMeta, setRowsMeta] = useState<{ id: string; first: Partial<Record<string, string>> }[]>([])
  /** 보일 칸(이 기기에 기억). 기본은 모두. */
  const [cols, setCols] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('watson.stats.cols') ?? 'null')
      return Array.isArray(v) ? STAT_COLS.filter((k) => v.includes(k)) : STAT_COLS
    } catch {
      return STAT_COLS
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('watson.stats.cols', JSON.stringify(cols))
    } catch {
      /* 기억 못 해도 그대로 */
    }
  }, [cols])
  const [message, setMessage] = useState<string>()
  const seq = useRef(0)

  const range = useCallback(() => {
    if (month) return { from: `${month}-01`, to: `${month}-31`, label: `${Number(month.slice(5))}월` }
    const y = current?.school_year ?? new Date().getFullYear()
    return { from: `${y}-03-01`, to: `${y + 1}-02-31`, label: `${y}학년도 전체` }
  }, [month, current])

  const reload = useCallback(async () => {
    if (!classId) return
    const n = ++seq.current
    const students: StudentRec[] = await listStudents(db, classId, { includeInactive: true })
    const atts = (await Promise.all(students.map((s) => listAttendanceByStudent(db, s.id)))).flat()
    const { days } = await loadReportContext(db)
    const r = range()
    const reps = await listReportsByStudents(db, students.map((x) => x.id))
    const inRange = (d: string) => d >= r.from && d <= r.to
    const reports = new Map(students.map((x) => {
      const list = (reps[x.id] ?? []).filter((rp) => inRange(rp.start_date))
      return [x.id, { open: list.filter((rp) => !rp.submitted).length, total: list.length }]
    }))
    const t = statsTable(students, computeAttendanceStats(atts, days, r), { cols, reports })
    if (n === seq.current) {
      setTable(t)
      setRowsMeta(students.map((x) => ({ id: x.id, first: Object.fromEntries(CATEGORIES.map((c) => [c, firstAbsenceDate(atts, x.id, '결석', r, c)])) })))
    }
  }, [db, classId, range, cols])
  useEffect(() => {
    reload()
  }, [reload])

  if (classes && classes.length === 0) return <NoClass title="통계" />
  const title = current ? `${classLabel(current)} 출결 통계` : '출결 통계'

  async function exportAs(kind: 'hwpx' | 'xlsx') {
    const [header, ...rows] = table
    const name = `${title}_${range().label}`.replace(/\s+/g, '_')
    const bytes =
      kind === 'hwpx'
        ? await buildTableHwpx({ title, subtitle: range().label, header, rows, landscape: true, fontSizePt: 9, colRatios: [2, 4, ...header.slice(2).map(() => 3)] })
        : await writeSimpleXlsx('출결통계', table)
    fs.downloadFile(`${name}.${kind}`, bytes)
    setMessage(`${name}.${kind} 파일을 만들었습니다.`)
  }

  return (
    <section className="stack">
      <PageHead title="통계" summary="결석은 수업일 일수(이어진 묶음 건수), 지각·조퇴·결과는 건수입니다.">
        {classes && <ClassSelect classes={classes} classId={classId} onChange={choose} />}
        <label className="inline">
          기간
          <select value={month ? 'month' : 'year'} onChange={(e) => setMonth(e.target.value === 'year' ? '' : toYmd(new Date()).slice(0, 7))}>
            <option value="year">학년도 전체</option>
            <option value="month">월별</option>
          </select>
        </label>
        {month && (
          <MonthPicker value={month} onChange={setMonth} />
        )}
        <details className="menu">
          <summary>칸 ▾</summary>
          <div className="menu-list col-pick">
            {KINDS.map((k) => (
              <fieldset key={k}>
                <legend>{k}</legend>
                {STAT_COLS.filter((c) => c.startsWith(k + ':')).map((c) => (
                  <label key={c} className="check">
                    <input type="checkbox" aria-label={c.replace(':', ' ')} checked={cols.includes(c)} onChange={(e) => setCols((cur) => STAT_COLS.filter((x) => (x === c ? e.target.checked : cur.includes(x))))} />
                    {c.split(':')[1]}
                  </label>
                ))}
              </fieldset>
            ))}
            <button type="button" className="link" onClick={() => setCols(STAT_COLS)}>모두 보이기</button>
          </div>
        </details>
        <ExportMenu items={[{ format: 'hwpx', run: () => exportAs('hwpx') }, { format: 'xlsx', run: () => exportAs('xlsx') }, { format: 'pdf', run: () => exportPdf(`${title}_${range().label}.pdf`.replace(/\s+/g, '_')) }]} />
      </PageHead>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {table.length > 0 && (
        <div className="table-wrap">
          <table className="grid stats">
            <thead>
              <tr>
                <th rowSpan={2}>번호</th>
                <th rowSpan={2}>이름</th>
                {KINDS.filter((k) => cols.some((c) => c.startsWith(k + ':'))).map((k) => (
                  <th key={k} colSpan={cols.filter((c) => c.startsWith(k + ':')).length}>
                    {k}
                  </th>
                ))}
                <th rowSpan={2}>신고서</th>
              </tr>
              <tr>
                {cols.map((c) => <th key={c}>{c.split(':')[1]}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.slice(1).map((row, i) => {
                const meta = rowsMeta[i]
                return (
                  <tr key={i} className={i === table.length - 2 ? 'total' : undefined}>
                    {row.map((v, j) => {
                      const col = cols[j - 2]
                      const last = j === row.length - 1
                      const link = meta && v ? (last ? `#/attendance/reports?sid=${meta.id}` : col?.startsWith('결석:') && meta.first[col.split(':')[1]] ? `#/attendance?date=${meta.first[col.split(':')[1]]}&sid=${meta.id}` : undefined) : undefined
                      return <td key={j} className={j === 1 ? 'pii' : undefined}>{link ? <a href={link}>{v}</a> : v}</td>
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
