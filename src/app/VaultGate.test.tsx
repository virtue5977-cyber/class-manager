import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useContext, useEffect, useState } from 'react'
import VaultGate from './VaultGate'
import { AppDB, createDb } from '../lib/db/schema'
import { newRecord } from '../lib/db/records'
import { openVaultDb } from '../lib/vault/vaultDb'
import Dexie from 'dexie'
import { VaultRewrapContext } from '../lib/vault/rewrapContext'
import {
  buildVaultPayload, makeMetaCheck, newDek, newRecoveryCode, passKeyRaw, recoveryKeyRaw, unwrapDek, type VaultPayload,
} from '../lib/vault/keys'
import { fromBase64 } from '../lib/backup/crypto'
import { runBackup, setupPassphrase } from '../lib/backup/service'
import { createMemoryFolder } from '../lib/fs/memory'
import type { DesktopVaultApi, PublicVault, VaultStatus } from '../lib/desktop/bridge'

const PASS = '시험용암호구2026'
const ITER = 1000

/** 가상 열쇠: 낮은 반복 수(시험 속도), 가상 DB는 완료 표시까지. */
type MetaKind = 'ok' | 'none' | 'wrong-keyid' | 'bad-check' | 'no-db'
async function makeVault(opts: { complete?: boolean; meta?: MetaKind } = {}) {
  const { dek, keyId } = newDek()
  const passSalt = crypto.getRandomValues(new Uint8Array(16))
  const recSalt = crypto.getRandomValues(new Uint8Array(16))
  const code = newRecoveryCode()
  const payload = buildVaultPayload({
    keyId, dek,
    passRaw: await passKeyRaw(PASS, passSalt, ITER), passSalt, passIter: ITER,
    recoveryRaw: await recoveryKeyRaw(code, recSalt, ITER), recoverySalt: recSalt, recoveryIter: ITER,
  })
  const meta: MetaKind = opts.meta ?? (opts.complete === false ? 'none' : 'ok')
  if (meta !== 'no-db') {
    const db = openVaultDb(payload.dbName, dek)
    await db.open()
    const check = makeMetaCheck(dek, keyId)
    if (meta === 'ok') await db.meta.put({ id: 'vault', complete: true, keyId, check })
    if (meta === 'wrong-keyid') await db.meta.put({ id: 'vault', complete: true, keyId: newDek().keyId, check })
    if (meta === 'bad-check') await db.meta.put({ id: 'vault', complete: true, keyId, check: makeMetaCheck(newDek().dek, keyId) })
    db.close()
  }
  const { dekB64: _d, ...pub } = payload
  return { dek, code, payload, vault: pub as PublicVault }
}

function fakeDesktop(status: () => Promise<VaultStatus>, extra: Partial<DesktopVaultApi> = {}) {
  const vault = {
    unlockDpapi: vi.fn(async () => null),
    readBackup: vi.fn(async () => null),
    ...extra,
    status: vi.fn(status),
    store: vi.fn(extra.store ?? (async (_p: VaultPayload) => true)),
  }
  const alive = vi.fn()
  ;(window as { desktop?: unknown }).desktop = { isDesktop: true, shell: 7, vault, bundle: { alive } }
  return { vault, alive }
}

afterEach(() => { delete (window as { desktop?: unknown }).desktop })

/** 자식: 받은 DB 이름을 보이고, 가상 학생 하나를 넣는다. */
function Probe({ db, onDb }: { db: AppDB; onDb?: (db: AppDB) => void }) {
  const [n, setN] = useState<number>()
  useEffect(() => {
    onDb?.(db)
    db.students.count().then(setN)
  }, [db, onDb])
  return <p>열린 DB {db.name} {n === undefined ? '' : `학생 ${n}`}</p>
}

const kid = () => newRecord({
  class_id: 'c1', number: 1, name: '가상학생', address: '', birth_date: '', prev_school: '',
  phone: '010-0000-0000', hobby: '', talent: '', commute: '',
} as never)

