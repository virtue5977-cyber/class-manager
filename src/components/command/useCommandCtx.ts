import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAi, useDb, useFs } from '../../app/context'
import { useClasses } from '../../pages/common/useClasses'
import { listStudents } from '../../lib/roster/roster'
import { listNotes } from '../../lib/notes/notes'
import { useLive } from '../../lib/ui/useLive'
import { dispatchShortcut } from '../../lib/ui/shortcuts'
import { toYmd } from '../../lib/schoolDays'
import type { ParseCtx } from '../../lib/command/parse'
import type { RunEnv } from '../../lib/command/run'
import type { NoteRec, StudentRec } from '../../lib/db/types'

/** 명령 실행에 필요한 것: 지금 학급 학생·노트(실시간), 실행 환경. */
export function useCommandCtx(today = toYmd(new Date())): { ctx: ParseCtx; env: RunEnv | null } {
  const db = useDb()
  const fs = useFs()
  const ai = useAi()
  const navigate = useNavigate()
  const { classId } = useClasses()
  const students = useLive<StudentRec[]>(() => (classId ? listStudents(db, classId, { includeInactive: false }) : Promise.resolve([])), [db, classId], [])
  const notes = useLive<NoteRec[]>(() => listNotes(db), [db], [])
  const ctx = useMemo(() => ({ students, notes, today }), [students, notes, today])
  const env = useMemo<RunEnv | null>(
    () =>
      classId
        ? {
            db,
            today,
            classId,
            ai,
            navigate: (to: string) => navigate(to),
            download: (name: string, bytes: Uint8Array) => fs.downloadFile(name, bytes),
            openExport: () => setTimeout(() => dispatchShortcut({ kind: 'export' }), 400),
          }
        : null,
    [db, fs, ai, navigate, classId, today],
  )
  return { ctx, env }
}
