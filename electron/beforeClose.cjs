// preload의 onBeforeClose: 메인의 'app:before-close'에 콜백이 끝난 뒤(오류 무시) 'app:close-ok'로 답한다.
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
    off = () => { ipc.removeListener('app:before-close', h); off = null }
    return off
  }
}
module.exports = { makeOnBeforeClose }
