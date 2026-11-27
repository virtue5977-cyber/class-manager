import { aiErrorGuide } from './errorGuide'

test('로그인 없음·agy 없음은 바뀐 안내, 그 밖은 그대로', () => {
  expect(aiErrorGuide("Error invoking remote method 'ai:ask': Error: Claude Code에 로그인되어 있지 않습니다. 명령 창에서 claude 를 한 번 실행해 로그인하세요.")).toBe(
    'Claude Code 로그인이 없거나 만료되었습니다. PowerShell에서 claude auth login 을 실행해 다시 로그인한 뒤 다시 보내기를 누르세요.',
  )
  expect(aiErrorGuide('Antigravity CLI(agy)를 찾지 못했습니다. 설치 후 명령 창에서 agy 를 한 번 실행해 로그인하세요.')).toBe(
    'Antigravity CLI(agy)가 이 PC에 없습니다. 설정 > AI에서 Claude Code를 고르거나, Antigravity CLI를 설치하세요.',
  )
  expect(aiErrorGuide('AI 사용 한도에 걸렸습니다.')).toBe('AI 사용 한도에 걸렸습니다.')
})
