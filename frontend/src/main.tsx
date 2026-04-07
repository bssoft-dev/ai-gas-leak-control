import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { initOpenApi } from './api/initOpenApi'

initOpenApi()

async function bootstrap() {
  if (import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser')
    await worker.start({
      onUnhandledRequest: 'bypass',
    })
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

bootstrap()
