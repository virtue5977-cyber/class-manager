/** main(exe)이 준 AI 오류 글을 지금 안내에 맞게 바꾼다. 옛 exe의 문구도 여기서 바로잡는다. */
export function aiErrorGuide(message: string): string {
  if (message.includes('Claude Code에 로그인되어 있지 않습니다')) {
    return 'Claude Code 로그인이 없거나 만료되었습니다. PowerShell에서 claude auth login 을 실행해 다시 로그인한 뒤 다시 보내기를 누르세요.'
  }
  if (message.includes('Antigravity CLI(agy)를 찾지 못했습니다')) {
    return 'Antigravity CLI(agy)가 이 PC에 없습니다. 설정 > AI에서 Claude Code를 고르거나, Antigravity CLI를 설치하세요.'
  }
  return message
}
