import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import type { Subscription } from "../../types";

export default function DashboardHeader({ subscription: _subscription }: { subscription: Subscription | null }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-ink-900/8 bg-paper-50/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div>
          <span className="font-display text-lg font-semibold text-ink-950">Coursewell</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-950 font-display text-sm font-semibold text-paper-50"
            >
              {user?.name?.[0]?.toUpperCase() || "?"}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl2 border border-ink-900/8 bg-white shadow-card"
              >
                <div className="border-b border-ink-900/8 px-4 py-3">
                  <p className="truncate text-sm font-medium text-ink-900">{user?.name}</p>
                  <p className="truncate text-xs text-ink-500">{user?.email}</p>
                </div>
                <button
                  role="menuitem"
                  onClick={async () => {
                    await logout();
                    navigate("/", { replace: true });
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
