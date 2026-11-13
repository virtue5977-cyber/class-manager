import Icon from '../../components/Icon'
import { HeadTools } from '../../components/PageHead'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import ExportMenu from '../../components/ExportMenu'
import { exportPdf } from '../../lib/export/pdf'
import { useDb, useFs } from '../../app/context'
import type { ClassRec, SeatingChartRec, StudentRec } from '../../lib/db/types'
import { listStudents } from '../../lib/roster/roster'
import {
  activateSeatingChart, createSeatingChart, deleteSeatingChart, listSeatingCharts, placeStudent, pruneMissing, randomize, resizeSeats,
  saveSeatingChart, seatAt, toggleDisabled, toggleFixed, unassign, unplaced,
} from '../../lib/seating/seating'
import { buildSeatingHwpx, seatLabel } from '../../lib/docs/seating-doc'
import { toYmd } from '../../lib/schoolDays'
import { seatingXlsx } from '../../lib/export/sheets'

const DRAG = 'text/x-student'

export default function SeatingTab({ classRec, today = toYmd(new Date()) }: { classRec: ClassRec; today?: string }) {
  const db = useDb()
  const fs = useFs()
  const [students, setStudents] = useState<StudentRec[]>([])
  const [charts, setCharts] = useState<SeatingChartRec[]>([])
  const [chart, setChart] = useState<SeatingChartRec>()
  const [picked, setPicked] = useState<string | null>(null) // 클릭으로 옮길 학생
  const [messages, setMessages] = useState<string[]>([])
  const [size, setSize] = useState({ rows: '5', cols: '6' })

  const load = useCallback(async () => {
    const studs = await listStudents(db, classRec.id)
    let list = await listSeatingCharts(db, classRec.id)
    if (!list.length) list = [await createSeatingChart(db, classRec, today)]
    const cur = list.find((c) => c.active) ?? list[0]
    setStudents(studs)
    setCharts(list)
    setChart({ ...cur, seats: pruneMissing(cur.seats, studs.map((s) => s.id)) })
    setSize({ rows: String(cur.rows), cols: String(cur.cols) })
  }, [db, classRec, today])
  useEffect(() => {
    load()
  }, [load])

  if (!chart) return null
  const byId = new Map(students.map((s) => [s.id, s]))
  const waiting = unplaced(chart.seats, students.map((s) => s.id)).map((id) => byId.get(id)!)
  const usable = chart.seats.filter((s) => !s.disabled).length

  // 저장 결과로 화면 값을 다시 덮지 않는다(저장 중 이어진 조작이 사라지지 않게). 저장은 부른 순서대로 끝난다.
  async function commit(next: SeatingChartRec) {
    setChart(next)
    setCharts((cs) => cs.map((c) => (c.id === next.id ? next : c)))
    await saveSeatingChart(db, next)
  }
  const seatsChange = (seats: SeatingChartRec['seats']) => commit({ ...chart, seats })

  function dropOnSeat(e: DragEvent, row: number, col: number) {
    e.preventDefault()
    const sid = e.dataTransfer.getData(DRAG)
    if (sid) seatsChange(placeStudent(chart!.seats, sid, row, col))
  }
  function clickSeat(row: number, col: number) {
    const seat = seatAt(chart!.seats, row, col)!
    if (picked && !seat.disabled) {
      seatsChange(placeStudent(chart!.seats, picked, row, col))
      setPicked(null)
    } else if (seat.student_id) setPicked(seat.student_id)
    // 빈자리를 누르면 책상 없음, 책상 없는 칸을 누르면 다시 놓기
    else seatsChange(toggleDisabled(chart!.seats, row, col))
  }
  const dragProps = (sid: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG, sid)
      e.dataTransfer.effectAllowed = 'move'
    },
  })

  async function exportHwpx() {
    const { bytes, warnings } = await buildSeatingHwpx(chart!, classRec, students)
    const name = `${chart!.title.replace(/\s+/g, '_')}.hwpx`
    fs.downloadFile(name, bytes)
    setMessages([`${name} 파일을 만들었습니다.`, ...warnings])
  }
  async function exportXlsx() {
    const name = `${chart!.title.replace(/\s+/g, '_')}.xlsx`
    fs.downloadFile(name, await seatingXlsx(chart!, students))
    setMessages([`${name} 파일을 만들었습니다.`])
  }

  const rows = Array.from({ length: chart.rows }, (_, r) => r)
  const cols = Array.from({ length: chart.cols }, (_, c) => c)
  const podium = <div className="podium">교탁</div>

  return (
    <div className="stack wide">
      <div className="toolbar">
        <label className="inline">
          배치
          <select
            value={chart.id}
            onChange={async (e) => {
              const c = charts.find((x) => x.id === e.target.value)!
              await activateSeatingChart(db, c)
              await load()
            }}
          >
            {charts.map((c) => (
              <option key={c.id} value={c.id}>{`${c.date} ${c.title}${c.active ? ' (현재)' : ''}`}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={async () => { await createSeatingChart(db, classRec, today, chart); await load(); setMessages(['지금 배치를 복사해 새 배치를 만들었습니다.']) }}>
          복사해서 새 배치
        </button>
        <button type="button" onClick={async () => { await createSeatingChart(db, classRec, today, undefined, { rows: chart.rows, cols: chart.cols }); await load() }}>
          빈 새 배치
        </button>
        {charts.length > 1 && (
          <button type="button" className="link" onClick={async () => { await deleteSeatingChart(db, chart.id); const rest = charts.filter((c) => c.id !== chart.id); if (rest[0]) await activateSeatingChart(db, rest[0]); await load() }}>
            이 배치 지우기
          </button>
        )}
      </div>
      <HeadTools>
        <ExportMenu items={[{ format: 'hwpx', run: exportHwpx }, { format: 'xlsx', run: exportXlsx }, { format: 'pdf', run: () => exportPdf(`${chart.title || '자리배치'}.pdf`) }]} />
      </HeadTools>
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            const r = randomize(chart.seats, students.map((s) => s.id))
            seatsChange(r.seats)
            // 책상이 모자란 경우는 아래 경고 한 줄로만 알린다.
            setMessages(r.overflow ? [] : ['고정석을 빼고 무작위로 배치했습니다.'])
          }}
        >
          무작위 배치
        </button>
        <button type="button" onClick={() => seatsChange(chart.seats.map((s) => (s.fixed ? s : { ...s, student_id: null })))}>
          고정석 빼고 비우기
        </button>
      </div>
      <details className="panel">
        <summary>{`제목·날짜·책상 크기 (${chart.rows}행 ${chart.cols}열, 교탁 ${chart.podium_position === 'top' ? '위' : '아래'})`}</summary>
        <div className="stack">
          <div className="row">
            <label className="inline">
              제목
              <input value={chart.title} onChange={(e) => setChart({ ...chart, title: e.target.value })} onBlur={() => commit(chart)} />
            </label>
            <label className="inline">
              날짜
              <input type="date" value={chart.date} onChange={(e) => e.target.value && commit({ ...chart, date: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label className="inline">
              행
              <input type="number" min={1} max={10} className="num" value={size.rows} onChange={(e) => setSize({ ...size, rows: e.target.value })} />
            </label>
            <label className="inline">
              열
              <input type="number" min={1} max={10} className="num" value={size.cols} onChange={(e) => setSize({ ...size, cols: e.target.value })} />
            </label>
            <button
              type="button"
              onClick={() => {
                try {
                  const r = Number(size.rows)
                  const c = Number(size.cols)
                  commit({ ...chart, rows: r, cols: c, seats: resizeSeats(chart.seats, r, c) })
                  setMessages([])
                } catch (e) {
                  setMessages([e instanceof Error ? e.message : String(e)])
                }
              }}
            >
              크기 적용
            </button>
            <label className="inline">
              교탁
              <select value={chart.podium_position} onChange={(e) => commit({ ...chart, podium_position: e.target.value as 'top' | 'bottom' })}>
                <option value="bottom">아래</option>
                <option value="top">위</option>
              </select>
            </label>
            <label className="inline">
              <input type="checkbox" checked={chart.show_roster} onChange={(e) => commit({ ...chart, show_roster: e.target.checked })} />
              hwpx 옆에 명렬표
            </label>
          </div>
        </div>
      </details>
      {students.length > usable && <p className="banner">{`책상이 ${students.length - usable}개 모자랍니다(학생 ${students.length}명, 책상 ${usable}개). '제목·날짜·책상 크기'에서 칸을 늘리세요.`}</p>}
      {messages.length > 0 && (
        <div className="notice" role="status">
          {messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      <p className="muted">학생을 끌어다 놓거나, 학생을 누른 뒤 칸을 누르세요. 칸끼리 끌면 맞바꿉니다. 핀을 누르면 고정석(무작위 배치에서 빠짐), 빈자리를 누르면 책상 없음 ↔ 다시 놓기입니다.</p>
      <div className="seating-wrap print-area">
        <h3 className="print-title">{chart.title}</h3>
        {chart.podium_position === 'top' && podium}
        <div className="seat-grid" style={{ gridTemplateColumns: `repeat(${chart.cols}, minmax(84px, 1fr))` }} role="grid" aria-label="자리배치">
          {rows.map((r) =>
            cols.map((c) => {
              const seat = seatAt(chart.seats, r, c)!
              const st = seat.student_id ? byId.get(seat.student_id) : undefined
              const label = `${r + 1}행 ${c + 1}열`
              return (
                <div
                  key={`${r}-${c}`}
                  role="gridcell"
                  aria-label={`${label} ${seat.disabled ? '책상 없음' : st ? seatLabel(st) : '빈자리'}`}
                  className={`seat${seat.disabled ? ' off' : ''}${st ? ' taken' : ''}${seat.fixed ? ' fixed' : ''}${st && picked === st.id ? ' picked' : ''}`}
                  onDragOver={(e) => !seat.disabled && e.preventDefault()}
                  onDrop={(e) => dropOnSeat(e, r, c)}
                  onClick={() => clickSeat(r, c)}
                  title={seat.disabled ? '누르면 책상 다시 놓기' : st ? undefined : '누르면 책상 없음'}
                  {...(st ? dragProps(st.id) : {})}
                >
                  <span className="seat-name pii">{seat.disabled ? '' : st ? seatLabel(st) : ''}</span>
                  <span className="seat-tools">
                    {st && (
                      <button type="button" className={`seat-pin${seat.fixed ? ' on' : ''}`} aria-label={`${label} 고정`} aria-pressed={seat.fixed} title={seat.fixed ? '고정 풀기' : '이 자리에 고정'} onClick={(e) => { e.stopPropagation(); seatsChange(toggleFixed(chart.seats, r, c)) }}>
                        <Icon name="pin" size={13} />
                      </button>
                    )}
                  </span>
                </div>
              )
            }),
          )}
        </div>
        {chart.podium_position === 'bottom' && podium}
      </div>
      <div
        className="card wide pool"
        aria-label="자리 없는 학생"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const sid = e.dataTransfer.getData(DRAG)
          if (sid) seatsChange(unassign(chart.seats, sid))
        }}
        onClick={() => picked && (seatsChange(unassign(chart.seats, picked)), setPicked(null))}
      >
        <strong>{`자리 없는 학생 ${waiting.length}명`}</strong>
        <div className="row">
          {waiting.map((s) => (
            <button key={s.id} type="button" className={`chip pii${picked === s.id ? ' picked' : ''}`} onClick={(e) => { e.stopPropagation(); setPicked(picked === s.id ? null : s.id) }} {...dragProps(s.id)}>
              {seatLabel(s)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
