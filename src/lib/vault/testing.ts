import type { AppDB } from '../db/schema'
import { openVaultDb } from './vaultDb'

/** 시험 전용 고정 열쇠(32바이트). 실제 자료에 쓰지 않는다. */
export const TEST_KEY: Uint8Array = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff)

/** 시험용 암호화 DB(고정 시험 열쇠). 이름을 주지 않으면 겹치지 않는 이름을 만든다. */
export function openTestVaultDb(name = 'watson-test-' + crypto.randomUUID()): AppDB {
  return openVaultDb(name, TEST_KEY)
}
