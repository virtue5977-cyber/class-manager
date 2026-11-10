import { useCallback, useEffect, useRef, useState } from 'react'
import PageHead from '../../components/PageHead'
import ExportMenu from '../../components/ExportMenu'
import { exportPdf } from '../../lib/export/pdf'
import { Link } from 'react-router-dom'
import { listReflections } from '../../lib/reflection/store'
import { useLive } from '../../lib/ui/useLive'
import type { ReflectionRec } from '../../lib/db/types'
import { isHideNames } from '../../components/HideNames'
import { useAi, useDb, useFs } from '../../app/context'
import type { CounselingLogRec, StudentRec } from '../../lib/db/types'
import { listStudents } from '../../lib/roster/roster'
import { deleteLog, listLogsByStudent, listLogsByStudents, logTags, METHODS, nugaCopyText, nugaHeader, saveLog, searchLogs, TARGETS, TOPICS, updateNuga } from '../../lib/counseling/counseling'
import { runNuga } from '../../lib/counseling/nuga'
import { getSettings } from '../../lib/settings'
import { buildTableHwpx } from '../../lib/docs/table-doc'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { hashParam, ymdParam } from '../../lib/ui/hashParam'
import { addDays, toYmd } from '../../lib/schoolDays'
import { ClassSelect, NoClass, useClasses } from '../common/useClasses'

