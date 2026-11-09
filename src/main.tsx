import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyAppearance, readAppearance } from './lib/ui/appearance'

applyAppearance(readAppearance())

// 브라우저가 저장 공간이 모자랄 때 자료를 지우지 않도록 '영구 저장'을 요청한다.
navigator.storage?.persist?.().catch(() => {})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
