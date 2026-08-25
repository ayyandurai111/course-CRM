import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import StudentDashboard from "./pages/StudentDashboard";
import AdminPanel from "./pages/AdminPanel";
import { StatCardsSkeleton, UpcomingCoursesSkeleton, ListRowsSkeleton, Skeleton } from "./components/common/Skeleton";

// Shown on a hard reload, before we know whether there's a session at all.
// Mirrors the real header + first section of each dashboard so the page
// goes straight from "nothing painted yet" to something that already looks
// like the destination — instead of a blank white screen with a spinner
// that then gets replaced by the actual skeleton a moment later.
function StudentDashboardSkeletonShell() {
  return (
    <div className="min-h-screen bg-paper-50 pb-20">
      <header className="sticky top-0 z-30 border-b border-ink-900/8 bg-paper-50/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <span className="font-display text-lg font-semibold text-ink-950">Coursewell</span>
          <div className="h-9 w-9 animate-pulse rounded-full bg-gray-300" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-6">
          <StatCardsSkeleton />
        </div>
        <section className="mt-8">
          <Skeleton className="mb-3 h-3 w-32" />
          <UpcomingCoursesSkeleton />
        </section>
      </main>
    </div>
  );
}

function AdminPanelSkeletonShell() {
  return (
    <div className="min-h-screen bg-paper-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-900/8 bg-white px-5 py-3">
        <span className="font-display text-lg font-semibold text-ink-950">Coursewell Admin</span>
        <div className="h-8 w-8 animate-pulse rounded-full bg-gray-300" />
      </header>
      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <nav className="flex gap-1 overflow-x-auto border-b border-ink-900/8 bg-white px-3 py-2 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full shrink-0 rounded-lg md:mb-1" />
          ))}
        </nav>
        <main className="flex-1 px-5 py-6 md:px-8 md:py-8">
          <Skeleton className="h-6 w-32" />
          <div className="mt-5">
            <StatCardsSkeleton count={6} />
          </div>
          <Skeleton className="mt-8 h-5 w-56" />
          <div className="mt-3">
            <ListRowsSkeleton />
          </div>
        </main>
      </div>
    </div>
  );
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