test('웹(desktop 없음) → 평문 createDb(class-manager)', async () => {
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText(/열린 DB class-manager/)).toBeInTheDocument()
})

test('ok → 자식이 vault DB로 그려지고, 넣은 행은 원시 저장에서 암호화돼 있다', async () => {
  const v = await makeVault()
  const { alive } = fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
  let got: AppDB | undefined
  render(<VaultGate>{(db) => <Probe db={db} onDb={(d) => { got = d }} />}</VaultGate>)
  expect(await screen.findByText(new RegExp(`열린 DB ${v.payload.dbName}`))).toBeInTheDocument()
  // alive는 App 뿌리로 옮겼다(Task 15) — VaultGate는 부르지 않는다
  expect(alive).not.toHaveBeenCalled()
  expect(got!.isVault).toBe(true)
  await got!.students.add(kid())
  const raw = new AppDB(v.payload.dbName, { vault: true })
  const rows = await raw.table('students').toArray()
  raw.close()
  expect(rows).toHaveLength(1)
  expect(JSON.stringify(rows)).not.toContain('가상학생')
  expect(JSON.stringify(rows)).not.toContain('010-0000-0000')
})

test('needs-pass → 맞는 암호구면 열리고 store를 한 번(같은 pass·recovery + dekB64) 부른다', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  const { vault } = fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByRole('heading', { name: '자료 열기' })).toBeInTheDocument()
  expect(screen.getByText(/켤 때마다 암호구를 묻습니다/)).toBeInTheDocument()
  await user.type(screen.getByLabelText('백업 암호구'), PASS)
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText(new RegExp(`열린 DB ${v.payload.dbName}`))).toBeInTheDocument()
  expect(vault.store).toHaveBeenCalledTimes(1)
  const p = vault.store.mock.calls[0][0]
  expect(p).toEqual({ ...v.vault, dekB64: v.payload.dekB64 })
})

test('needs-pass → 틀리면 "암호구가 맞지 않습니다", 5번째 뒤 복원 안내(다시 시도도 된다)', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  const { vault } = fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  const input = await screen.findByLabelText('백업 암호구')
  for (let i = 1; i <= 5; i++) {
    if (i === 5) expect(screen.queryByRole('button', { name: '백업 파일에서 복원' })).not.toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '틀린암호구' + i)
    await user.click(screen.getByRole('button', { name: '열기' }))
    expect(await screen.findByText('암호구가 맞지 않습니다')).toBeInTheDocument()
  }
  expect(await screen.findByRole('button', { name: '백업 파일에서 복원' })).toBeInTheDocument()
  expect(screen.getByText(/5번 틀렸습니다/)).toBeInTheDocument()
  // 그래도 다시 시도할 수 있다
  await user.clear(input)
  await user.type(input, PASS)
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText(new RegExp(`열린 DB ${v.payload.dbName}`))).toBeInTheDocument()
  expect(vault.store).toHaveBeenCalledTimes(1)
})

test('복구 코드 탭으로 열린다(소문자·공백도 받는다)', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  const { vault } = fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  await user.click(await screen.findByRole('tab', { name: '복구 코드' }))
  await user.type(screen.getByLabelText('복구 코드'), '틀린코드')
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText(/복구 코드 형식이 맞지 않습니다/)).toBeInTheDocument()
  await user.clear(screen.getByLabelText('복구 코드'))
  await user.type(screen.getByLabelText('복구 코드'), v.code.toLowerCase().replace(/-/g, ' '))
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText(new RegExp(`열린 DB ${v.payload.dbName}`))).toBeInTheDocument()
  expect(vault.store).toHaveBeenCalledTimes(1)
})

test('틀린 복구 코드 → "복구 코드가 맞지 않습니다"', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  await user.click(await screen.findByRole('tab', { name: '복구 코드' }))
  await user.type(screen.getByLabelText('복구 코드'), newRecoveryCode())
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText('복구 코드가 맞지 않습니다')).toBeInTheDocument()
})

