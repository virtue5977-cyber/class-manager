import { createDb, type AppDB } from '../db/schema'
import { openVaultDb } from './vaultDb'

/**
 * 성능 시험(scripts/vault-bench.mjs) 전용 시험 열쇠 주입.
 * 개발 서버(DEV)나 `vite build --mode bench`에서만 동작하고, 주소에 `?vaultTest=1`이 있을 때
 * 고정 시험 열쇠(testing.ts의 TEST_KEY와 같은 값)로 암호화 DB를 열어 window.__watsonVaultTest에 둔다.
 * `?vaultTest=plain`은 비교용 평문 DB('bench-plain')를 연다.
 * 배포 빌드(mode production)에서는 조건이 상수 false가 되어 본문이 빠진다(빌드 뒤 dist에서 'vaultTest'가 없어야 한다).
 */
export function vaultTestDb(): AppDB | null {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'bench')) return null
  const q = new URLSearchParams(window.location.search)
  const mode = q.get('vaultTest')
  if (mode !== '1' && mode !== 'plain') return null
  const key = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff)
  // plain: 같은 자료를 평문 DB로(암호화 비용 비교용)
  const open = () => (mode === 'plain' ? createDb('bench-plain') : openVaultDb(q.get('db') || 'watson-bench', key))
  const db = open()
  performance.mark('vault-test-db')
  // reopen: 같은 DB를 새 연결로(조회 시간을 데우지 않은 상태로 재려고)
  ;(window as unknown as { __watsonVaultTest?: { db: AppDB; reopen: () => AppDB } }).__watsonVaultTest = { db, reopen: open }
  return db
}
