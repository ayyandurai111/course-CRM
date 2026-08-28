import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AdminSidebar, { AdminSection } from "../components/admin/AdminSidebar";
import OverviewSection from "../components/admin/OverviewSection";
import CoursesSection from "../components/admin/CoursesSection";
import ContentSection from "../components/admin/ContentSection";
import StudentsSection from "../components/admin/StudentsSection";
import PlansSection from "../components/admin/PlansSection";
import SiteContentSection from "../components/admin/SiteContentSection";
import MeetingsSection from "../components/admin/MeetingsSection";

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState<AdminSection>("overview");
  // Each section fetches its own data on mount. Rendering only the active
  // section (`section === "x" && <XSection />`) would unmount the others,
  // throwing away what they'd already loaded — so switching back to a
  // previously-visited tab always re-showed a skeleton and re-fetched from
  // scratch. Instead, once a section has been visited it stays mounted
  // (just hidden) so its state survives tab switches; sections never
  // visited still aren't mounted, so we don't fetch data the user hasn't
  // asked to see.
  const [visited, setVisited] = useState<Set<AdminSection>>(() => new Set(["overview"]));

  useEffect(() => {
    setVisited((prev) => (prev.has(section) ? prev : new Set(prev).add(section)));
  }, [section]);

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-paper-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-900/8 bg-white px-5 py-3">
        <span className="min-w-0 truncate font-display text-lg font-semibold text-ink-950">Coursewell Admin</span>
        <div className="flex items-center gap-4">
          <span className="hidden max-w-[18rem] truncate text-sm text-ink-500 sm:inline">{user?.email}</span>
          <button onClick={handleLogout} className="rounded-full border border-ink-900/15 px-3.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100">
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <AdminSidebar active={section} onChange={setSection} />
        <main className="flex-1 px-5 py-6 md:px-8 md:py-8">
          {visited.has("overview") && <div hidden={section !== "overview"}><OverviewSection /></div>}
          {visited.has("courses") && <div hidden={section !== "courses"}><CoursesSection /></div>}
          {visited.has("content") && <div hidden={section !== "content"}><ContentSection /></div>}
          {visited.has("students") && <div hidden={section !== "students"}><StudentsSection /></div>}
          {visited.has("meetings") && <div hidden={section !== "meetings"}><MeetingsSection /></div>}
          {visited.has("plans") && <div hidden={section !== "plans"}><PlansSection /></div>}
          {visited.has("site") && <div hidden={section !== "site"}><SiteContentSection /></div>}
        </main>
      </div>
    </div>
  );
}