test('broken → 설명 + 복원 단추, 백업 파일에서 복원하면 복구 코드를 한 번 보이고 새 DB로 연다', async () => {
  const user = userEvent.setup()
  // 가상 백업 파일
  const src = createDb('src-' + crypto.randomUUID())
  await setupPassphrase(src, PASS, { iterations: ITER })
  await src.students.add(kid())
  const folder = createMemoryFolder()
  const bytes = await folder.readFile(await runBackup(src, folder))
  src.close()

  let stored: VaultPayload | undefined
  const { vault } = fakeDesktop(async () => {
    if (!stored) return { state: 'broken' }
    const { dekB64, ...pub } = stored
    return { state: 'ok', dekB64, vault: pub }
  }, { store: async (p: VaultPayload) => { stored = p; return true } })
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText(/열쇠 파일이 손상되어/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '백업 파일에서 복원' }))
  await user.upload(screen.getByLabelText('백업 파일'), new File([bytes], '백업_20261101_0900.enc'))
  await user.type(screen.getByLabelText('백업 파일 암호구'), PASS)
  await user.click(screen.getByRole('button', { name: '복원' }))
  const codeEl = await screen.findByTestId('recovery-code', {}, { timeout: 10000 })
  expect(codeEl.textContent).toMatch(/^([0-9A-Z]{5}-){4}[0-9A-Z]{5}$/)
  expect(screen.getByRole('button', { name: '인쇄' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '파일로 저장' })).toBeInTheDocument()
  expect(vault.store).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '적어 두었습니다. 열기' }))
  expect(await screen.findByText(new RegExp(`열린 DB ${stored!.dbName} 학생 1`))).toBeInTheDocument()
}, 20000)

test('복원: 틀린 암호구면 아무것도 저장하지 않고 오류를 보인다', async () => {
  const user = userEvent.setup()
  const src = createDb('src-' + crypto.randomUUID())
  await setupPassphrase(src, PASS, { iterations: ITER })
  const folder = createMemoryFolder()
  const bytes = await folder.readFile(await runBackup(src, folder))
  src.close()
  const { vault } = fakeDesktop(async () => ({ state: 'broken' }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  await user.click(await screen.findByRole('button', { name: '백업 파일에서 복원' }))
  await user.upload(screen.getByLabelText('백업 파일'), new File([bytes], 'b.enc'))
  await user.type(screen.getByLabelText('백업 파일 암호구'), '틀린암호구입니다')
  await user.click(screen.getByRole('button', { name: '복원' }))
  expect(await screen.findByText(/암호구가 틀렸거나 백업 파일이 손상되었습니다/)).toBeInTheDocument()
  expect(vault.store).not.toHaveBeenCalled()
})

test('none + 옛 DB 있음 → 옮기기 마법사 자리(reason migrate), done이면 상태를 다시 본다', async () => {
  const old = new AppDB('class-manager')
  await old.open()
  old.close()
  try {
    const { vault } = fakeDesktop(async () => ({ state: 'none' }))
    let done: (() => void) | undefined
    render(
      <VaultGate renderSetup={(p) => { done = p.done; return <p>마법사 {p.reason}</p> }}>
        {(db) => <Probe db={db} />}
      </VaultGate>,
    )
    expect(await screen.findByText('마법사 migrate')).toBeInTheDocument()
    expect(vault.status).toHaveBeenCalledTimes(1)
    act(() => done!())
    await waitFor(() => expect(vault.status).toHaveBeenCalledTimes(2))
  } finally {
    await new Promise((r) => { const q = indexedDB.deleteDatabase('class-manager'); q.onsuccess = q.onerror = r })
  }
})

test('none + 옛 DB 없음 → 첫 설치 마법사 자리(기본은 준비 중 안내)', async () => {
  await new Promise((r) => { const q = indexedDB.deleteDatabase('class-manager'); q.onsuccess = q.onerror = r })
  fakeDesktop(async () => ({ state: 'none' }))
  const { unmount } = render(
    <VaultGate renderSetup={(p) => <p>마법사 {p.reason}</p>}>{(db) => <Probe db={db} />}</VaultGate>,
  )
  expect(await screen.findByText('마법사 first-install')).toBeInTheDocument()
  unmount()
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText(/준비 중입니다/)).toBeInTheDocument()
})

test('ok인데 새 DB에 완료 표시가 없으면 → 마법사 자리(reason incomplete)', async () => {
  const v = await makeVault({ complete: false })
  fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
  render(<VaultGate renderSetup={(p) => <p>마법사 {p.reason}</p>}>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText('마법사 incomplete')).toBeInTheDocument()
})

function Rewrapper() {
  const rewrap = useContext(VaultRewrapContext)
  const [msg, setMsg] = useState('')
  return (
    <button onClick={async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      await rewrap!({ salt, iter: ITER, raw: await passKeyRaw('새암호구입니다2026', salt, ITER) })
      setMsg('바꿈')
    }}>{msg || (rewrap ? '바꾸기' : '없음')}</button>
  )
}

