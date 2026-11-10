import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAi, useDb, useFs } from '../../app/context'
import type { ClassRec, ReflectionPhraseRec, ReflectionRec, StudentRec } from '../../lib/db/types'
import { listStudents } from '../../lib/roster/roster'
import { DEFAULT_LINES, DEFAULT_T1, DEFAULT_T2, listPhrases, listReflections, readPhrases, saveReflection, starPhrase, unstarPhrase } from '../../lib/reflection/store'
import { bodyOpts, fitLine, MODES, titleOpts, type PaperMode } from '../../lib/reflection/fit'
import { distribute } from '../../lib/reflection/split'
import { buildReflectionHwpx } from '../../lib/reflection/hwpx'
import { fillByAi } from '../../lib/reflection/ai'
import { getPrompt, resetPrompt, savePrompt } from '../../lib/ai/prompts'
import { createNote, newBlockId } from '../../lib/notes/notes'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { exportPdf } from '../../lib/export/pdf'
import { schoolYearOf } from '../../lib/command/chatLog'
import { toYmd } from '../../lib/schoolDays'
import { useLive } from '../../lib/ui/useLive'
import ExportMenu from '../../components/ExportMenu'

const dotDate = (ymd: string) => `${ymd.slice(0, 4)}.${ymd.slice(5, 7)}.${ymd.slice(8, 10)}.`
const md = (ymd: string) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}`
const studentNo = (c: ClassRec, s: StudentRec) => `${c.grade}${String(c.class_no).padStart(2, '0')}${String(s.number).padStart(2, '0')}`

/** 학급 > 반성문: 왼쪽 학생, 가운데 양식(바로 고침), 오른쪽 사유·AI·나누기·모음·맞춤. */
export default function ReflectionTab({ classRec, today = toYmd(new Date()) }: { classRec: ClassRec; today?: string }) {
  const db = useDb()
  const fs = useFs()
  const ai = useAi()
  const [params] = useSearchParams()
  const students = useLive<StudentRec[]>(() => listStudents(db, classRec.id, { includeInactive: false }), [db, classRec.id], [])
  const [sid, setSid] = useState<string | null>(params.get('sid'))
  const [q, setQ] = useState('')
  const [editId, setEditId] = useState<string>()
  const [date, setDate] = useState(today)
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<string[]>([...DEFAULT_LINES])
  const [t1, setT1] = useState(DEFAULT_T1)
  const [t2, setT2] = useState(DEFAULT_T2)
  const [mode, setMode] = useState<PaperMode>('B4')
  const [auto, setAuto] = useState(true)
  const [minSp, setMinSp] = useState(-15)
  const [minPt, setMinPt] = useState(10)
  const [sel, setSel] = useState(0)
  const [raw, setRaw] = useState('')
  const [msg, setMsg] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<'main' | 'phrases' | 'fit'>('main')
  // 저장하지 않은 고침이 있는지: 불러온(또는 저장한) 때와 비교
  const snap = () => JSON.stringify({ date, reason, lines, t1, t2 })
  const [baseline, setBaseline] = useState(() => JSON.stringify({ date: today, reason: '', lines: DEFAULT_LINES, t1: DEFAULT_T1, t2: DEFAULT_T2 }))
  const dirty = snap() !== baseline
  const [pendingSid, setPendingSid] = useState<string>()
  // 종이는 실제 크기(mm·pt)로 그리고, 화면 폭에 맞게 줄여 보인다(글자 맞춤과 같은 기준).
  const wrap = useRef<HTMLElement>(null)
  const [fitZoom, setFitZoom] = useState(1)
  /** 미리보기 크기: 맞춤(폭에 맞게 줄임) · 100% · 125%(넘치면 옆으로 밀어 봄). 이 기기에 기억. */
  const [size, setSize] = useState<'fit' | '1' | '1.25'>(() => {
    try {
      const v = localStorage.getItem('watson.refl.size')
      return v === '1' || v === '1.25' ? v : 'fit'
    } catch {
      return 'fit'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('watson.refl.size', size)
    } catch {
      /* 기억 못 해도 그대로 */
    }
  }, [size])
  const zoom = size === 'fit' ? fitZoom : Number(size)
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const mmPx = 96 / 25.4
    const ro = new ResizeObserver(() => setFitZoom(Math.min(1, (el.clientWidth - 24) / (MODES[mode].pw * mmPx))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode])
  const student = students.find((s) => s.id === sid)
  const history = useLive<ReflectionRec[]>(() => listReflections(db, sid ?? undefined), [db, sid], [])
  const all = useLive<ReflectionRec[]>(() => listReflections(db), [db], [])
  // liveQuery 안에서는 쓸 수 없어 처음 넣기(기본 16문장)는 따로 한다.
  useEffect(() => {
    if (panel === 'phrases') listPhrases(db).catch(() => {})
  }, [db, panel])
  const phrases = useLive<ReflectionPhraseRec[]>(() => readPhrases(db), [db], [])
  const fo = { auto, minSp, minPt }
  const fits = useMemo(() => lines.map((l, i) => fitLine(l ? `${i + 1}. ${l}` : '', bodyOpts(mode, fo))), [lines, mode, auto, minSp, minPt]) // eslint-disable-line react-hooks/exhaustive-deps
  const tfits = [fitLine(t1, titleOpts(mode, fo)), fitLine(t2, titleOpts(mode, fo))]
  const over = fits.filter((f) => f.over).length
  const thisYear = all.filter((r) => schoolYearOf(r.date) === schoolYearOf(today)).length

  useEffect(() => {
    // B4 양식은 인쇄·PDF 용지도 B4로
    const st = document.createElement('style')
    st.textContent = `@media print { @page { size: ${MODES[mode].pw}mm ${MODES[mode].ph}mm; margin: 0 } }`
    document.head.appendChild(st)
    return () => st.remove()
  }, [mode])

  const doc = () => ({ date: dotDate(date), no: student ? studentNo(classRec, student) : '', name: student?.name ?? '', t1, t2, lines, mode, fitOpts: fo })
  const fileStem = () => `반성문_${student?.name ?? '학생'}_${date}`
  const act = async (fn: () => Promise<unknown>) => {
    setMsg(undefined)
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  function open(r: ReflectionRec) {
    setBaseline(JSON.stringify({ date: r.date, reason: r.reason, lines: r.lines, t1: r.t1, t2: r.t2 }))
    setEditId(r.id)
    setDate(r.date)
    setReason(r.reason)
    setLines([...r.lines])
    setT1(r.t1)
    setT2(r.t2)
    setMode(r.mode)
  }
  function fresh() {
    setBaseline(JSON.stringify({ date: today, reason: '', lines: DEFAULT_LINES, t1, t2 }))
    setEditId(undefined)
    setDate(today)
    setReason('')
    setLines([...DEFAULT_LINES])
  }
  const setLine = (i: number, v: string) => setLines((ls) => ls.map((x, k) => (k === i ? v : x)))
  const shown = q.trim() ? students.filter((s) => s.name.includes(q.trim()) || String(s.number) === q.trim()) : students

  return (
    <div className="reflection">
      <div className="row between">
        <span className="muted">{`이번 학년도 ${thisYear}건${over ? ` · 넘치는 줄 ${over}개` : ''}`}</span>
        <div className="row">
          <div className="seg paper-mode" role="radiogroup" aria-label="용지">
            {(['B4', 'A4'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : undefined} onClick={() => setMode(m)}>
                {m === 'B4' ? 'B4(원본)' : 'A4'}
              </button>
            ))}
          </div>
          <button type="button" onClick={fresh}>새로 쓰기</button>
          <button type="button" className="primary" disabled={!student} onClick={() => act(async () => {
            const r = await saveReflection(db, { student_id: student!.id, date, reason, lines, t1, t2, mode }, editId)
            setEditId(r.id)
            setBaseline(snap())
            setMsg('저장했습니다.')
          })}>
            저장
          </button>
          <button type="button" disabled={!student} onClick={() => act(async () => {
            const n = await createNote(db, `${md(date)} 반성문 ${student!.number}번`, [{ id: newBlockId(), type: 'p', text: `사유: ${reason}` }, ...lines.filter(Boolean).map((l) => ({ id: newBlockId(), type: 'number' as const, text: l })), { id: newBlockId(), type: 'p', text: '#/class/reflection' }])
            setMsg(`노트 '${n.title}'로 보냈습니다.`)
          })}>
            노트로 보내기
          </button>
          <ExportMenu
            items={[
              { format: 'hwpx', run: async () => fs.downloadFile(`${fileStem()}.hwpx`, await buildReflectionHwpx(doc())) },
              { format: 'pdf', run: () => exportPdf(`${fileStem()}.pdf`, { pageSize: mode }) },
              { format: 'xlsx', run: async () => {
                const byId = new Map(students.map((s) => [s.id, s]))
                fs.downloadFile(`반성문_목록_${today}.xlsx`, await writeSimpleXlsx('반성문', [['날짜', '번호', '이름', '사유'], ...all.map((r) => [r.date, String(byId.get(r.student_id)?.number ?? ''), byId.get(r.student_id)?.name ?? '', r.reason])]))
              } },
            ]}
          />
        </div>
      </div>
      {msg && <p className="notice" role="status">{msg}</p>}
      {pendingSid && (
        <div className="banner row" role="alertdialog" aria-label="저장하지 않은 반성문">
          <span>저장하지 않은 내용이 있습니다. 버리고 다른 학생으로 바꿀까요?</span>
          <button type="button" className="danger" onClick={() => { setSid(pendingSid); setPendingSid(undefined); fresh() }}>버리고 바꾸기</button>
          <button type="button" className="link" onClick={() => setPendingSid(undefined)}>취소</button>
        </div>
      )}
      <div className="reflection-layout">
        <div className="roster-list stack">
          <input type="search" aria-label="학생 찾기" placeholder="이름·번호 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="plain" aria-label="학생 목록">
            {shown.map((s) => (
              <li key={s.id}>
                <button type="button" className="roster-item" aria-current={s.id === sid ? 'true' : undefined} onClick={() => {
                  if (s.id === sid) return
                  if (dirty) return setPendingSid(s.id)
                  setSid(s.id)
                  fresh()
                }}>
                  <span className="pii">{`${s.number}번 ${s.name}`}</span>
                </button>
              </li>
            ))}
          </ul>
          {student && (
            <ul className="plain" aria-label="지난 반성문">
              {history.map((r) => (
                <li key={r.id}>
                  <button type="button" className="link" onClick={() => open(r)}>{`${md(r.date)} ${r.reason || '(사유 없음)'}`}</button>
                </li>
              ))}
              {history.length === 0 && <li className="muted">지난 반성문이 없습니다.</li>}
            </ul>
          )}
        </div>

        <div className="paper-col stack">
        <div className="paper-tools">
          <div className="seg" role="radiogroup" aria-label="미리보기 크기">
            {([['fit', '맞춤'], ['1', '100%'], ['1.25', '125%']] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={size === v} className={size === v ? 'on' : undefined} onClick={() => setSize(v)}>
                {label}
              </button>
            ))}
          </div>
          <label className="paper-big">
            <span className="muted">{`${sel + 1}번 줄`}</span>
            <input
              aria-label={`고른 줄(${sel + 1}번) 크게 고치기`}
              aria-invalid={fits[sel]?.over ? 'true' : undefined}
              value={lines[sel] ?? ''}
              onChange={(e) => setLine(sel, e.target.value)}
            />
            <span className={fits[sel]?.over ? 'error' : 'muted'}>{fits[sel]?.over ? `${fits[sel].overChars}자 넘침` : `${(lines[sel] ?? '').length}자`}</span>
          </label>
        </div>
        <section className="paper-wrap" aria-label="반성문 양식" ref={wrap}>
          <div className={`paper print-area paper-${mode}`} style={{ width: `${MODES[mode].pw}mm`, minHeight: `${MODES[mode].ph}mm`, zoom }}>
            <table className="paper-table" style={{ width: `${(65174 * MODES[mode].k) / 100}pt` }}>
              <tbody>
                <tr className="paper-head">
                  <th>날짜</th>
                  <td>{student ? dotDate(date) : ''}</td>
                  <th>학번</th>
                  <td>{student ? studentNo(classRec, student) : ''}</td>
                  <th>이름</th>
                  <td className="pii">{student?.name ?? ''}</td>
                </tr>
                <tr>
                  <td colSpan={6} className="paper-title">
                    <div style={{ fontSize: `${tfits[0].pt}pt`, letterSpacing: `${tfits[0].sp / 100}em` }} className={tfits[0].over ? 'over' : undefined}><b>{t1}</b></div>
                    <div style={{ fontSize: `${tfits[1].pt}pt`, letterSpacing: `${tfits[1].sp / 100}em` }} className={tfits[1].over ? 'over' : undefined}>{t2}</div>
                  </td>
                </tr>
                {lines.map((l, i) => (
                  <PaperLine key={i} i={i} value={l} fit={fits[i]} selected={sel === i} onFocus={() => setSel(i)} onChange={(v) => setLine(i, v)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        </div>

        <aside className="reflection-side stack">
          <div className="seg" role="tablist" aria-label="도구">
            <button type="button" role="tab" aria-selected={panel === 'main'} onClick={() => setPanel('main')}>쓰기</button>
            <button type="button" role="tab" aria-selected={panel === 'phrases'} onClick={() => setPanel('phrases')}>좋은 문장 모음</button>
            <button type="button" role="tab" aria-selected={panel === 'fit'} onClick={() => setPanel('fit')}>맞춤</button>
          </div>
          {panel === 'main' && (
            <>
              <label className="wide">
                날짜
                <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </label>
              <label className="wide">
                사유
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 수업 중 휴대폰 사용" />
              </label>
              <button type="button" className="primary" disabled={busy} onClick={() => act(async () => {
                setBusy(true)
                try {
                  setLines(await fillByAi(db, ai, reason, students.map((s) => s.name), mode))
                  setMsg('AI가 16줄을 채웠습니다. 읽어 보고 고치세요.')
                } finally {
                  setBusy(false)
                }
              })}>
                {busy ? '만드는 중…' : 'AI로 16줄 채우기'}
              </button>
              <p className="muted small">AI에는 사유만 보냅니다(학생 이름·학번은 보내지 않음).</p>
              <PromptBox />
              <label className="wide">
                붙여 넣을 글
                <textarea rows={4} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="반성문 전체를 붙여 넣으면 문장 단위로 16줄에 나눕니다." />
              </label>
              <button type="button" onClick={() => {
                const ls = distribute(raw, mode)
                setLines(Array.from({ length: 16 }, (_, i) => ls[i] ?? ''))
                setMsg(ls.length > 16 ? `${ls.length}줄 분량이라 16줄만 채웠습니다. 내용을 줄이세요.` : `${ls.length}줄로 채웠습니다.`)
              }}>
                16줄로 나누기
              </button>
              <button type="button" className="link" onClick={() => { setLines([...DEFAULT_LINES]); setT1(DEFAULT_T1); setT2(DEFAULT_T2) }}>
                양식 기본 문장으로 되돌리기
              </button>
            </>
          )}
          {panel === 'phrases' && (
            <>
              <p className="muted small">{`고른 줄: ${sel + 1}번. '넣기'를 누르면 그 줄에 들어갑니다.`}</p>
              <button type="button" className="link" disabled={!lines[sel]} onClick={() => act(() => starPhrase(db, lines[sel]))}>★ 고른 줄을 모음에 넣기</button>
              <ul className="plain phrase-list" aria-label="좋은 문장">
                {phrases.map((p) => (
                  <li key={p.id}>
                    <span>{p.text}</span>
                    <button type="button" className="link" onClick={() => setLine(sel, p.text)}>넣기</button>
                    <button type="button" className="icon-btn" aria-label="모음에서 빼기" onClick={() => unstarPhrase(db, p.id)}>×</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {panel === 'fit' && (
            <>
              <label className="inline">
                용지
                <select value={mode} onChange={(e) => setMode(e.target.value as PaperMode)}>
                  <option value="B4">B4(원본 양식)</option>
                  <option value="A4">A4</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                넘치면 자동으로 줄이기
              </label>
              <label className="inline">
                최소 자간(%)
                <input type="number" value={minSp} max={0} min={-50} onChange={(e) => setMinSp(Math.min(0, Number(e.target.value) || -15))} />
              </label>
              <label className="inline">
                최소 크기(pt)
                <input type="number" value={minPt} min={6} max={12} step={0.5} onChange={(e) => setMinPt(Number(e.target.value) || 10)} />
              </label>
              <label className="wide">
                위 안내 1
                <input value={t1} onChange={(e) => setT1(e.target.value)} />
              </label>
              <label className="wide">
                위 안내 2
                <input value={t2} onChange={(e) => setT2(e.target.value)} />
              </label>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function PaperLine({ i, value, fit, selected, onFocus, onChange }: { i: number; value: string; fit: ReturnType<typeof fitLine>; selected: boolean; onFocus: () => void; onChange: (v: string) => void }) {
  const note = fit.over ? `${fit.overChars}자 넘침 — 줄여 주세요` : fit.state === 'sp' ? `자간 ${fit.sp}%` : fit.state === 'pt' ? `${fit.pt}pt · 자간 ${fit.sp}%` : ''
  return (
    <>
      <tr className={`paper-line${selected ? ' sel' : ''}`}>
        <td colSpan={6}>
          <div className="paper-cell">
          <span className="paper-no" style={{ fontSize: `${fit.pt}pt`, letterSpacing: `${fit.sp / 100}em` }}>{`${i + 1}.`}&nbsp;</span>
          <input
            aria-label={`${i + 1}번 줄`}
            aria-invalid={fit.over ? 'true' : undefined}
            title={note}
            className={fit.over ? 'over' : undefined}
            style={{ fontSize: `${fit.pt}pt`, letterSpacing: `${fit.sp / 100}em` }}
            value={value}
            onFocus={onFocus}
            onChange={(e) => onChange(e.target.value)}
          />
          </div>
        </td>
      </tr>
      <tr className="paper-blank">
        <td colSpan={6} />
      </tr>
    </>
  )
}

/** 반성문 AI 지시문: 이 화면에서 고치고 기본으로 되돌린다(길이·출력 형식은 앱이 붙임). */
function PromptBox() {
  const db = useDb()
  const [text, setText] = useState<string>()
  const [msg, setMsg] = useState<string>()
  return (
    <details className="prompt-box" onToggle={async (e) => (e.currentTarget as HTMLDetailsElement).open && text === undefined && setText(await getPrompt(db, 'reflection'))}>
      <summary>AI 지시문 고치기</summary>
      <textarea aria-label="반성문 AI 지시문" rows={8} value={text ?? ''} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button type="button" onClick={async () => { await savePrompt(db, 'reflection', text ?? ''); setMsg('저장했습니다.') }}>지시문 저장</button>
        <button type="button" className="link" onClick={async () => { await resetPrompt(db, 'reflection'); setText(await getPrompt(db, 'reflection')); setMsg('기본으로 되돌렸습니다.') }}>기본으로 되돌리기</button>
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
      <p className="muted small">문장 길이(용지에 맞춘 글자 수)와 출력 형식은 앱이 따로 붙입니다.</p>
    </details>
  )
}
