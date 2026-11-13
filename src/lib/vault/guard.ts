/** 새 판(1.0+)의 암호화 DB(`watson-…`)가 이 PC에 있는지. 확인할 수 없으면 거짓(옛 exe를 막지 않는다). */
export async function newerDataPresent(
  dbs: () => Promise<{ name?: string }[]> = () => indexedDB.databases(),
): Promise<boolean> {
  try {
    const list = await dbs()
    return list.some((d) => typeof d.name === 'string' && d.name.startsWith('watson-'))
  } catch {
    return false
  }
}
