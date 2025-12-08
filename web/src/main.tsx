// 应用入口：挂载 React 根节点并注入 Jotai Provider。
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'jotai'
import { BrowserRouter } from 'react-router-dom'
import App from './components/App'
import './index.css'
import { applyTheme, getInitialTheme } from './styles/theme'

const initialTheme = getInitialTheme()
applyTheme(initialTheme)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider>
        <App initialTheme={initialTheme} />
      </Provider>
    </BrowserRouter>
  </React.StrictMode>
)

