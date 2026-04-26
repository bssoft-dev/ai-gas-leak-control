import React from 'react'
import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import AppShellLayout from './features/app-shell/ui/AppShellLayout'
import AiHistoryPage from './features/ai-history/page/AiHistoryPage'
import DrawingSensorPage from './features/drawing-sensor/page/DrawingSensorPage'
import MonitorPage from './features/monitor/page/MonitorPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShellLayout />}>
          <Route path="/" element={<MonitorPage />} />
          <Route path="/drawing-sensor" element={<DrawingSensorPage />} />
          <Route path="/ai-history" element={<AiHistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
