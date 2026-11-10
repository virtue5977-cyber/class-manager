import LayoutSettings from './LayoutSettings'
import SttSettings from './SttSettings'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDb } from '../../app/context'
import { getNeisKey, getSettings, isDesktopApp } from '../../lib/settings'
import BackupSettings from './BackupSettings'
import SchoolSettings from './SchoolSettings'
import MyTimetable from './MyTimetable'
import ReportSettings from './ReportSettings'
import AiSettings from './AiSettings'
import PinSettings from './PinSettings'
import UpdateSettings from './UpdateSettings'
import GoogleSettings from './GoogleSettings'
import AppearanceSettings from './AppearanceSettings'

export const SETTINGS_TABS = [
  { id: 'backup', label: '잠금·백업' },
  { id: 'school', label: '학교·나이스' },
  { id: 'timetable', label: '내 시간표' },
  { id: 'reports', label: '결석신고서' },
  { id: 'ai', label: 'AI' },
  { id: 'google', label: '구글 캘린더' },
  { id: 'screen', label: '화면' },
  { id: 'update', label: '업데이트' },
] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

/** 설정은 탭으로 나눈다. 주소의 ?tab= 으로 다른 화면에서 바로 열 수 있다. */
export default function SettingsPage({ backupIterations }: { backupIterations?: number }) {
  const [params, setParams] = useSearchParams()
  const db = useDb()
  // 할 일이 남은 탭에 점을 붙인다(처음 쓰는 사람이 무엇부터 할지 보이게).
  const [todo, setTodo] = useState<Partial<Record<SettingsTab, boolean>>>({})
  useEffect(() => {
    ;(async () => {
      const s = await getSettings(db)
      setTodo({ backup: !(await db.device_local.get('backupKey')), school: !((await getNeisKey(db)) && s.neis_school_code) })
    })()
  }, [db, params])
  const tab = (SETTINGS_TABS.find((t) => t.id === params.get('tab'))?.id ?? 'backup') as SettingsTab
  return (
    <section className="stack">
      <h2>설정</h2>
      <div className="tabs settings-tabs" role="tablist" aria-label="설정 메뉴">
        {SETTINGS_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-label={todo[t.id] ? `${t.label} · 할 일 있음` : undefined} className={tab === t.id ? 'active' : undefined} onClick={() => setParams({ tab: t.id }, { replace: true })}>
            {t.label}
            {todo[t.id] && <span className="todo-dot" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="stack gap settings-body" role="tabpanel">
        {tab === 'backup' && (
          <>
            {!isDesktopApp() && (
              <p className="banner" role="note">
                브라우저(HTML) 버전입니다. 이 방식은 같은 노트북에서 연 다른 HTML 파일이 앱 자료를 읽을 수 있어 학생 자료 보호가 약합니다. 학생 자료는 설치형(Windows 앱)에서 쓰고, HTML 버전은 잠깐 볼 때만 쓰세요.
              </p>
            )}
            <PinSettings />
            <BackupSettings iterations={backupIterations} />
          </>
        )}
        {tab === 'school' && <SchoolSettings />}
        {tab === 'timetable' && <MyTimetable />}
        {tab === 'reports' && <ReportSettings />}
        {tab === 'ai' && (
          <>
            <AiSettings />
            <SttSettings />
          </>
        )}
        {tab === 'google' && <GoogleSettings />}
        {tab === 'screen' && (
          <>
            <AppearanceSettings />
            <LayoutSettings />
          </>
        )}
        {tab === 'update' && <UpdateSettings />}
      </div>
    </section>
  )
}
