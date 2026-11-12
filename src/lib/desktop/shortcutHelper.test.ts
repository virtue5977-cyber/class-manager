import { encodePs, helperCmd, psScript } from './shortcutHelper'

test('도우미 .cmd: CRLF·ASCII, PowerShell을 UTF-16LE base64로', () => {
  const { name, bytes } = helperCmd('install')
  const text = new TextDecoder().decode(bytes)
  expect(name).toBe('Watson_바로가기_만들기.cmd')
  expect(text.startsWith('@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ')).toBe(true)
  expect([...bytes].every((b) => b < 128)).toBe(true)
  const b64 = text.split('-EncodedCommand ')[1].trim()
  expect(b64).toBe(encodePs(psScript('install')))
  // 되돌려 읽으면 같은 스크립트(한글 포함)
  const bin = atob(b64)
  let back = ''
  for (let i = 0; i < bin.length; i += 2) back += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
  expect(back).toBe(psScript('install'))
})

test('설치는 Watson.exe를 찾아 바탕화면·시작 프로그램에 바로가기, 끄기는 시작 프로그램 것만 지운다', () => {
  const i = psScript('install')
  expect(i).toContain("-Filter 'Watson.exe' -Recurse -Depth 3")
  expect(i).toContain("GetFolderPath('Startup')")
  expect(i).toContain('CreateShortcut')
  const r = psScript('remove')
  expect(r).toContain("Join-Path $startup 'Watson.lnk'")
  expect(r).not.toContain('$desk \'Watson.lnk\'')
})
