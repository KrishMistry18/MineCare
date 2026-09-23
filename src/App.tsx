/**
 * MineCare - Smart Mine Safety Helmet Platform
 * Frontend Rebuild with Lovable Reference Parity
 */

import React, { useState, useEffect } from 'react';
import { TelemetryProvider } from './context/TelemetryContext';
import { Sidebar, type NavRoute } from './components/layout/Sidebar';
import { ControlRoomDashboard } from './components/dashboard/ControlRoomDashboard';
import { HelmetsPage } from './components/fleet/HelmetsPage';
import { WorkersPage } from './components/workers/WorkersPage';
import { AlertsPage } from './components/alerts/AlertsPage';
import { AnalyticsPage } from './components/analytics/AnalyticsPage';
import { SystemHealthPage } from './components/system/SystemHealthPage';
import { TelemetryModal } from './components/telemetry/TelemetryModal';
import { Menu, X } from 'lucide-react';

const AppContent: React.FC = () => {
  // Sync route with window.location.pathname or fallback to '/'
  const [currentRoute, setCurrentRoute] = useState<NavRoute>(() => {
    const path = window.location.pathname as NavRoute;
    if (['/', '/fleet', '/workers', '/alerts', '/analytics', '/system'].includes(path)) {
      return path;
    }
    return '/';
  });

  const [inspectedHelmetId, setInspectedHelmetId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Sync browser URL on route change
  const navigateTo = (route: NavRoute) => {
    setCurrentRoute(route);
    window.history.pushState({}, '', route);
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname as NavRoute;
      if (['/', '/fleet', '/workers', '/alerts', '/analytics', '/system'].includes(path)) {
        setCurrentRoute(path);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      
      {/* Persistent Desktop Sidebar */}
      <div className="hidden md:flex">
        <Sidebar currentRoute={currentRoute} onRouteChange={navigateTo} />
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-50 flex">
            <Sidebar currentRoute={currentRoute} onRouteChange={navigateTo} />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Mobile Top Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-[#080d16] border-b border-[#151f30] sticky top-0 z-30">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-lg bg-[#0d1420] border border-[#1b2538] text-slate-300"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <span className="font-bold text-white text-sm font-mono">
            MINECARE
          </span>
          <div className="w-6" />
        </div>

        {/* Page Container */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          {currentRoute === '/' && (
            <ControlRoomDashboard
              onNavigateToFleet={() => navigateTo('/fleet')}
              onInspectHelmet={setInspectedHelmetId}
            />
          )}

          {currentRoute === '/fleet' && (
            <HelmetsPage onInspectHelmet={setInspectedHelmetId} />
          )}

          {currentRoute === '/workers' && (
            <WorkersPage onInspectHelmet={setInspectedHelmetId} />
          )}

          {currentRoute === '/alerts' && (
            <AlertsPage />
          )}

          {currentRoute === '/analytics' && (
            <AnalyticsPage />
          )}

          {currentRoute === '/system' && (
            <SystemHealthPage />
          )}
        </main>
      </div>

      {/* Detail Waveform Modal */}
      <TelemetryModal
        helmetId={inspectedHelmetId}
        onClose={() => setInspectedHelmetId(null)}
      />
    </div>
  );
};

export function App() {
  return (
    <TelemetryProvider>
      <AppContent />
    </TelemetryProvider>
  );
}

export default App;
