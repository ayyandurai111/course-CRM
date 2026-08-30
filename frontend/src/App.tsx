import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../../features/auth/frontend/context/AuthContext";
import LandingPage from "../../features/site-content-cms/frontend/pages/LandingPage";
import LoginPage from "../../features/auth/frontend/pages/LoginPage";
import StudentDashboard from "../../features/students/frontend/pages/StudentDashboard";
import AdminPanel from "../../features/admin-shell/frontend/pages/AdminPanel";
import MeetingPage from "../../features/meetings/frontend/pages/MeetingPage";
import RecordingLayoutPage from "../../features/meetings/frontend/pages/RecordingLayoutPage";
import { StudentDashboardSkeletonShell, AdminPanelSkeletonShell } from "../../shared/frontend-core/components/common/PageSkeletons";

function RequireMeeting({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading && !user) return <div className="min-h-screen bg-ink-950" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

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
      <Route path="/meeting/:id" element={<RequireMeeting><MeetingPage /></RequireMeeting>} />
      {/* Loaded only by LiveKit Egress's headless Chrome (see
          meetingRecordingService.js's customBaseUrl) to render meeting
          recordings — never linked to from the app UI, and intentionally
          NOT behind RequireMeeting: Egress authenticates to LiveKit with
          its own recorder token in the URL, not a logged-in session. */}
      <Route path="/recording-layout" element={<RecordingLayoutPage />} />
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
