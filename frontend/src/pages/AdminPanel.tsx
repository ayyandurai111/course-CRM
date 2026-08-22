import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AdminSidebar, { AdminSection } from "../components/admin/AdminSidebar";
import OverviewSection from "../components/admin/OverviewSection";
import CoursesSection from "../components/admin/CoursesSection";
import ContentSection from "../components/admin/ContentSection";
import StudentsSection from "../components/admin/StudentsSection";
import PlansSection from "../components/admin/PlansSection";
import SiteContentSection from "../components/admin/SiteContentSection";

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState<AdminSection>("overview");

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-paper-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-900/8 bg-white px-5 py-3">
        <span className="font-display text-lg font-semibold text-ink-950">Coursewell Admin</span>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-ink-500 sm:inline">{user?.email}</span>
          <button onClick={handleLogout} className="rounded-full border border-ink-900/15 px-3.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100">
            Log out
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <AdminSidebar active={section} onChange={setSection} />
        <main className="flex-1 px-5 py-6 md:px-8 md:py-8">
          {section === "overview" && <OverviewSection />}
          {section === "courses" && <CoursesSection />}
          {section === "content" && <ContentSection />}
          {section === "students" && <StudentsSection />}
          {section === "plans" && <PlansSection />}
          {section === "site" && <SiteContentSection />}
        </main>
      </div>
    </div>
  );
}
