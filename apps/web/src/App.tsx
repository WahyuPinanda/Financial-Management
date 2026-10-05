import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './features/auth/AuthProvider';
import { AuthPage } from './features/auth/AuthPage';
import { DashboardPage } from './features/dashboard/DashboardPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="app-loading" role="status">
        Menyiapkan ruang kerja Anda…
      </div>
    );
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage key="login" mode="login" />} />
          <Route path="/forgot-password" element={<AuthPage key="forgot" mode="forgot" />} />
          <Route path="/reset-password" element={<AuthPage key="reset" mode="reset" />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/panen"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          {import.meta.env.DEV && <Route path="/preview" element={<DashboardPage preview />} />}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
