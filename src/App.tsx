import { useMemo } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AppProviders } from './app/context'
import Sidebar from './components/Sidebar'
import Shortcuts from './components/Shortcuts'
import BackupBanner from './components/BackupBanner'
import PinGate from './components/PinGate'
import UpdateBanner from './components/UpdateBanner'
import GoogleAutoSync from './components/GoogleAutoSync'
import SettingsPage from './pages/settings/SettingsPage'
import ClassPage, { CLASS_SUBS, type ClassSub } from './pages/class/ClassPage'
import AttendancePage from './pages/attendance/AttendancePage'
import ReportsPage from './pages/reports/ReportsPage'
import StatsPage from './pages/stats/StatsPage'
import CounselingPage from './pages/counseling/CounselingPage'
import HomePage from './pages/home/HomePage'
import CalendarPage from './pages/calendar/CalendarPage'
import { GlobalClassContext } from './pages/common/useClasses'
import { createDb, type AppDB } from './lib/db/schema'
import { createWebFsAdapter } from './lib/fs/web'
import { createDesktopFsAdapter, type DesktopBackupApi } from './lib/fs/desktop'
import type { FsAdapter } from './lib/fs/adapter'

/** backupIterations는 테스트에서 키 유도를 빠르게 하기 위한 값이다. */
export default function App(props: { db?: AppDB; fs?: FsAdapter; backupIterations?: number }) {
  const db = useMemo(() => props.db ?? createDb(), [props.db])
  const fs = useMemo(() => {
    if (props.fs) return props.fs
    const desktop = (window as { desktop?: { backup?: DesktopBackupApi } }).desktop?.backup
    return desktop ? createDesktopFsAdapter(db, desktop) : createWebFsAdapter(db)
  }, [props.fs, db])
  return (
    <AppProviders db={db} fs={fs}>
      <PinGate>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GlobalClassContext.Provider value={true}>
        <div className="layout">
          <Shortcuts />
          <Sidebar />
          <main className="content">
            <UpdateBanner />
            <GoogleAutoSync />
            <BackupBanner />
            <AppRoutes backupIterations={props.backupIterations} />
          </main>
        </div>
        </GlobalClassContext.Provider>
      </HashRouter>
      </PinGate>
    </AppProviders>
  )
}

/** 옛 주소를 새 주소로 넘긴다(쿼리 유지). */
function Moved({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={to + search} replace />
}

function ClassRoute() {
  const { sub } = useParams()
  return CLASS_SUBS.some((x) => x.sub === sub) ? <ClassPage sub={sub as ClassSub} /> : <Navigate to="/class/roster" replace />
}

export function AppRoutes(props: { backupIterations?: number }) {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/attendance" element={<AttendancePage />} />
      <Route path="/attendance/reports" element={<ReportsPage />} />
      <Route path="/attendance/stats" element={<StatsPage />} />
      <Route path="/counseling" element={<CounselingPage />} />
      <Route path="/class" element={<Moved to="/class/roster" />} />
      <Route path="/class/:sub" element={<ClassRoute />} />
      <Route path="/settings" element={<SettingsPage backupIterations={props.backupIterations} />} />
      <Route path="/reports" element={<Moved to="/attendance/reports" />} />
      <Route path="/stats" element={<Moved to="/attendance/stats" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
