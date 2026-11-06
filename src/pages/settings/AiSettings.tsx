import { useCallback, useEffect, useState } from 'react'
import { useAi, useDb } from '../../app/context'
import type { AiPromptRec, AppSettingsRec } from '../../lib/db/types'
import { getAiKey, getSettings, setAiKey, updateSettings } from '../../lib/settings'
import { DEFAULT_PROMPTS, getPrompt, listPromptVersions, resetPrompt, savePrompt, type PromptKind } from '../../lib/ai/prompts'
import { buildNugaPrompt } from '../../lib/counseling/nuga'
import { buildBriefingPrompt } from '../../lib/briefing/briefing'
import { extractJson, getClaudeCode } from '../../lib/ai/client'

const SAMPLES: Record<PromptKind, string> = {
  nuga: '점심시간 교실 / 친구랑 말다툼하고 혼자 밥 먹음. 이유 물으니 말 오해해서 서운했다고 함. 대화로 풀어보라고 함.',
  briefing: '[교무부] 11/7(금) 3교시 후 강당에서 학교폭력 예방교육. 학생들 실내화 착용.\n[담임 필독] 내일까지 현장체험학습 동의서 회수 바랍니다.\n[행정실] 교직원 회의 16시.',
}
const KIND_LABEL: Record<PromptKind, string> = { nuga: '누가기록 정리', briefing: '조례·종례 전달사항 정리' }

export default function AiSettings() {
  const db = useDb()
  const [s, setS] = useState<AppSettingsRec>()
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [maxChars, setMaxChars] = useState('')
  const [notice, setNotice] = useState<string>()
  const [cc, setCc] = useState<string>()
  const bridge = getClaudeCode()

  const load = useCallback(async () => {
    const cur = await getSettings(db)
    setS(cur)
    setMaxChars(cur.nuga_max_chars ? String(cur.nuga_max_chars) : '')
    setHasKey(!!(await getAiKey(db)))
  }, [db])
  useEffect(() => {
    load()
  }, [load])
  if (!s) return null

  const patch = async (p: Partial<AppSettingsRec>) => setS(await updateSettings(db, p))
  const provider = s.ai_provider ?? (bridge ? 'claude-code' : 'api-key')

  return (
    <div className="card stack wide" aria-label="AI 설정">
      <h3>AI</h3>
      <p className="muted">
        AI는 버튼을 누를 때만 쓰며, 학생 이름과 전화번호·학번은 가려서 보냅니다. 다른 반 학생 이름은 명단에 없어 가려지지 않으니 메모에 쓸 때 주의하세요. Claude 콘솔에서 월 지출 한도를 꼭 걸어 두세요.
      </p>
      <label className="inline">
        <input type="checkbox" checked={s.ai_enabled} onChange={(e) => patch({ ai_enabled: e.target.checked })} />
        AI 정리 사용
      </label>
      <label className="inline">
        <input type="checkbox" checked={s.mask_names} onChange={(e) => patch({ mask_names: e.target.checked })} />
        학생 이름 가리기(권장)
      </label>
      <div className="row choice" role="radiogroup" aria-label="AI 연결 방식">
        <span className="muted">연결</span>
        <button type="button" role="radio" aria-checked={provider === 'claude-code'} className={provider === 'claude-code' ? 'on' : undefined} onClick={() => patch({ ai_provider: 'claude-code' })}>
          Claude Code(Pro 구독)
        </button>
        <button type="button" role="radio" aria-checked={provider === 'api-key'} className={provider === 'api-key' ? 'on' : undefined} onClick={() => patch({ ai_provider: 'api-key' })}>
          API 키
        </button>
      </div>
      {provider === 'claude-code' ? (
        <div className="stack">
          <p className="muted">
            노트북에 설치·로그인된 Claude Code로 정리합니다. 키가 필요 없고 Pro 요금제 사용 한도 안에서 쓰입니다(추가 요금 없음). exe 버전에서만 됩니다.
          </p>
          <div className="row">
            <button
              type="button"
              disabled={!bridge}
              onClick={async () => {
                setCc('확인 중…')
                const st = await bridge!.status()
                setCc(st.installed ? `Claude Code ${st.version ?? ''} 연결됨` : 'Claude Code를 찾지 못했습니다. 설치 후 명령 창에서 claude 를 한 번 실행해 로그인하세요.')
              }}
            >
              Claude Code 연결 확인
            </button>
            {!bridge && <span className="warn">지금은 브라우저(HTML) 버전이라 쓸 수 없습니다. API 키를 고르세요.</span>}
            {cc && <span role="status">{cc}</span>}
          </div>
        </div>
      ) : (
        <div className="row">
          <label>
            {`AI 키 ${hasKey ? '(저장됨, 이 노트북에만 보관)' : '(없음)'}`}
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
          </label>
          <button
            type="button"
            onClick={async () => {
              await setAiKey(db, key)
              setKey('')
              setHasKey(!!key.trim())
              setNotice(key.trim() ? 'AI 키를 저장했습니다.' : 'AI 키를 지웠습니다.')
            }}
          >
            키 저장
          </button>
          <span className="muted">키 사용료는 Pro 요금과 따로 콘솔 충전금에서 나갑니다.</span>
        </div>
      )}
      <label className="inline">
        누가기록 최대 글자 수(비우면 제한 없음)
        <input
          type="number"
          min={50}
          max={2000}
          value={maxChars}
          onChange={(e) => setMaxChars(e.target.value)}
          onBlur={() => {
            const n = Math.round(Number(maxChars))
            patch({ nuga_max_chars: maxChars.trim() && n > 0 ? n : null })
          }}
        />
      </label>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <PromptEditor kind="nuga" />
      <PromptEditor kind="briefing" />
      <details>
        <summary>누가기록 쓰기 도움말</summary>
        <ul>
          <li>키워드만이라도 그날 메모해 두세요.</li>
          <li>조용한 학생이 빠지지 않게 학생마다 한 달에 1~2건 이상 고르게 기록하세요.</li>
          <li>학기 말 행동특성 및 종합의견을 쓸 때 근거로 훑어보세요.</li>
          <li>강점과 긍정적인 변화도 보이면 기록하세요.</li>
        </ul>
      </details>
    </div>
  )
}

