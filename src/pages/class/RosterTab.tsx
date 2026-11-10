import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import type { StudentRec } from '../../lib/db/types'
import { listStudents, upsertRosterRows } from '../../lib/roster/roster'
import { parseTsv, rosterTemplate, toRosterRows, type PasteResult } from '../../lib/roster/paste'
import { ROSTER_COLUMNS } from '../../lib/roster/columns'
import { readFirstSheet } from '../../lib/xlsx/read'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import StudentDetail from './StudentDetail'

export default function RosterTab({ classId, classLabel = '' }: { classId: string; classLabel?: string }) {
  const db = useDb()
  const fs = useFs()
  const [fileRows, setFileRows] = useState<{ name: string; result: PasteResult } | null>(null)
  const [students, setStudents] = useState<StudentRec[]>([])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  /** 오른쪽에 연 학생(id) 또는 새 학생. null이면 목록 첫 학생. */
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string>()
  const [renameOk, setRenameOk] = useState(false)

  const reload = useCallback(async () => setStudents(await listStudents(db, classId)), [db, classId])
  useEffect(() => {
    reload()
    setSelected(null)
  }, [reload])

  // 재적 학생 먼저(번호순), 전출 학생은 맨 아래.
  const ordered = useMemo(() => [...students.filter((s) => s.active), ...students.filter((s) => !s.active)], [students])
  const q = query.trim()
  const shown = q ? ordered.filter((s) => s.name.includes(q) || String(s.number) === q) : ordered
  const current = (selected && selected !== 'new' ? students.find((s) => s.id === selected) : undefined) ?? shown[0] ?? ordered[0]

  const parsed = useMemo(() => fileRows?.result ?? toRosterRows(parseTsv(pasteText)), [pasteText, fileRows])
  /** 번호는 같은데 이름이 다른 행: 기존 학생 기록이 다른 아이 이름으로 바뀐다. */
  const renames = useMemo(() => {
    const byNumber = new Map(students.map((s) => [s.number, s.name]))
    return new Map(parsed.rows.filter((r) => r.fields.name && byNumber.has(r.number) && byNumber.get(r.number) !== r.fields.name).map((r) => [r.number, byNumber.get(r.number)!]))
  }, [parsed, students])

  async function register() {
    const r = await upsertRosterRows(db, classId, parsed.rows)
    setNotice(`새로 ${r.added}명, 갱신 ${r.updated}명을 등록했습니다.${r.skipped.length ? ` 이름이 없는 새 번호(${r.skipped.join(', ')})는 건너뛰었습니다.` : ''}`)
    setPasteOpen(false)
    setPasteText('')
    setFileRows(null)
    setRenameOk(false)
    await reload() // 상세는 updated_at이 바뀌어 새 값으로 다시 열린다(옛 값 덮어쓰기 방지)
  }

  return (
    <div className="stack roster-tab">
      <div className="toolbar">
        <details className="menu">
          <summary>가져오기·양식 ▾</summary>
          <div className="menu-list" onClick={(e) => { const d = e.currentTarget.closest("details"); if (d) d.open = false }}>
        <button
          type="button"
          onClick={async () => {
            const bytes = await writeSimpleXlsx('명렬표', rosterTemplate(students))
            const name = `명렬표_양식${classLabel ? '_' + classLabel.replace(/\s+/g, '') : ''}.xlsx`
            fs.downloadFile(name, bytes)
            setNotice(`${name} 파일을 받았습니다. 채운 칸만 반영되니 아는 정보만 넣어 올리세요.`)
          }}
        >
          양식 내려받기
        </button>
        <button
          type="button"
          onClick={async () => {
            setNotice(undefined)
            const f = await fs.pickFileToRead('.xlsx,.csv,.txt', { maxBytes: 10 * 1024 * 1024 })
            if (!f) return
            if (f.tooBig) return setNotice('명렬표 파일이 너무 큽니다(10MB까지).')
            try {
              const cells = /\.(csv|txt)$/i.test(f.name) ? parseTsv(new TextDecoder().decode(f.bytes).replace(/,/g, '\t')) : await readFirstSheet(f.bytes)
              setFileRows({ name: f.name, result: toRosterRows(cells) })
              setPasteOpen(true)
              setRenameOk(false)
            } catch (e) {
              setNotice(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          엑셀 파일 올리기
        </button>
        <button type="button" onClick={() => { setPasteOpen(true); setFileRows(null); setNotice(undefined) }}>
          엑셀에서 붙여넣기
        </button>
          </div>
        </details>
        <button type="button" className="primary" onClick={() => setSelected('new')}>
          학생 추가
        </button>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}

      {pasteOpen && (
        <div className="card stack">
          {fileRows ? (
            <p>{`올린 파일: ${fileRows.name}`}</p>
          ) : (
            <label className="wide">
              엑셀에서 복사한 내용
              <textarea rows={6} value={pasteText} onChange={(e) => { setPasteText(e.target.value); setRenameOk(false) }} />
            </label>
          )}
          <p className="muted">{`열 순서: ${ROSTER_COLUMNS.map((c) => c.label).join(', ')}. 첫 줄이 머리글이면 머리글로 열을 찾습니다(나이스 명렬표 그대로 가능). 빈 칸은 기존 값을 그대로 둡니다.`}</p>
          {parsed.rows.length > 0 && (
            <table className="grid" aria-label="붙여넣기 미리보기">
              <thead>
                <tr>{ROSTER_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}<th>변경</th></tr>
              </thead>
              <tbody>
                {parsed.rows.map((r) => (
                  <tr key={r.number} className={renames.has(r.number) ? 'warn-row' : undefined}>
                    <td>{r.number}</td>
                    {ROSTER_COLUMNS.slice(1).map((c) => {
                      const v = r.fields[c.key as Exclude<typeof c.key, 'number'>] ?? ''
                      return <td key={c.key} className={v ? undefined : 'muted'}>{v || '-'}</td>
                    })}
                    <td>{renames.has(r.number) ? `이름 변경: ${renames.get(r.number)} → ${r.fields.name}` : students.some((s) => s.number === r.number) ? '갱신' : r.fields.name ? '새 학생' : '건너뜀(이름 없음)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {parsed.errors.length > 0 && (
            <ul className="error">
              {parsed.errors.map((e) => (
                <li key={e.line + e.message}>{`${e.line}번째 줄: ${e.message}`}</li>
              ))}
            </ul>
          )}
          {renames.size > 0 && (
            <label className="check warn">
              <input type="checkbox" checked={renameOk} onChange={(e) => setRenameOk(e.target.checked)} />
              이름 변경을 확인했습니다
            </label>
          )}
          <div className="row">
            <button type="button" className="primary" onClick={register} disabled={parsed.errors.length > 0 || parsed.rows.length === 0 || (renames.size > 0 && !renameOk)}>
              등록
            </button>
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText(''); setFileRows(null) }}>
              취소
            </button>
          </div>
        </div>
      )}

      {students.length === 0 && selected !== 'new' ? (
        <p className="muted">아직 학생이 없습니다. 나이스 명렬표 엑셀을 올리거나 붙여넣으세요.</p>
      ) : (
        <div className="roster-layout">
          <div className="roster-list stack">
            <input type="search" aria-label="학생 찾기" placeholder="이름·번호 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="plain" aria-label="학생 명단">
              {shown.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`roster-item${s.active ? '' : ' inactive'}`} aria-current={current?.id === s.id && selected !== 'new' ? 'true' : undefined} onClick={() => setSelected(s.id)}>
                    <span className="pii">{`${s.number}번 ${s.name}`}</span>
                    {!s.active && <span className="tag">(전출)</span>}
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="muted">찾는 학생이 없습니다.</li>}
            </ul>
          </div>
          <div className="roster-detail">
            {selected === 'new' ? (
              <StudentDetail key="new" classId={classId} onDone={() => { setSelected(null); reload() }} />
            ) : current ? (
              <StudentDetail key={current.id + current.updated_at} classId={classId} student={current} closable={false} onDone={() => reload()} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