test('VaultRewrapContext: 새 passKey로 pass만 다시 감싸고 recovery는 그대로 store한다', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  const { vault } = fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
  render(<VaultGate>{() => <Rewrapper />}</VaultGate>)
  await user.click(await screen.findByRole('button', { name: '바꾸기' }))
  await screen.findByRole('button', { name: '바꿈' })
  expect(vault.store).toHaveBeenCalledTimes(1)
  const p = vault.store.mock.calls[0][0]
  expect(p.recovery).toEqual(v.vault.recovery)
  expect(p.keyId).toBe(v.vault.keyId)
  expect(p.dbName).toBe(v.vault.dbName)
  expect(p.dekB64).toBe(v.payload.dekB64)
  expect(p.pass.salt).not.toBe(v.vault.pass.salt)
  const k = await passKeyRaw('새암호구입니다2026', fromBase64(p.pass.salt), p.pass.iter)
  expect(unwrapDek(p.pass, k, p.keyId, 'pass')).toEqual(v.dek)
  // 다음 바꾸기는 새 pass를 기준으로 한다(두 번째 store도 recovery 유지)
})

test('웹에서는 VaultRewrapContext가 없다', async () => {
  render(<VaultGate>{() => <Rewrapper />}</VaultGate>)
  expect(await screen.findByRole('button', { name: '없음' })).toBeInTheDocument()
})

const dbNames = async () => (await indexedDB.databases()).map((d) => d.name)

test('ok인데 이 열쇠의 DB가 없으면 → missing(아무것도 만들지·저장하지 않음, 복원 단추)', async () => {
  const v = await makeVault({ meta: 'no-db' })
  const { vault } = fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
  render(<VaultGate renderSetup={(p) => <p>마법사 {p.reason}</p>}>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText(/이 열쇠의 자료가 이 PC에 없습니다/)).toBeInTheDocument()
  expect(screen.getByText(/아무것도 바꾸지 않았습니다/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '백업 파일에서 복원' })).toBeInTheDocument()
  expect(screen.queryByText(/마법사/)).not.toBeInTheDocument()
  expect(vault.store).not.toHaveBeenCalled()
  expect(await dbNames()).not.toContain(v.payload.dbName)
})

test('needs-pass: 암호구가 맞아도 DB가 없으면 → missing, store 없음, DB 안 만듦', async () => {
  const user = userEvent.setup()
  const v = await makeVault({ meta: 'no-db' })
  const { vault } = fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  await user.type(await screen.findByLabelText('백업 암호구'), PASS)
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText(/이 열쇠의 자료가 이 PC에 없습니다/)).toBeInTheDocument()
  expect(vault.store).not.toHaveBeenCalled()
  expect(await dbNames()).not.toContain(v.payload.dbName)
})

