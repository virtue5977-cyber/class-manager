// electron-builder afterPack: Windows 실행 파일의 Electron fuses를 바꾼다(포터블로 묶기 전에 돈다).
// RunAsNode·NODE_OPTIONS·--inspect 끄기, 쿠키 암호화 켜기, file 프로토콜 특권 끄기.
// asar 무결성(EnableEmbeddedAsarIntegrityValidation·OnlyLoadAppFromAsar)은 건드리지 않는다:
// electron-builder 25는 무결성 해시를 넣지 않아, 켜면 앱이 켜지자마자 강제 종료된다(spec §9.2·§13).
// 빌드 뒤 확인: npx @electron/fuses read --app release/win-unpacked/Watson.exe
const path = require('node:path')

async function afterPack(context, deps = {}) {
  if (context.electronPlatformName !== 'win32') return
  const lib = await import('@electron/fuses')
  const flipFuses = deps.flipFuses || lib.flipFuses
  const { FuseVersion, FuseV1Options } = lib
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  })
}
afterPack.afterPack = afterPack
module.exports = afterPack
