import { Link } from 'react-router-dom'
import { edition } from '../lib/update/update'

/** HTML판(단일 파일) 종료 안내: 늘 보이고, 설치형으로 옮기는 방법을 알려 준다. */
export default function HtmlEndBanner() {
  if (!edition.single) return null
  return (
    <div className="banner" role="status">
      <span>
        HTML판은 0.17로 끝납니다. 학생 자료를 지키려면 설치형(Windows 앱)으로 옮기세요: 설정 &gt; 백업에서{' '}
        <Link to="/settings?tab=backup">백업 파일 내려받기</Link> → 설치형에서 '백업 파일에서 복원'.
      </span>
    </div>
  )
}