for (const meta of ['wrong-keyid', 'bad-check'] as const) {
  test(`meta 확인 실패(${meta}) → wrong-key, 쓰지 않음(ok·needs-pass 모두)`, async () => {
    const user = userEvent.setup()
    const v = await makeVault({ meta })
    const raw = new AppDB(v.payload.dbName, { vault: true })
    const before = await raw.meta.get('vault')
    raw.close()
    const { vault } = fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
    const { unmount } = render(<VaultGate renderSetup={(p) => <p>마법사 {p.reason}</p>}>{(db) => <Probe db={db} />}</VaultGate>)
    expect(await screen.findByText(/열쇠와 자료가 서로 맞지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '백업 파일에서 복원' })).toBeInTheDocument()
    unmount()
    vault.status.mockImplementation(async () => ({ state: 'needs-pass', vault: v.vault }))
    render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
    await user.type(await screen.findByLabelText('백업 암호구'), PASS)
    await user.click(screen.getByRole('button', { name: '열기' }))
    expect(await screen.findByText(/열쇠와 자료가 서로 맞지 않습니다/)).toBeInTheDocument()
    expect(vault.store).not.toHaveBeenCalled()
    const raw2 = new AppDB(v.payload.dbName, { vault: true })
    expect(await raw2.meta.get('vault')).toEqual(before)
    expect(await raw2.table('students').count()).toBe(0)
    raw2.close()
  })
}

test('열기 화면에서 복원: "현재 열쇠 파일을 새 것으로 바꿉니다" 확인 없이는 시작할 수 없다', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  const input = await screen.findByLabelText('백업 암호구')
  for (let i = 1; i <= 5; i++) {
    await user.clear(input)
    await user.type(input, '틀린암호구' + i)
    await user.click(screen.getByRole('button', { name: '열기' }))
    await screen.findByText('암호구가 맞지 않습니다')
  }
  await user.click(await screen.findByRole('button', { name: '백업 파일에서 복원' }))
  expect(screen.getByText(/원래 윈도우 계정/)).toBeInTheDocument()
  expect(screen.getByText(/이 계정에서는 더 이상 열 수 없습니다/)).toBeInTheDocument()
  await user.upload(screen.getByLabelText('백업 파일'), new File([new Uint8Array([1, 2, 3])], 'b.enc'))
  await user.type(screen.getByLabelText('백업 파일 암호구'), PASS)
  expect(screen.getByRole('button', { name: '복원' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: '현재 열쇠 파일을 새 것으로 바꿉니다' }))
  expect(screen.getByRole('button', { name: '복원' })).toBeEnabled()
})

test('열기 뒤 DPAPI 다시 저장이 실패하면 막지 않고 작은 안내를 보인다', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }), { store: async () => { throw new Error('열쇠 파일을 저장하지 못했습니다.') } })
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  await user.type(await screen.findByLabelText('백업 암호구'), PASS)
  await user.click(screen.getByRole('button', { name: '열기' }))
  expect(await screen.findByText(new RegExp(`열린 DB ${v.payload.dbName}`))).toBeInTheDocument()
  expect(screen.getByText('이 PC에 열쇠를 저장하지 못해 다음에도 암호구를 묻습니다')).toBeInTheDocument()
})

test('틀리면 입력칸으로 초점이 돌아온다', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  const input = await screen.findByLabelText('백업 암호구')
  await user.type(input, '틀린암호구')
  await user.click(screen.getByRole('button', { name: '열기' }))
  await screen.findByText('암호구가 맞지 않습니다')
  await waitFor(() => expect(input).toHaveFocus())
})

