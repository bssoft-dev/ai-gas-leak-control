import React from 'react'
import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import AppShellLayout from './components/layout/AppShellLayout'
import AiHistoryPage from './pages/AiHistoryPage'
import DrawingSensorPage from './pages/DrawingSensorPage'
import MonitorPage from './pages/MonitorPage'

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