type Filter = '전체' | '미정리' | '나이스 미입력'

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function CounselingPage({ today = toYmd(new Date()) }: { today?: string }) {
  // 달력에서 날짜를 골라 오면 새 기록 날짜가 그날로 잡힌다.
  const [newLogDate] = useState(() => ymdParam() ?? today)
  const db = useDb()
  const fs = useFs()
  const ai = useAi()
  const { classes, classId, choose } = useClasses()
  const [students, setStudents] = useState<StudentRec[]>([])
  // 명령·할 일 링크(#/counseling?sid=…)로 오면 그 학생을 연다.
  const [selected, setSelected] = useState<string | undefined>(() => hashParam('sid') ?? undefined)
  const [logs, setLogs] = useState<CounselingLogRec[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [lastDate, setLastDate] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<'번호순' | '오래된 순'>('번호순')
  const [filter, setFilter] = useState<Filter>('전체')
  const [topic, setTopic] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ log: CounselingLogRec; student: StudentRec }[] | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  const [warnings, setWarnings] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string>() // 원문 고치는 기록 id
  const [adding, setAdding] = useState(false)
  const [aiOff, setAiOff] = useState(false)
  const [flash, setFlash] = useState<string>()
  const seq = useRef(0)

  const student = students.find((s) => s.id === selected)
  const reflections = useLive<ReflectionRec[]>(() => (selected ? listReflections(db, selected) : Promise.resolve([])), [db, selected], [])

  const reload = useCallback(async () => {
    if (!classId) return
    const n = ++seq.current
    const studs = await listStudents(db, classId)
    const all = await listLogsByStudents(db, studs.map((s) => s.id))
    const c: Record<string, number> = Object.fromEntries(studs.map((s) => [s.id, all[s.id].length]))
    const mine = selected ? (all[selected] ?? (await listLogsByStudent(db, selected))) : []
    if (n !== seq.current) return
    setStudents(studs)
    setCounts(c)
    setLastDate(Object.fromEntries(studs.map((s) => [s.id, all[s.id].at(-1)?.date ?? ''])))
    setLogs(mine)
  }, [db, classId, selected])
  useEffect(() => {
    reload()
  }, [reload])

  if (classes && classes.length === 0) return <NoClass title="상담일지" />

  async function act(fn: () => Promise<string[] | void>) {
    setMessages([])
    try {
      const m = await fn()
      if (m) setMessages(m)
    } catch (e) {
      setMessages([e instanceof Error ? e.message : String(e)])
    }
    await reload()
  }

  async function organize(targets: CounselingLogRec[]) {
    if (!student) return
    const s = await getSettings(db)
    setAiOff(!s.ai_enabled)
    if (!s.ai_enabled) return setMessages([])
    if (!targets.length) return setMessages(['정리할 기록이 없습니다.'])
    setBusy(true)
    await act(async () => {
      const results = await runNuga(db, ai, student, students, targets)
      setWarnings((w) => ({ ...w, ...Object.fromEntries(results.map((r) => [r.id, r.warnings])) }))
      return [`${results.filter((r) => r.text).length}건을 누가기록으로 정리했습니다.`]
    })
    setBusy(false)
  }

  /** 파일 이름: 이름 가림 중이면 번호만(저장 창에 이름이 비치지 않게). */
  const fileStem = () => (student ? (isHideNames() ? `${student.number}번_상담일지` : `${student.number}번_${student.name}_상담일지`) : '상담일지')
  async function exportLogs(kind: 'hwpx' | 'xlsx') {
    if (!student) return
    const header = ['날짜', '장소', '대상·방법·분야', '누가기록(정리본 또는 원문)']
    const rows = logs.map((l) => [nugaHeader(l.date, '').replace(/\s\|.*$/, ''), l.place, [l.target, l.method, l.topic].filter(Boolean).join(' · '), l.nuga_text || l.content])
    const title = `${student.number}번 ${student.name} 상담일지`
    const bytes = kind === 'hwpx' ? await buildTableHwpx({ title, header, rows, colRatios: [3, 3, 3, 10], fontSizePt: 10 }) : await writeSimpleXlsx('상담일지', [header, ...rows])
    const name = `${fileStem()}.${kind}`
    fs.downloadFile(name, bytes)
    setMessages([`${name} 파일을 만들었습니다.`])
  }

  const shown = logs
    .filter((l) => (filter === '미정리' ? l.nuga_status === '미정리' : filter === '나이스 미입력' ? l.nuga_status !== '나이스 입력 완료' : true))
    .filter((l) => !topic || l.topic === topic)
  const unorganized = logs.filter((l) => l.nuga_status === '미정리')

  return (
    <section className="stack">
      <PageHead title="상담일지">
        {classes && <ClassSelect classes={classes} classId={classId} onChange={(id) => { setSelected(undefined); choose(id) }} />}
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault()
            setHits(await searchLogs(db, students, query))
          }}
        >
          <label className="inline">
            <span className="sr-only">검색</span>
            <input aria-label="검색" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="학급 전체 기록에서 찾기" />
          </label>
          <button type="submit">찾기</button>
          {hits && (
            <button type="button" onClick={() => setHits(null)}>
              검색 닫기
            </button>
          )}
        </form>
      </PageHead>
      {aiOff && (
        <p className="banner" role="status">
          AI가 꺼져 있습니다. 연결 방식(Claude Code 또는 API 키)을 고르고 'AI 정리 사용'을 켜세요. <a href="#/settings?tab=ai">설정 &gt; AI 열기</a>
        </p>
      )}
      {messages.length > 0 && (
        <div className="notice" role="status">
          {messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {hits && (
        <div className="card stack wide" aria-label="검색 결과">
          <h3>{`"${query}" 검색 결과 ${hits.length}건`}</h3>
          {hits.map(({ log, student: s }) => (
            <button key={log.id} type="button" className="link left" onClick={() => { setSelected(s.id); setHits(null) }}>
              {`${s.number}번 ${s.name} · ${nugaHeader(log.date, log.place)} · ${(log.nuga_text || log.content).slice(0, 40)}`}
            </button>
          ))}
        </div>
      )}
      <div className="counsel-layout">
        <div className="stack">
        <label className="inline">
          정렬
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option>번호순</option>
            <option>오래된 순</option>
          </select>
        </label>
        <ul className="plain student-list compact" aria-label="학생 목록">
          {(sort === '번호순' ? students : [...students].sort((a, b) => (lastDate[a.id] ?? '').localeCompare(lastDate[b.id] ?? '') || a.number - b.number)).map((s) => {
            const last = lastDate[s.id]
            // 한 달 넘게 기록이 없는 학생은 놓치지 않게 표시한다(조용한 학생 챙기기).
            const stale = !!last && last < addDays(today, -30)
            return (
              <li key={s.id}>
                <button type="button" className={`student-row${selected === s.id ? ' active' : ''}`} onClick={() => { setSelected(s.id); setMessages([]); setEditing(undefined); setAdding(false) }}>
                  <span className="num pii">{`${s.number}번 ${s.name}`}</span>
                  <span className={`att${stale ? ' stale' : ''}`}>
                    {last ? `${counts[s.id]}건 · ${Number(last.slice(5, 7))}/${Number(last.slice(8))}${stale ? ' · 한 달 넘음' : ''}` : '기록 없음'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        </div>
        <div className="stack wide">
          {!student && <p className="muted">학생을 고르세요.</p>}
          {student && (
            <>
              <div className="page-head">
                <div className="pii">
                  <h3 style={{ fontSize: 18, margin: 0 }}>{`${student.number}번 ${student.name}`}</h3>
                  <span className="muted">
                    {[student.guardian_name && `보호자 ${student.guardian_name}`, student.guardian_phone, student.phone && `학생 ${student.phone}`, student.memo].filter(Boolean).join(' · ') || '인적사항은 학급 > 명단에서 입력합니다.'}
                  </span>
                  {reflections.length > 0 && (
                    <Link className="small" to={`/class/reflection?sid=${student.id}`}>{`반성문 ${reflections.length}건`}</Link>
                  )}
                </div>
                {!(adding || logs.length === 0) && (
                  <button type="button" className="primary" onClick={() => setAdding(true)}>
                    + 새 기록
                  </button>
                )}
              </div>
              {(adding || logs.length === 0) && (
                <NewLog
                  key={student.id}
                  today={newLogDate}
                  onCancel={logs.length ? () => setAdding(false) : undefined}
                  onSave={async (input) => {
                    let ok = false
                    await act(async () => {
                      const rec = await saveLog(db, { ...input, student_id: student.id })
                      ok = true
                      setFlash(rec.id)
                      setTimeout(() => setFlash((f) => (f === rec.id ? undefined : f)), 2500)
                    })
                    if (ok) setAdding(false)
                    return ok
                  }}
                />
              )}
              <div className="log-toolbar">
                <label className="inline">
                  보기
                  <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                    <option>전체</option>
                    <option>미정리</option>
                    <option>나이스 미입력</option>
                  </select>
                </label>
                <label className="inline">
                  분야 보기
                  <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                    <option value="">전체</option>
                    {TOPICS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <span className="spacer" />
                <button type="button" disabled={busy || !unorganized.length} onClick={() => organize(unorganized)}>
                  {busy ? '정리 중…' : `미정리 ${unorganized.length}건 누가기록으로 정리`}
                </button>
                {logs.length > 0 && <ExportMenu items={[{ format: 'hwpx', run: () => exportLogs('hwpx') }, { format: 'xlsx', run: () => exportLogs('xlsx') }, { format: 'pdf', run: () => exportPdf(`${fileStem()}.pdf`) }]} />}
              </div>
              {shown.length === 0 && <p className="muted">{logs.length ? '해당하는 기록이 없습니다.' : '아직 기록이 없습니다.'}</p>}
              {[...shown].reverse().map((l) => (
                <LogCard
                  key={l.id}
                  log={l}
                  flash={flash === l.id}
                  busy={busy}
                  editing={editing === l.id}
                  warnings={warnings[l.id] ?? []}
                  onEdit={() => setEditing(l.id)}
                  onCancelEdit={() => setEditing(undefined)}
                  onSaveContent={(input) => act(async () => { await saveLog(db, { ...input, student_id: l.student_id }, l.id); setEditing(undefined) })}
                  onDelete={() => act(async () => void (await deleteLog(db, l.id)))}
                  onOrganize={() => organize([l])}
                  onSaveNuga={(text) => act(async () => void (await updateNuga(db, l.id, { nuga_text: text })))}
                  onStatus={(done) => act(async () => void (await updateNuga(db, l.id, { nuga_status: done ? '나이스 입력 완료' : l.nuga_text ? '정리됨' : '미정리' })))}
                  onCopy={async (text) => setMessages([(await copy(nugaCopyText({ ...l, nuga_text: text }))) ? '복사했습니다. 나이스에 붙여넣으세요.' : '복사하지 못했습니다. 글을 직접 선택해 복사하세요.'])}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

export type LogFields = { date: string; place: string; content: string; target: string; method: string; topic: string; time: string }
export const blankFields = (date: string): LogFields => ({ date, place: '', content: '', target: '학생', method: '대면', topic: '', time: '' })

function Choice({ label, options, value, onChange, allowEmpty }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  return (
    <div className="row choice" role="radiogroup" aria-label={label}>
      <span className="muted">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'on' : undefined} onClick={() => onChange(allowEmpty && value === o ? '' : o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

export function LogFieldsForm({ initial, submitLabel, onSubmit, onCancel, onCancelNew }: { initial: LogFields; submitLabel: string; onSubmit: (f: LogFields) => unknown; onCancel?: () => void; onCancelNew?: () => void }) {
  const [f, setF] = useState(initial)
  return (
    <form
      className="stack wide"
      onSubmit={async (e) => {
        e.preventDefault()
        // 새 기록은 저장에 성공했을 때만 칸을 비운다(실패하면 쓴 글을 남김).
        if ((await onSubmit(f)) === true && !onCancel) setF({ ...initial, content: '', time: '' })
      }}
    >
      <div className="row">
        <label className="inline">
          날짜
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label className="inline">
          시각
          <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
        </label>
        <label className="inline">
          장소
          <input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="예: 점심시간 교실" />
        </label>
      </div>
      <Choice label="대상" options={TARGETS} value={f.target} onChange={(v) => setF({ ...f, target: v })} />
      <Choice label="방법" options={METHODS} value={f.method} onChange={(v) => setF({ ...f, method: v })} />
      <Choice label="분야" options={TOPICS} value={f.topic} onChange={(v) => setF({ ...f, topic: v })} allowEmpty />
      <label className="wide">
        내용(개조식 메모나 녹음 글)
        <textarea rows={3} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
      </label>
      <div className="row">
        <button type="submit" className="primary">
          {submitLabel}
        </button>
        {(onCancel || onCancelNew) && (
          <button type="button" onClick={onCancel ?? onCancelNew}>
            취소
          </button>
        )}
      </div>
    </form>
  )
}

function NewLog({ today, onSave, onCancel }: { today: string; onSave: (f: LogFields) => Promise<boolean>; onCancel?: () => void }) {
  return (
    <div className="card wide stack" aria-label="새 기록">
      <h3>새 기록</h3>
      <LogFieldsForm initial={blankFields(today)} submitLabel="기록 추가" onSubmit={onSave} onCancelNew={onCancel} />
    </div>
  )
}

function LogCard(p: {
  log: CounselingLogRec
  flash?: boolean
  busy: boolean
  editing: boolean
  warnings: string[]
  onEdit: () => void
  onCancelEdit: () => void
  onSaveContent: (f: LogFields) => void
  onDelete: () => void
  onOrganize: () => void
  onSaveNuga: (text: string) => void
  onStatus: (done: boolean) => void
  onCopy: (currentText: string) => void
}) {
  const l = p.log
  const [nuga, setNuga] = useState(l.nuga_text)
  const [writing, setWriting] = useState(false)
  const hasNuga = !!l.nuga_text || writing
  // AI 정리 등으로 저장값이 바뀌면 칸도 따라간다(카드를 다시 만들지 않아 포커스·클릭이 끊기지 않음).
  useEffect(() => setNuga(l.nuga_text), [l.nuga_text])
  const head = nugaHeader(l.date, l.place)
  return (
    <article className={`log${p.flash ? ' flash' : ''}`} aria-label={`${head} 기록`}>
      <div className="row wide">
        <strong>{head}</strong>
        {logTags(l) && <span className="muted">{logTags(l)}</span>}
        <span className={`tag status-${l.nuga_status === '나이스 입력 완료' ? '나이스' : l.nuga_status}`}>{l.nuga_status}</span>
      </div>
      {p.editing ? (
        <LogFieldsForm initial={{ ...blankFields(l.date), place: l.place, content: l.content, target: l.target || '학생', method: l.method || '대면', topic: l.topic ?? '', time: l.time ?? '' }} submitLabel="고친 내용 저장" onSubmit={p.onSaveContent} onCancel={p.onCancelEdit} />
      ) : (
        <p className="pre pii">{l.content}</p>
      )}
      {hasNuga && (
      <>
      <label className="wide">
        누가기록
        <textarea className="pii" rows={3} autoFocus={writing && !l.nuga_text} value={nuga} onChange={(e) => setNuga(e.target.value)} onBlur={() => nuga !== l.nuga_text && p.onSaveNuga(nuga.trim())} placeholder="AI로 정리하거나 직접 쓰세요." />
      </label>
      <span className="muted">{`${nuga.length}자`}</span>
      </>
      )}
      {p.warnings.map((w) => (
        <p key={w} className="warn">
          {`⚠ ${w}`}
        </p>
      ))}
      <div className="row log-actions">
        <button type="button" disabled={p.busy} onClick={p.onOrganize}>
          {l.nuga_text ? '다시 정리' : '누가기록으로 정리'}
        </button>
        {!hasNuga && (
          <button type="button" className="link" onClick={() => setWriting(true)}>
            직접 쓰기
          </button>
        )}
        {hasNuga && (
          <>
            <button type="button" onClick={() => p.onCopy(nuga.trim())}>
              복사
            </button>
            <label className="inline">
              <input type="checkbox" checked={l.nuga_status === '나이스 입력 완료'} onChange={(e) => p.onStatus(e.target.checked)} />
              나이스 입력 완료
            </label>
          </>
        )}
        <span className="spacer" />
        {!p.editing && (
          <button type="button" className="link" onClick={p.onEdit}>
            원문 고치기
          </button>
        )}
        <button type="button" className="link" onClick={p.onDelete}>
          지우기
        </button>
      </div>
    </article>
  )
}
