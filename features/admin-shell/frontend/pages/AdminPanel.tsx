import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/frontend/context/AuthContext";
import { ChevronDownIcon } from "../../../../shared/frontend-core/components/common/Icons";
import AdminSidebar, { AdminSection } from "../components/AdminSidebar";
import OverviewSection from "../components/OverviewSection";
import CoursesSection from "../../../courses/frontend/components/CoursesSection";
import ContentSection from "../../../content/frontend/components/ContentSection";
import QuizzesSection from "../../../quiz/frontend/components/QuizzesSection";
import StudentsSection from "../../../students/frontend/components/StudentsSection";
import PlansSection from "../../../plans-subscription/frontend/components/PlansSection";
import SiteContentSection from "../../../site-content-cms/frontend/components/SiteContentSection";
import MeetingsSection from "../../../meetings/frontend/components/MeetingsSection";

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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setVisited((prev) => (prev.has(section) ? prev : new Set(prev).add(section)));
  }, [section]);

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-paper-50">
      {/* Matches the student dashboard header: sticky, translucent/blur,
          brand mark on the left, avatar-triggered dropdown (name, email,
          log out) on the right — so the two "main screens" read as one
          consistent app instead of two different header styles. */}
      <header className="sticky top-0 z-30 border-b border-ink-900/8 bg-paper-50/90 backdrop-blur-md">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="min-w-0 truncate font-display text-lg font-semibold text-ink-950">Coursewell Admin</span>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 hover:bg-ink-100"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 font-display text-sm font-semibold text-paper-50">
                {user?.name?.[0]?.toUpperCase() || "?"}
              </span>
              <ChevronDownIcon className={`h-4 w-4 text-ink-500 transition ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl2 border border-ink-900/8 bg-white shadow-card"
              >
                <div className="border-b border-ink-900/8 px-4 py-3">
                  <p className="truncate text-sm font-medium text-ink-900">{user?.name}</p>
                  <p className="truncate text-xs text-ink-500">{user?.email}</p>
                </div>
                <button
                  role="menuitem"
                  onClick={handleLogout}
                  className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <AdminSidebar active={section} onChange={setSection} />
        <main className="flex-1 px-5 py-6 md:px-8 md:py-8">
          {visited.has("overview") && <div hidden={section !== "overview"}><OverviewSection /></div>}
          {visited.has("courses") && <div hidden={section !== "courses"}><CoursesSection /></div>}
          {visited.has("content") && <div hidden={section !== "content"}><ContentSection /></div>}
          {visited.has("quizzes") && <div hidden={section !== "quizzes"}><QuizzesSection /></div>}
          {visited.has("students") && <div hidden={section !== "students"}><StudentsSection /></div>}
          {visited.has("meetings") && <div hidden={section !== "meetings"}><MeetingsSection /></div>}
          {visited.has("plans") && <div hidden={section !== "plans"}><PlansSection /></div>}
          {visited.has("site") && <div hidden={section !== "site"}><SiteContentSection /></div>}
        </main>
      </div>
    </div>
  );
}
