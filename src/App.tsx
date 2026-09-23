/**
 * MineCare - Smart Mine Safety Helmet Platform
 * Frontend Rebuild with Lovable Reference Parity + RBAC & Authentication
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TelemetryProvider } from './context/TelemetryContext';
import { Sidebar, type NavRoute } from './components/layout/Sidebar';
import { ControlRoomDashboard } from './components/dashboard/ControlRoomDashboard';
import { HelmetsPage } from './components/fleet/HelmetsPage';
import { WorkersPage } from './components/workers/WorkersPage';
import { AlertsPage } from './components/alerts/AlertsPage';
import { AnalyticsPage } from './components/analytics/AnalyticsPage';
import { SystemHealthPage } from './components/system/SystemHealthPage';
import { TelemetryModal } from './components/telemetry/TelemetryModal';
import { LoginPage } from './components/auth/LoginPage';
import { WorkerPortalPage } from './components/worker/WorkerPortalPage';
import { AdminConsolePage } from './components/admin/AdminConsolePage';
import { UserMenu } from './components/auth/UserMenu';
import { Menu, X, HardHat, Loader2 } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, role, isLoading, isAuthenticated } = useAuth();

  // Sync route with window.location.pathname or fallback to '/'
  const [currentRoute, setCurrentRoute] = useState<NavRoute>(() => {
    const path = window.location.pathname as NavRoute;
    if (['/', '/fleet', '/workers', '/alerts', '/analytics', '/system', '/admin', '/worker'].includes(path)) {
      return path;
    }
    return '/';
  });

  const [inspectedHelmetId, setInspectedHelmetId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [fleetOptions, setFleetOptions] = useState<{ zone?: string | null; view?: 'GRID' | 'MAP' }>({
    view: 'GRID',
    zone: null,
  });

  // Sync browser URL on route change
  const navigateTo = (route: NavRoute) => {
    setCurrentRoute(route);
    window.history.pushState({}, '', route);
    setMobileMenuOpen(false);
  };

  const handleNavigateToFleet = (options?: { zone?: string; view?: 'GRID' | 'MAP' }) => {
    if (options) {
      setFleetOptions({
        view: options.view || 'MAP',
        zone: options.zone || null,
      });
    } else {
      setFleetOptions({ view: 'GRID', zone: null });
    }
    navigateTo('/fleet');
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname as NavRoute;
      if (['/', '/fleet', '/workers', '/alerts', '/analytics', '/system', '/admin', '/worker'].includes(path)) {
        setCurrentRoute(path);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Route protection redirect effect
  useEffect(() => {
    if (!isAuthenticated) {
      if (window.location.pathname !== '/login') {
        window.history.replaceState({}, '', '/login');
      }
      return;
    }

    if (role === 'WORKER') {
      if (currentRoute !== '/worker') {
        setCurrentRoute('/worker');
        window.history.replaceState({}, '', '/worker');
      }
    } else if (role === 'SUPERVISOR') {
      if (currentRoute === '/admin' || currentRoute === '/worker') {
        setCurrentRoute('/');
        window.history.replaceState({}, '', '/');
      }
    }
  }, [isAuthenticated, role, currentRoute]);

  // Loading Splash Screen (avoids flashing protected routes)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#080c14] flex flex-col items-center justify-center text-slate-400 font-mono text-xs space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-xl shadow-cyan-950/60 animate-pulse">
          <HardHat className="w-6 h-6" />
        </div>
        <div className="flex items-center space-x-2 text-cyan-300">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          <span className="tracking-wider">VERIFYING MINECARE SECURITY SESSION...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated user -> Login Page
  if (!isAuthenticated || !user) {
    return (
      <LoginPage
        onSuccess={() => {
          const next = role === 'WORKER' ? '/worker' : '/';
          navigateTo(next as NavRoute);
        }}
      />
    );
  }

  // Worker Role -> Dedicated Worker Self-Service Portal
  if (role === 'WORKER') {
    return <WorkerPortalPage />;
  }

  // Supervisor & Admin Roles -> Control Room Operations Console
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
          <UserMenu compact />
        </div>

        {/* Page Container */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          {currentRoute === '/' && (
            <ControlRoomDashboard
              onNavigateToFleet={handleNavigateToFleet}
              onInspectHelmet={setInspectedHelmetId}
            />
          )}

          {currentRoute === '/fleet' && (
            <HelmetsPage 
              onInspectHelmet={setInspectedHelmetId} 
              initialView={fleetOptions.view || 'GRID'}
              initialZone={fleetOptions.zone || null}
            />
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

          {currentRoute === '/admin' && role === 'ADMIN' && (
            <AdminConsolePage />
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
    <AuthProvider>
      <TelemetryProvider>
        <AppContent />
      </TelemetryProvider>
    </AuthProvider>
  );
}

export default App;
