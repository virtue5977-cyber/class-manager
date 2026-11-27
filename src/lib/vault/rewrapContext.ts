import { createContext } from 'react'
import type { DerivedPassKey } from '../backup/service'
import type { PublicVault, VaultStatus } from '../desktop/bridge'
import type { VaultPayload } from './keys'

/**
 * 암호구를 바꿀 때 열쇠 파일의 pass 감싸기를 교체하는 함수. 없으면 null.
 * 동기화가 켜져 있으면 드라이브 열쇠 파일(watson-key.json)을 먼저 바꾼다(S6 rewrapKeyFile). 실패하면 던지고 아무것도 바꾸지 않는다.
 */
export const VaultRewrapContext = createContext<((k: DerivedPassKey) => Promise<void>) | null>(null)

/**
 * 열린 열쇠(VaultGate 'open'): 동기화 켜기·열쇠 맞추기(S6 enable.ts)가 쓰는 길. exe가 아니면 null.
 * - current/store/status는 enable.ts의 VaultAccess 모양이다. store는 같은 keyId면 메모리의 공개 열쇠도 바꾼다.
 * - reopen(): VaultGate가 열쇠 상태를 다시 읽고 vault.json이 가리키는 DB를 연다(다시 암호화 뒤, 저장 결과가 불확실할 때).
 */
export interface VaultSession {
  dek: Uint8Array
  keyId: string
  dbName: string
  current(): PublicVault
  store(p: VaultPayload): Promise<unknown>
  status(): Promise<VaultStatus>
  reopen(): void
}
export const VaultSessionContext = createContext<VaultSession | null>(null)