function PromptEditor({ kind }: { kind: PromptKind }) {
  const db = useDb()
  const ai = useAi()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [versions, setVersions] = useState<AiPromptRec[]>([])
  const [sample, setSample] = useState(SAMPLES[kind])
  const [result, setResult] = useState<string>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const t = await getPrompt(db, kind)
    setText(t)
    setSaved(t)
    setVersions(await listPromptVersions(db, kind))
  }, [db, kind])
  useEffect(() => {
    load()
  }, [load])

  async function tryIt() {
    setBusy(true)
    setResult(undefined)
    try {
      const settings = await getSettings(db)
      if (!settings.ai_enabled) throw new Error('먼저 "AI 정리 사용"을 켜세요.')
      if (kind === 'nuga') {
        const [place, ...rest] = sample.split('/')
        const req = buildNugaPrompt(text, [{ id: 'sample', date: '2026-11-05', place: rest.length ? place.trim() : '', memo: (rest.length ? rest.join('/') : place).trim() }], settings.nuga_max_chars)
        const reply = extractJson<{ items?: { text: string }[] }>(await ai(req))
        setResult(reply.items?.[0]?.text ?? '(결과 없음)')
      } else {
        const req = buildBriefingPrompt(text, sample, '2026-11-05')
        const reply = extractJson<{ 조례?: string[]; 종례?: string[] }>(await ai(req))
        setResult(`조례\n${(reply.조례 ?? []).map((x) => `- ${x}`).join('\n')}\n\n종례\n${(reply.종례 ?? []).map((x) => `- ${x}`).join('\n')}`)
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <details className="stack wide">
      <summary>{`${KIND_LABEL[kind]} 지시문`}</summary>
      <p className="muted">작성 규칙과 예시만 고치세요. 결과 형식은 앱이 따로 정하므로 화면이 깨지지 않습니다. 지시문에 실제 학생 이름은 쓰지 마세요. {'{최대글자수}'}, {'{날짜}'}를 쓸 수 있습니다.</p>
      <textarea aria-label={`${KIND_LABEL[kind]} 지시문`} rows={14} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={text === saved}
          onClick={async () => {
            await savePrompt(db, kind, text)
            await load()
          }}
        >
          지시문 저장
        </button>
        <button
          type="button"
          disabled={saved === DEFAULT_PROMPTS[kind]}
          onClick={async () => {
            await resetPrompt(db, kind)
            await load()
          }}
        >
          기본값으로 되돌리기
        </button>
        {versions.filter((v) => !v.active).length > 0 && (
          <label className="inline">
            이전 버전
            <select
              value=""
              onChange={async (e) => {
                const v = versions.find((x) => x.id === e.target.value)
                if (v) {
                  await savePrompt(db, kind, v.instruction)
                  await load()
                }
              }}
            >
              <option value="">복원할 버전 고르기</option>
              {versions
                .filter((v) => !v.active)
                .map((v) => (
                  <option key={v.id} value={v.id}>{`${v.version}번째 (${v.updated_at.slice(0, 10)})`}</option>
                ))}
            </select>
          </label>
        )}
      </div>
      <label className="wide">
        샘플 입력
        <textarea rows={3} value={sample} onChange={(e) => setSample(e.target.value)} />
      </label>
      <button type="button" disabled={busy} onClick={tryIt}>
        {busy ? '시험 중…' : '샘플로 시험(AI 호출)'}
      </button>
      {result && <pre className="pre card wide">{result}</pre>}
    </details>
  )
}
