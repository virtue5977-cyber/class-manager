import type { AppDB } from '../db/schema'
import { GoogleApiError, googleErrorText } from './google'

const KEY = 'googleSyncError'
const HIDE_KEY = 'googleSyncErrorHidden'

/** 자동·수동 구글 맞춤의 마지막 실패(때 + 한국어 문구, 개인정보 없음). device_local에만 둔다. */
export interface GoogleSyncError {
  at: string
  message: string
  /** 401: 설정에서 '다시 연결' */
  reconnect: boolean
}

/** 오류 → 화면 문구. 구글 오류는 정해진 한국어 문구, 그 밖은 일반 문구(원문엔 이름·주소가 섞일 수 있어 저장하지 않는다). */
export function describeGoogleError(e: unknown): { message: string; reconnect: boolean; known: boolean } {
  if (e instanceof GoogleApiError) return { message: googleErrorText(e.status, e.reason), reconnect: e.status === 401, known: true }
  const m = e instanceof Error ? e.message : ''
  // 메인 invoke는 오류의 message만 넘긴다: 이유 낱말이 글에 들어 있으면 같은 문구로
  const hit = /admin_policy_enforced|access_not_configured|accessNotConfigured/.exec(m)
  if (hit) return { message: googleErrorText(403, hit[0]), reconnect: false, known: true }
  return { message: '구글 동기화에 실패했습니다. 잠시 뒤 다시 하세요.', reconnect: false, known: false }
}

export async function recordGoogleError(db: AppDB, e: unknown, now = new Date()): Promise<void> {
  const { message, reconnect } = describeGoogleError(e)
  const value: GoogleSyncError = { at: now.toISOString(), message, reconnect }
  await db.device_local.put({ id: KEY, value })
}
export async function clearGoogleError(db: AppDB): Promise<void> {
  await db.device_local.delete(KEY)
}
export async function readGoogleError(db: AppDB): Promise<GoogleSyncError | null> {
  const v = (await db.device_local.get(KEY))?.value as GoogleSyncError | undefined
  return v && typeof v.at === 'string' && typeof v.message === 'string' ? v : null
}
/** 띠에서 '닫기'를 누른 오류의 때 */
export async function hideGoogleError(db: AppDB, at: string): Promise<void> {
  await db.device_local.put({ id: HIDE_KEY, value: at })
}
export async function hiddenGoogleErrorAt(db: AppDB): Promise<string | null> {
  return ((await db.device_local.get(HIDE_KEY))?.value as string | undefined) ?? null
}
