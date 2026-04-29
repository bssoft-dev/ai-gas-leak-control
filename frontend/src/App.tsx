import React from 'react'
import './App.css'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppShellLayout from './features/app-shell/ui/AppShellLayout'
import AiHistoryPage from './features/ai-history/page/AiHistoryPage'
import DrawingSensorPage from './features/drawing-sensor/page/DrawingSensorPage'
import ControlAlarmHistoryPage from './features/history/page/ControlAlarmHistoryPage'
import MonitorPage from './features/monitor/page/MonitorPage'
import SettingsPage from './features/settings/page/SettingsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShellLayout />}>
          <Route path="/" element={<MonitorPage />} />
          <Route path="/drawing-sensor" element={<DrawingSensorPage />} />
          <Route path="/history/ai" element={<AiHistoryPage />} />
          <Route path="/history/control-alarm" element={<ControlAlarmHistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/ai-history" element={<Navigate to="/history/ai" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