test('탭: tablist/tab/tabpanel, 화살표로 바꾼다', async () => {
  const user = userEvent.setup()
  const v = await makeVault()
  fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  const passTab = await screen.findByRole('tab', { name: '백업 암호구' })
  expect(screen.getByRole('tablist')).toBeInTheDocument()
  const panel = screen.getByRole('tabpanel')
  expect(passTab).toHaveAttribute('aria-controls', panel.id)
  expect(passTab).toHaveAttribute('aria-selected', 'true')
  passTab.focus()
  await user.keyboard('{ArrowRight}')
  const recTab = screen.getByRole('tab', { name: '복구 코드' })
  expect(recTab).toHaveAttribute('aria-selected', 'true')
  expect(recTab).toHaveFocus()
  expect(screen.getByLabelText('복구 코드')).toBeInTheDocument()
  await user.keyboard('{ArrowLeft}')
  expect(screen.getByRole('tab', { name: '백업 암호구' })).toHaveAttribute('aria-selected', 'true')
})

test('indexedDB.databases()가 실패하면 Dexie.exists로 옛 DB를 확인한다', async () => {
  const old = new AppDB('class-manager')
  await old.open()
  old.close()
  const spy = vi.spyOn(indexedDB, 'databases').mockRejectedValue(new Error('no'))
  try {
    fakeDesktop(async () => ({ state: 'none' }))
    render(<VaultGate renderSetup={(p) => <p>마법사 {p.reason}</p>}>{(db) => <Probe db={db} />}</VaultGate>)
    expect(await screen.findByText('마법사 migrate')).toBeInTheDocument()
  } finally {
    spy.mockRestore()
    await new Promise((r) => { const q = indexedDB.deleteDatabase('class-manager'); q.onsuccess = q.onerror = r })
  }
})

test('StrictMode 이중 실행에서도 열린 연결은 하나, 언마운트하면 닫힌다', async () => {
  const v = await makeVault()
  fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
  const openConns = () => (Dexie as unknown as { connections: Dexie[] }).connections
    .filter((d) => d.name === v.payload.dbName && d.isOpen()).length
  const { unmount } = render(<StrictMode><VaultGate>{(db) => <Probe db={db} />}</VaultGate></StrictMode>)
  expect(await screen.findByText(new RegExp(`열린 DB ${v.payload.dbName}`))).toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 50))
  expect(openConns()).toBe(1)
  unmount()
  await waitFor(() => expect(openConns()).toBe(0))
})

// ---- Task 10 ----
test('ok이고 완료 행도 있지만 옮기기 표시(meta migration)가 남아 있으면 → incomplete', async () => {
  const v = await makeVault()
  const db = openVaultDb(v.payload.dbName, v.dek)
  await db.meta.put({ id: 'migration', from: 'class-manager', stage: 'copy' })
  db.close()
  fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
  render(<VaultGate renderSetup={(p) => <p>마법사 {p.reason}</p>}>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText('마법사 incomplete')).toBeInTheDocument()
})

test('needs-pass + dpapiAvailable 거짓 → 열기 화면에 정확한 이유', async () => {
  const v = await makeVault()
  fakeDesktop(async () => ({ state: 'needs-pass', vault: v.vault, dpapiAvailable: false }))
  render(<VaultGate>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText(/윈도우 보호 저장소\(DPAPI\)를 쓸 수 없어, 켤 때마다 암호구를 묻습니다/)).toBeInTheDocument()
})

test('incomplete면 renderSetup에 열쇠(dek·keyId·dbName)를 넘긴다(이어 하기 확인용)', async () => {
  const v = await makeVault({ complete: false })
  fakeDesktop(async () => ({ state: 'ok', dekB64: v.payload.dekB64, vault: v.vault }))
  let got: { dek: Uint8Array; keyId: string; dbName: string } | undefined
  render(<VaultGate renderSetup={(p) => { got = p.key; return <p>마법사 {p.reason}</p> }}>{(db) => <Probe db={db} />}</VaultGate>)
  expect(await screen.findByText('마법사 incomplete')).toBeInTheDocument()
  expect(got?.keyId).toBe(v.payload.keyId)
  expect(got?.dbName).toBe(v.payload.dbName)
  expect(got?.dek).toEqual(v.dek)
})
