// 창 닫기 전 저장 흐름(순수 로직, Node 시험 가능). 메인이 send/destroy/타이머를 넘겨 준다.
// - 화면이 준비를 알린 뒤의 첫 close는 막고 before-close를 보낸 다음, close-ok 또는 시간 초과에 딱 한 번 destroy.
// - 세션 종료(로그오프·끄기)는 막지 않고 before-close만 보낸다(막으면 '종료를 막는 앱' 창이 뜬다).
function createCloseFlow({ send, destroy, setTimer, clearTimer, timeoutMs = 3000 }) {
  let ready = false
  let pending = false
  let done = false
  let sessionEnding = false
  let timer = null
  let restartWaiters = []
  const finish = () => {
    if (done) return
    done = true
    pending = false
    if (timer !== null) clearTimer(timer)
    timer = null
    destroy()
  }
  return {
    setReady(v) { ready = !!v },
    onClose(e) {
      if (done || sessionEnding || !ready) return
      e.preventDefault()
      if (pending) return
      pending = true
      send()
      timer = setTimer(finish, timeoutMs)
    },
    onCloseOk() {
      const w = restartWaiters; restartWaiters = []
      w.forEach((f) => f())
      if (pending) finish()
    },
    /** 업데이트 재시작: 닫기를 거치지 않으니 저장 신호를 보내고 close-ok 또는 시간 초과까지 기다린다(창은 닫지 않음). */
    beforeRestart() {
      if (!ready || done) return Promise.resolve()
      return new Promise((resolve) => {
        let t = null
        const go = () => { if (t !== null) clearTimer(t); resolve() }
        restartWaiters.push(go)
        if (!pending) send()
        t = setTimer(go, timeoutMs)
      })
    },
    onSessionEnd() {
      if (sessionEnding) return
      sessionEnding = true
      if (ready && !pending && !done) send()
    },
  }
}
module.exports = { createCloseFlow }
