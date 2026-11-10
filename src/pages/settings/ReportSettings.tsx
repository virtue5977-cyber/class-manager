import JSZip from 'jszip'
import FormScan from './FormScan'
import { scanCells, type FormCell } from '../../lib/hwpx/absence/scan'
import { CATEGORIES } from '../../lib/stats'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDb, useFs } from '../../app/context'
import type { AppSettingsRec, AttendanceCategory, AttendanceKind, HwpxTemplateRec } from '../../lib/db/types'
import { getSettings, updateSettings } from '../../lib/settings'
import { studentCode } from '../../lib/absenceReports/compute'
import { reconcileAll } from '../../lib/absenceReports/reconcile'
import { listClasses } from '../../lib/roster/roster'
import { ABSENCE_PLACEHOLDERS } from '../../lib/hwpx/absence/build'
import {
  activateTemplate, buildPlaceholderGuideHwpx, defaultTemplateBytes, getActiveTemplate, inspectTemplate, installTemplate, listTemplates, useDefaultTemplate,
} from '../../lib/hwpx/absence/template'

const KINDS: AttendanceKind[] = ['결석', '지각', '조퇴', '결과']
const CATS: AttendanceCategory[] = CATEGORIES

export default function ReportSettings() {
  const db = useDb()
  const fs = useFs()
  const [s, setS] = useState<AppSettingsRec | null>(null)
  const [teacher, setTeacher] = useState('')
  const [format, setFormat] = useState('')
  const [diag, setDiag] = useState('')
  const [templates, setTemplates] = useState<HwpxTemplateRec[]>([])
  const [active, setActive] = useState('')
  const [notice, setNotice] = useState<string[]>([])
  const [scan, setScan] = useState<{ name: string; bytes: Uint8Array; cells: FormCell[] } | null>(null)

  const load = useCallback(async () => {
    const cur = await getSettings(db)
    setS(cur)
    setTeacher(cur.teacher_name)
    setFormat(cur.student_code_format)
    setDiag(String(cur.diagnosis_days))
    setTemplates(await listTemplates(db))
    setActive((await getActiveTemplate(db)).label)
  }, [db])
  useEffect(() => {
    load()
  }, [load])

  // 재계산은 한 번에 하나씩 차례로(빠르게 여러 칸을 눌러도 계산이 서로 엇갈리지 않게).
  const recalcQueue = useRef<Promise<void>>(Promise.resolve())
  function recalcAll(): Promise<void> {
    const run = recalcQueue.current.then(async () => {
      for (const c of await listClasses(db)) await reconcileAll(db, c.id)
    })
    recalcQueue.current = run.catch(() => {})
    return run
  }

  async function toggleRule(key: string, on: boolean) {
    // 저장된 최신 규칙 기준으로 켜고 끈다(화면 값이 늦어도 앞선 클릭을 지우지 않음).
    setS(await updateSettings(db, (cur) => ({ report_rules: on ? [...new Set([...cur.report_rules, key])] : cur.report_rules.filter((r) => r !== key) })))
    await recalcAll()
    setNotice(['신고서를 다시 계산했습니다.'])
  }

  async function saveDiag() {
    const n = Math.round(Number(diag))
    if (!Number.isFinite(n) || n < 1 || n > 10) return setNotice(['진단서가 필요한 일수는 1~10 사이로 입력하세요.'])
    if (s && n !== s.diagnosis_days) {
      setS(await updateSettings(db, { diagnosis_days: n }))
      await recalcAll()
      setNotice(['신고서를 다시 계산했습니다.'])
    }
  }

  async function upload() {
    const f = await fs.pickFileToRead('.hwpx', { maxBytes: 20 * 1024 * 1024 })
    if (!f) return
    if (f.tooBig) return setNotice(['양식 파일이 너무 큽니다(20MB까지).'])
    const name = f.name.replace(/\.hwpx$/i, '')
    // {{표시}}가 하나도 없고 표가 있으면 다른 학교 양식으로 보고 칸을 읽는다
    const check = await inspectTemplate(f.bytes)
    if (!check.ok && !check.found.length && !check.unknown.length && !check.error?.includes('hwpx 파일이 아닙니다')) {
      const zip = await JSZip.loadAsync(f.bytes)
      const cells = scanCells(await zip.file('Contents/section0.xml')!.async('string'))
      if (cells.length) {
        setNotice([])
        return setScan({ name, bytes: f.bytes, cells })
      }
    }
    const r = await installTemplate(db, name, f.bytes)
    const msgs = r.ok ? ['새 양식을 적용했습니다.', `찾은 표시 ${r.found.length}개`] : [r.error ?? '양식을 적용하지 못했습니다.']
    if (r.unknown.length) msgs.push(`알 수 없는 표시: ${r.unknown.map((u) => `{{${u}}}`).join(', ')}`)
    await load() // 현재 양식 표시를 먼저 갱신한 뒤 안내
    setNotice(msgs)
  }

  if (!s) return null
  return (
    <div className="card stack">
      <h3>결석신고서</h3>
      <div className="row">
        <label>
          담임 성명
          <input value={teacher} onChange={(e) => setTeacher(e.target.value)} onBlur={async () => setS(await updateSettings(db, { teacher_name: teacher.trim() }))} />
        </label>
        <label>
          학번 형식
          <input value={format} onChange={(e) => setFormat(e.target.value)} onBlur={async () => setS(await updateSettings(db, { student_code_format: format.trim() || '{학년}{반}{번호2}' }))} />
        </label>
        <span className="muted">{`1학년 5반 3번 → ${studentCode(format || '{학년}{반}{번호2}', 1, 5, 3)}`}</span>
      </div>
      <p className="muted">학번 형식 표시: {'{학년} {반} {반2} {번호} {번호2}'} (2는 두 자리)</p>
      <div className="row">
        <label className="inline">
          진단서가 필요한 결석 일수
          <input type="number" min={1} max={10} value={diag} onChange={(e) => setDiag(e.target.value)} onBlur={saveDiag} />
        </label>
        <span>일 이상</span>
      </div>

      <h4>신고서를 만들 출결</h4>
      <table className="grid rules" aria-label="신고서 규칙">
        <thead>
          <tr>
            <th />
            {CATS.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KINDS.map((k) => (
            <tr key={k}>
              <th>{k}</th>
              {CATS.map((c) => {
                const key = `${k}:${c}`
                return (
                  <td key={c}>
                    <input type="checkbox" aria-label={`${k} ${c}`} checked={s.report_rules.includes(key)} onChange={(e) => toggleRule(key, e.target.checked)} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <h4>양식</h4>
      <p>{`현재 양식: ${active}`}</p>
      <div className="row">
        <button type="button" className="primary" onClick={upload}>
          새 양식 올리기
        </button>
        <span className="muted">{'{{표시}}를 넣은 양식은 바로, 다른 학교 양식(표시 없음)은 칸을 읽어 자리를 찾습니다.'}</span>
        <button type="button" onClick={async () => { await useDefaultTemplate(db); await load(); setNotice(['기본 양식으로 되돌렸습니다.']) }} >
          기본 양식으로 되돌리기
        </button>
        <button type="button" onClick={async () => fs.downloadFile('결석신고서_기본양식.hwpx', await defaultTemplateBytes())}>
          기본 양식 내려받기
        </button>
        <button type="button" onClick={async () => fs.downloadFile('자리표시자_안내.hwpx', await buildPlaceholderGuideHwpx())}>
          자리표시자 안내 내려받기
        </button>
      </div>
      {scan && (
        <FormScan
          name={scan.name}
          bytes={scan.bytes}
          cells={scan.cells}
          aiOn={!!s.ai_enabled}
          onCancel={() => setScan(null)}
          onDone={async (msgs) => {
            setScan(null)
            await load()
            setNotice(msgs)
          }}
        />
      )}
      {templates.length > 0 && (
        <ul className="plain">
          {templates.map((t) => (
            <li key={t.id} className="row">
              <span>{`${t.name} v${t.version}${t.active ? ' (사용 중)' : ''}`}</span>
              {!t.active && (
                <button type="button" onClick={async () => { await activateTemplate(db, t.id); await load() }}>
                  이 버전 사용
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>쓸 수 있는 자리표시자 보기</summary>
        <p className="muted">한글에서 학교 양식의 해당 자리에 아래 표시를 그대로 입력해 저장한 뒤 올리세요. 표시 하나는 글꼴을 바꾸지 말고 한 번에 입력하세요.</p>
        <table className="grid" aria-label="자리표시자 목록">
          <tbody>
            {ABSENCE_PLACEHOLDERS.map((p) => (
              <tr key={p.name}>
                <td>{`{{${p.name}}}`}</td>
                <td>{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {notice.length > 0 && (
        <ul className="plain notice" role="status">
          {notice.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
