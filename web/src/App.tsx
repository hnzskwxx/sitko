import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { onUnauthorized } from './api';
import { AppShell } from './components/AppShell';
import { ErrorState, Spinner } from './components/ui';
import { useMe } from './hooks';
import { InvitePage, LoginPage, RegisterPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { NotFoundPage } from './pages/NotFound';

// Méně používané obrazovky se načítají až při prvním otevření
const CandidatePage = lazy(() => import('./pages/Candidate').then((m) => ({ default: m.CandidatePage })));
const JobPage = lazy(() => import('./pages/Job').then((m) => ({ default: m.JobPage })));
const JobNewPage = lazy(() => import('./pages/JobNew').then((m) => ({ default: m.JobNewPage })));
const JobsPage = lazy(() => import('./pages/Jobs').then((m) => ({ default: m.JobsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));

export function App() {
  const me = useMe();
  const qc = useQueryClient();
  const location = useLocation();

  useEffect(() => onUnauthorized(() => {
    if (qc.getQueryData(['me'])) qc.setQueryData(['me'], null);
  }), [qc]);

  if (me.isPending) return <div className="auth"><Spinner /></div>;
  if (me.isError) return <div className="auth"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  const user = me.data;

  return (
    <Routes>
      <Route path="/prihlaseni" element={user ? <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace /> : <LoginPage />} />
      <Route path="/registrace" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
      <Route path="/pozvanka/:token" element={<InvitePage />} />
      <Route
        path="*"
        element={user ? (
          <AppShell me={user}>
            <Suspense fallback={<div className="page"><Spinner /></div>}>
            <Routes>
              <Route path="/" element={<DashboardPage me={user} />} />
              <Route path="/pozice" element={<JobsPage />} />
              <Route path="/pozice/nova" element={<JobNewPage />} />
              <Route path="/pozice/:jobId/kandidati/:appId" element={<CandidatePage me={user} />} />
              <Route path="/pozice/:jobId/*" element={<JobPage me={user} />} />
              <Route path="/nastaveni/*" element={<SettingsPage me={user} />} />
              {user.isPlatformAdmin && <Route path="/sprava/*" element={<AdminPage />} />}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </Suspense>
          </AppShell>
        ) : <Navigate to="/prihlaseni" replace state={{ from: location.pathname + location.search }} />}
      />
    </Routes>
  );
}
