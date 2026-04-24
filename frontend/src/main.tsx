import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { initOpenApi } from './api/initOpenApi'
import { ErrorBoundary } from './components/ErrorBoundary'

initOpenApi()

async function bootstrap() {
  const shouldUseMsw =
    import.meta.env.DEV ||
    // `vite preview`/정적 서빙으로 로컬 확인 시에도 백엔드가 없으면 MSW가 필요함
    (import.meta.env.PROD && window.location.hostname === 'localhost')

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
