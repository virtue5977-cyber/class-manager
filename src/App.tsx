import { useMemo } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { AppProviders } from './app/context'
import Nav from './components/Nav'
import BackupBanner from './components/BackupBanner'
import PinGate from './components/PinGate'
import HideNames from './components/HideNames'
import UpdateBanner from './components/UpdateBanner'
import SettingsPage from './pages/settings/SettingsPage'
import ClassPage from './pages/class/ClassPage'
import AttendancePage from './pages/attendance/AttendancePage'
import ReportsPage from './pages/reports/ReportsPage'
import StatsPage from './pages/stats/StatsPage'
import CounselingPage from './pages/counseling/CounselingPage'
import HomePage from './pages/home/HomePage'
import CalendarPage from './pages/calendar/CalendarPage'
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
        <div className="layout">
          <aside className="sidebar">
            <h1>담임 업무</h1>
            <Nav />
            <HideNames />
          </aside>
          <main className="content">
            <UpdateBanner />
            <BackupBanner />
            <Routes>
              <Route path="/class" element={<ClassPage />} />
              <Route path="/attendance" element={<AttendancePage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/counseling" element={<CounselingPage />} />
              <Route path="/" element={<HomePage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/settings" element={<SettingsPage backupIterations={props.backupIterations} />} />
            </Routes>
          </main>
        </div>
      </HashRouter>
      </PinGate>
    </AppProviders>
  )
}
