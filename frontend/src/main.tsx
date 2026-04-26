import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { initOpenApi } from './api/initOpenApi'
import { ErrorBoundary } from './shared/ui/ErrorBoundary'

initOpenApi()

async function bootstrap() {
  const shouldUseMsw = import.meta.env.VITE_ENABLE_MSW === 'true'

  if (shouldUseMsw) {
    const { worker } = await import('./mocks/browser')
    await worker.start({
      onUnhandledRequest: 'bypass',
    })
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

bootstrap()
