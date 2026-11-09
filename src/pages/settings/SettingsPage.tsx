import BackupSettings from './BackupSettings'
import SchoolSettings from './SchoolSettings'
import MyTimetable from './MyTimetable'
import ReportSettings from './ReportSettings'
import AiSettings from './AiSettings'
import PinSettings from './PinSettings'
import UpdateSettings from './UpdateSettings'
import GoogleSettings from './GoogleSettings'

export default function SettingsPage({ backupIterations }: { backupIterations?: number }) {
  return (
    <section>
      <h2>설정</h2>
      <div className="stack gap">
        <SchoolSettings />
        <MyTimetable />
        <ReportSettings />
        <AiSettings />
        <GoogleSettings />
        <UpdateSettings />
        <BackupSettings iterations={backupIterations} />
        <PinSettings />
      </div>
    </section>
  )
}
