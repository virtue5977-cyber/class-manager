import type { AppDB } from './db/schema'
import { getSettings, updateSettings } from './settings'

/** PIN은 화면 접근을 막는 용도. 해시·솔트는 기기 전용 표(device_local)에 둔다. */
const ITER = 100_000
const enc = new TextEncoder()
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function hash(pin: string, salt: Uint8Array, iterations = ITER): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return b64(new Uint8Array(bits))
}

export function validatePin(pin: string): string | null {
  return /^\d{4,8}$/.test(pin) ? null : 'PIN은 숫자 4~8자리로 정하세요.'
}

export async function setPin(db: AppDB, pin: string, iterations = ITER): Promise<void> {
  const err = validatePin(pin)
  if (err) throw new Error(err)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  await db.device_local.put({ id: 'pin', value: { hash: await hash(pin, salt, iterations), salt: b64(salt), iterations } })
  await updateSettings(db, { pin_enabled: true })
}

export async function verifyPin(db: AppDB, pin: string): Promise<boolean> {
  const rec = (await db.device_local.get('pin'))?.value as { hash: string; salt: string; iterations: number } | undefined
  if (!rec) return true
  return (await hash(pin, unb64(rec.salt), rec.iterations)) === rec.hash
}

export async function clearPin(db: AppDB): Promise<void> {
  await db.device_local.delete('pin')
  await db.device_local.delete('pinFails')
  await updateSettings(db, { pin_enabled: false })
}

/** 켜져 있고 PIN이 저장돼 있어야 잠근다(백업을 다른 기기에 복원했으면 PIN이 없으니 잠그지 않음). */
export async function pinActive(db: AppDB): Promise<boolean> {
  return (await getSettings(db)).pin_enabled && !!(await db.device_local.get('pin'))
}

/** 틀린 횟수에 따른 대기 시간(ms): 5번부터 30초씩 늘어난다. */
export const lockoutMs = (fails: number) => (fails < 5 ? 0 : (fails - 4) * 30_000)

/** 틀린 횟수·대기 끝 시각은 기기에 저장한다(새로고침으로 초기화되지 않게). */
export async function getPinFails(db: AppDB): Promise<{ fails: number; until: number }> {
  const v = (await db.device_local.get('pinFails'))?.value as { fails: number; until: number } | undefined
  return v ?? { fails: 0, until: 0 }
}
export async function setPinFails(db: AppDB, v: { fails: number; until: number }): Promise<void> {
  await db.device_local.put({ id: 'pinFails', value: v })
}
