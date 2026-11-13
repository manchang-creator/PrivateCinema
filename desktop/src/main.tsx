import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initTheme } from './theme'
import { installCinemaBridge } from './bridge'
import './styles.css'

// 首帧前：先取本地媒体基址并挂上 window.cinema，再应用主题，避免闪一下错误配色。
async function bootstrap(): Promise<void> {
  await installCinemaBridge()
  initTheme()

  const container = document.getElementById('root')
  if (container === null) throw new Error('缺少 #root 挂载点')

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
