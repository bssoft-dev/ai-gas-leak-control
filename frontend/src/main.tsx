import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initOpenApi } from './api/initOpenApi'

initOpenApi()

if (import.meta.env.DEV) {
  import('./mocks/browser')
    .then(({ worker }) =>
      worker.start({
        onUnhandledRequest: 'bypass',
      }),
    )
    .catch(() => {
      // ignore
    })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
