// @vitest-environment node
// main.cjs·preload.cjs는 Electron 안에서만 돈다. 연결이 빠지지 않았는지 글자로 확인한다(논리는 updateCore.test.ts).
import fs from 'node:fs'
import path from 'node:path'

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../../electron', f), 'utf8')

test('main: 설치는 verifyInstall·manifest 전체 확인·원자 쓰기·skip, 켤 때 decideStart·quick 확인', () => {
  const m = read('main.cjs')
  expect(m).toMatch(/require\('\.\/updateCore\.cjs'\)/)
  expect(m).toMatch(/UC\.verifyInstall\(info, sha, UPDATE_PUBLIC_KEY\)/)
  expect(m).toMatch(/UC\.checkManifest\(target, /)
  expect(m).toMatch(/UC\.writeCurrentAtomic\(UPDATES_DIR\(\), \{ version: info\.version/)
  expect(m).toMatch(/skip\.includes\(info\.version\)/)
  expect(m).toMatch(/UC\.decideStart\(cur\)/)
  expect(m).toMatch(/UC\.quickStartCheck\(dir, \{ cache: next\.cache \}\)/)
  expect(m).toMatch(/'render-process-gone'/)
  expect(m).toMatch(/'did-fail-load'/)
  expect(m).toMatch(/handle\('bundle:alive'/)
  expect(m).not.toMatch(/Buffer\.from\(info\.sig, 'base64'\)/) // 옛 sig 확인은 updateCore로
  expect(m).toMatch(/const SHELL = 7\b/) // 1.0 exe
  // 받은 판은 shell ≤ SHELL만 쓰고, 더 높으면 새 exe를 받게 한다
  expect(m).toMatch(/c\.shell <= SHELL/)
  expect(m).toMatch(/info\.shell > SHELL\) return sendUpdate\(\{ status: 'need-exe'/)
})

test('preload: shell은 main.cjs SHELL(7)과 같다', () => {
  const shell = Number(/const SHELL = (\d+)/.exec(read('main.cjs'))![1])
  expect(shell).toBe(7)
  expect(read('preload.cjs')).toMatch(new RegExp(`\\bshell: ${shell},`))
})

test('preload: desktop.bundle.alive()는 bundle:alive를 부른다', () => {
  expect(read('preload.cjs')).toMatch(/bundle: \{\s*alive: \(\) => ipcRenderer\.invoke\('bundle:alive'\)/)
})

test('main(fix 1): 화면 죽음 판정은 onRendererGone, 종료 중 표시, quick 확인은 quickStartCheck', () => {
  const m = read('main.cjs')
  expect(m).toMatch(/UC\.onRendererGone\(/)
  expect(m).toMatch(/'query-session-end'/)
  expect(m).toMatch(/'before-quit'/)
  expect(m).toMatch(/UC\.quickStartCheck\(/)
  expect(m).not.toMatch(/d\.reason !== 'clean-exit'\) bundleFailed/)
})

test('판 고르기가 실패해도 exe에 든 화면으로 연다', () => {
  expect(read('main.cjs')).toMatch(/await pickDist\(\)\.catch\(\(\) => \(\{ dist: BUILT_DIST/)
})

test('main: 해시 주소로 화면을 옮겨도(같은 문서) 닫기 전 저장 준비 표시를 지우지 않는다', () => {
  const m = read('main.cjs')
  expect(m).toMatch(/did-start-navigation/)
  expect(m).toMatch(/if \(main && !same\) closeFlow\.setReady\(false\)/)
})

test('main: 업데이트 확인 io 오류 코드는 로그에 남는 글자(.)로 잇는다', () => {
  expect(read('main.cjs')).toMatch(/update\.manifest_io', \{ codes: \(q\.codes \|\| \[\]\)\.join\('\.'\) \}/)
})
