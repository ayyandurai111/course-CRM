import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "../lib/supabaseClient";
import { apiRequest } from "../lib/apiClient";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /**
   * Starts the Google OAuth flow. Unlike the old Firebase popup flow,
   * Supabase Auth's signInWithOAuth() navigates the whole page to
   * Google and back — there's no user to return synchronously. The
   * browser leaves this page immediately, so callers should not expect
   * this promise to resolve with a signed-in user; watch `user` from
   * this context instead (see LoginPage.tsx).
   */
  loginWithGoogle: () => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const data = await apiRequest<{ user: User }>("/auth/me");
        if (!cancelled) setUser(data.user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // Supabase persists the session itself (localStorage), so on every
    // page load getSession() resolves once with the restored session
    // (or null) — that's the entire "am I logged in" check. After that,
    // onAuthStateChange fires on every subsequent sign-in/sign-out
    // (including the redirect back from Google OAuth).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) loadProfile();
      else setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setUser(null);
        setLoading(false);
        return;
      }
      if (event === "SIGNED_IN") {
        // /auth/sync captures the freshest name/photo from the Google
        // account on this login, then returns the up-to-date profile.
        setLoading(true);
        apiRequest<{ user: User }>("/auth/sync", { method: "POST" })
          .then((data) => !cancelled && setUser(data.user))
          .catch(() => !cancelled && setUser(null))
          .finally(() => !cancelled && setLoading(false));
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  async function loginWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/login" },
    });
    if (error) throw error;
    // The browser navigates to Google now; nothing else runs here.
  }

  async function loginWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, loginWithPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
