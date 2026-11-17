// preload의 onBeforeClose: 메인의 'app:before-close'에 콜백이 끝난 뒤(오류 무시) 'app:close-ok'로 답한다.
// 걸면 'app:before-close-ready', 해제하면(복원 뒤 화면을 다시 그릴 때 등) 'app:before-close-unready'를 보내
// 메인이 답할 화면이 없는 동안 닫기를 3초씩 붙잡지 않게 한다.
function makeOnBeforeClose(ipc) {
  let off = null
  return (cb) => {
    if (off) off()
    const h = async () => {
      try { await cb() } catch { /* 저장이 실패해도 닫기는 진행 */ }
      ipc.send('app:close-ok')
    }
    ipc.on('app:before-close', h)
    ipc.send('app:before-close-ready')
    off = () => { ipc.removeListener('app:before-close', h); off = null; ipc.send('app:before-close-unready') }
    return off
  }
}
module.exports = { makeOnBeforeClose }
