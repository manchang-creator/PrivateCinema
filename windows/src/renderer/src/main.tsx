import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initTheme } from './theme'
import './styles.css'

// 首帧前应用主题，避免刷新时闪一下错误配色
initTheme()

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
