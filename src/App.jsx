import React, { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import TopNav from './components/TopNav';
import RiskChat from './components/RiskChat';
import MarketTicker from './components/MarketTicker';

import HomePage from './pages/HomePage';
import RegisterPage from './pages/RegisterPage';
import AnalysisPage from './pages/AnalysisPage';
import ScenarioPage from './pages/ScenarioPage';
import AlertsPage from './pages/AlertsPage';

export default function App() {
  const [theme, setTheme] = useState('light');

  return (
    <BrowserRouter>
      <div className="shell" data-theme={theme}>
        <TopNav theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <main className="page-shell">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/analysis/:shipmentId" element={<AnalysisPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/scenario/:shipmentId" element={<ScenarioPage />} />
            <Route path="/scenario" element={<ScenarioPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
          </Routes>
        </main>
        <RiskChat />
        <MarketTicker />
      </div>
    </BrowserRouter>
  );
}
