import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import StudentDashboard from "./pages/StudentDashboard";
import AdminPanel from "./pages/AdminPanel";
import { StudentDashboardSkeletonShell, AdminPanelSkeletonShell } from "./components/common/PageSkeletons";

function RequireRole({ role, children }: { role: "STUDENT" | "ADMIN"; children: JSX.Element }) {
  const { user, loading } = useAuth();
  // Only show the skeleton shell while there's no user yet (the very
  // first check on page load). If we already have a user rendered, never
  // swap back to it — that would unmount the whole dashboard and reset
  // all its state, which is exactly what made the app look like it was
  // auto-reloading whenever a tab regained focus.
  if (loading && !user) return role === "ADMIN" ? <AdminPanelSkeletonShell /> : <StudentDashboardSkeletonShell />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) {
    return <Navigate to={user.role === "ADMIN" ? "/admin" : "/dashboard"} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireRole role="STUDENT">
            <StudentDashboard />
          </RequireRole>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireRole role="ADMIN">
            <AdminPanel />
          </RequireRole>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
