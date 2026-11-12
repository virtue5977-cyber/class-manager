/** exe를 바꾸지 않고 바탕화면 바로가기·켤 때 자동 실행을 만드는 도우미(.cmd). PowerShell을 -EncodedCommand로 넣어 따옴표·한글 문제를 피한다. */

const FIND = `$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
function Say($m) { [void][System.Windows.Forms.MessageBox]::Show($m, 'Watson') }
$desk = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
`

const INSTALL = `${FIND}$roots = @($desk, (Join-Path $env:USERPROFILE 'Downloads'), [Environment]::GetFolderPath('MyDocuments'), $env:OneDrive) | Where-Object { $_ -and (Test-Path $_) }
$found = @()
foreach ($r in $roots) { $found += Get-ChildItem -Path $r -Filter 'Watson.exe' -Recurse -Depth 3 -File -ErrorAction SilentlyContinue }
$found += Get-ChildItem -Path $env:USERPROFILE -Filter 'Watson.exe' -Recurse -Depth 1 -File -ErrorAction SilentlyContinue
$exe = $found | Where-Object { $_ -and $_.FullName -notmatch '\\\\resources\\\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { Say 'Watson.exe를 찾지 못했습니다. 바탕화면·다운로드·문서 폴더 안(3단까지)에 Watson 폴더가 있는지 확인하세요.'; exit 1 }
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @($desk, $startup)) {
  $l = $ws.CreateShortcut((Join-Path $dir 'Watson.lnk'))
  $l.TargetPath = $exe.FullName
  $l.WorkingDirectory = $exe.DirectoryName
  $l.IconLocation = $exe.FullName + ',0'
  $l.Description = 'Watson'
  $l.Save()
}
Say ('바탕화면 바로가기와 자동 실행(시작 프로그램)을 만들었습니다.' + [Environment]::NewLine + $exe.FullName)
`

const REMOVE = `${FIND}$p = Join-Path $startup 'Watson.lnk'
if (Test-Path $p) { Remove-Item $p -Force; Say '컴퓨터를 켤 때 자동 실행을 껐습니다. 바탕화면 바로가기는 그대로입니다.' } else { Say '자동 실행이 켜져 있지 않습니다.' }
`

/** UTF-16LE base64(PowerShell -EncodedCommand) */
export function encodePs(script: string): string {
  const bytes = new Uint8Array(script.length * 2)
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    bytes[i * 2] = c & 0xff
    bytes[i * 2 + 1] = c >> 8
  }
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function psScript(kind: 'install' | 'remove'): string {
  return kind === 'install' ? INSTALL : REMOVE
}

/** 받을 .cmd 파일(줄 끝 CRLF, 글은 ASCII만) */
export function helperCmd(kind: 'install' | 'remove'): { name: string; bytes: Uint8Array } {
  const body = ['@echo off', `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodePs(psScript(kind))}`, ''].join('\r\n')
  return { name: kind === 'install' ? 'Watson_바로가기_만들기.cmd' : 'Watson_자동실행_끄기.cmd', bytes: new TextEncoder().encode(body) }
}
