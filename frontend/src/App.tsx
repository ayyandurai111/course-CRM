import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import StudentDashboard from "./pages/StudentDashboard";
import AdminPanel from "./pages/AdminPanel";

function FullScreenLoader() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-paper-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-300 border-t-amber-500" />
    </div>
  );
}

function RequireRole({ role, children }: { role: "STUDENT" | "ADMIN"; children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
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
