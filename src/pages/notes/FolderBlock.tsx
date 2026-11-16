import { useState } from 'react'
import Icon from '../../components/Icon'
import { getFolderBridge, ipcMessage, NEED_EXE, NOT_ALLOWED } from '../../lib/notes/folders'

/**
 * 노트 '폴더' 블록. 메인은 대화상자로 고른 폴더만 열어 준다.
 * 예전에 저장한 경로(아직 허용 목록에 없음)는 처음 열 때 '이 폴더를 열도록 허용'(대화상자 다시 고르기)으로 등록한다.
 */
export default function FolderBlock({ path, onPath, onMsg }: { path: string; onPath: (p: string) => void; onMsg: (m: string) => void }) {
  const [list, setList] = useState<{ name: string; dir: boolean }[] | null>(null)
  const [needAllow, setNeedAllow] = useState<'open' | 'list' | null>(null)

  async function run(kind: 'open' | 'list', p = path) {
    const br = getFolderBridge()
    if (!br) return onMsg(NEED_EXE)
    try {
      if (kind === 'open') await br.open(p)
      else {
        setList([])
        setList(await br.list(p))
      }
      setNeedAllow(null)
    } catch (e) {
      const m = ipcMessage(e)
      if (m === NOT_ALLOWED && br.allow) {
        if (kind === 'list') setList(null)
        setNeedAllow(kind)
      } else onMsg(m)
    }
  }

  async function allow() {
    const br = getFolderBridge()
    if (!br?.allow || !needAllow) return
    try {
      const r = await br.allow(path)
      if (!r) return
      if (r.path !== path) onPath(r.path)
      await run(needAllow, r.path)
    } catch (e) {
      onMsg(ipcMessage(e))
    }
  }

  return (
    <div className="nb-folder">
      <button type="button" className="link" onClick={() => void run('open')}>
        <Icon name="folder" size={14} /> {path}
      </button>
      <button type="button" className="link muted" onClick={() => void run('list')}>
        안의 파일 보기
      </button>
      {needAllow && (
        <span className="row">
          <span className="muted">{NOT_ALLOWED}</span>
          <button type="button" onClick={() => void allow()}>
            이 폴더를 열도록 허용
          </button>
        </span>
      )}
      {list && (
        <ul className="plain nb-folder-list">
          {list.map((x) => <li key={x.name}>{x.dir ? <Icon name="folder" size={12} /> : '·'} {x.name}</li>)}
        </ul>
      )}
    </div>
  )
}
