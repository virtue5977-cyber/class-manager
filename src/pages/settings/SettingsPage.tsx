import { useSearchParams } from 'react-router-dom'
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
  { id: 'backup', label: '백업·잠금' },
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
  const tab = (SETTINGS_TABS.find((t) => t.id === params.get('tab'))?.id ?? 'backup') as SettingsTab
  return (
    <section className="stack">
      <h2>설정</h2>
      <div className="tabs settings-tabs" role="tablist" aria-label="설정 메뉴">
        {SETTINGS_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : undefined} onClick={() => setParams({ tab: t.id }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="stack gap settings-body" role="tabpanel">
        {tab === 'backup' && (
          <>
            <BackupSettings iterations={backupIterations} />
            <PinSettings />
          </>
        )}
        {tab === 'school' && <SchoolSettings />}
        {tab === 'timetable' && <MyTimetable />}
        {tab === 'reports' && <ReportSettings />}
        {tab === 'ai' && <AiSettings />}
        {tab === 'google' && <GoogleSettings />}
        {tab === 'screen' && <AppearanceSettings />}
        {tab === 'update' && <UpdateSettings />}
      </div>
    </section>
  )
}
