import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AppDB } from '../lib/db/schema'
import type { FsAdapter } from '../lib/fs/adapter'
import type { FetchLike } from '../lib/neis/client'
import { createAiCaller, createRoutedAiCaller, type AiCaller } from '../lib/ai/client'
import { getAiKey, getGeminiKey, getSettings } from '../lib/settings'
import { createGeminiCaller } from '../lib/ai/gemini'

const DbContext = createContext<AppDB | null>(null)
const FsContext = createContext<FsAdapter | null>(null)
/** 네트워크(NEIS 등). 테스트에서 가짜 응답을 넣는다. */
const NetContext = createContext<FetchLike>((url) => globalThis.fetch(url))

/** NEIS 자료(급식·시간표·학사일정)를 새로 가져왔음을 알린다. */
/** AI 호출. 테스트에서 가짜 응답을 넣는다. 없으면 기기에 저장된 키로 호출. */
const AiContext = createContext<AiCaller | null>(null)

const NeisEventsContext = createContext<{ version: number; notifyChanged: () => void }>({ version: 0, notifyChanged: () => {} })
/** 백업 설정이 바뀌었음을 배너 등에 알린다. */
const BackupEventsContext = createContext<{ version: number; notifyChanged: () => void }>({ version: 0, notifyChanged: () => {} })

export function AppProviders({ db, fs, fetch, ai, children }: { db: AppDB; fs: FsAdapter; fetch?: FetchLike; ai?: AiCaller; children: ReactNode }) {
  const aiCaller = useMemo(() => ai ?? createRoutedAiCaller(async () => (await getSettings(db)).ai_provider, createAiCaller(() => getAiKey(db)), undefined, undefined, createGeminiCaller(() => getGeminiKey(db), async () => (await getSettings(db)).gemini_model)), [ai, db])
  const [version, setVersion] = useState(0)
  const notifyChanged = useCallback(() => setVersion((v) => v + 1), [])
  const events = useMemo(() => ({ version, notifyChanged }), [version, notifyChanged])
  const [neisVersion, setNeisVersion] = useState(0)
  const notifyNeis = useCallback(() => setNeisVersion((v) => v + 1), [])
  const neisEvents = useMemo(() => ({ version: neisVersion, notifyChanged: notifyNeis }), [neisVersion, notifyNeis])
  return (
    <DbContext.Provider value={db}>
      <FsContext.Provider value={fs}>
        <BackupEventsContext.Provider value={events}>
          <NeisEventsContext.Provider value={neisEvents}>
            <AiContext.Provider value={aiCaller}>{fetch ? <NetContext.Provider value={fetch}>{children}</NetContext.Provider> : children}</AiContext.Provider>
          </NeisEventsContext.Provider>
        </BackupEventsContext.Provider>
      </FsContext.Provider>
    </DbContext.Provider>
  )
}

export function useDb(): AppDB {
  const db = useContext(DbContext)
  if (!db) throw new Error('DbContext가 없습니다.')
  return db
}

export function useFs(): FsAdapter {
  const fs = useContext(FsContext)
  if (!fs) throw new Error('FsContext가 없습니다.')
  return fs
}

export function useBackupEvents() {
  return useContext(BackupEventsContext)
}

export function useNetFetch(): FetchLike {
  return useContext(NetContext)
}

export function useNeisEvents() {
  return useContext(NeisEventsContext)
}

export function useAi(): AiCaller {
  const ai = useContext(AiContext)
  if (!ai) throw new Error('AiContext가 없습니다.')
  return ai
}
