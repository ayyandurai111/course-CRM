import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/apiClient";

function friendlyAuthError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  const message = (err as { message?: string })?.message || "";
  if (/network/i.test(message)) return "Network error — check your connection and try again.";
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const { user, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Supabase's Google sign-in is a full-page redirect (there's no
  // popup), so we can't get the signed-in user back synchronously from
  // handleGoogle(). Instead, redirect once the session lands back here
  // and AuthContext has resolved the profile.
  useEffect(() => {
    if (user) navigate(user.role === "ADMIN" ? "/admin" : "/dashboard", { replace: true });
  }, [user, navigate]);

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
      // Browser is navigating to Google now; this component unmounts.
    } catch (err) {
      setError(friendlyAuthError(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-50 px-5">
      <div className="w-full max-w-sm text-center">
        <Link to="/" className="mb-8 block font-display text-lg font-semibold text-ink-950">
          Coursewell
        </Link>

        <div className="rounded-xl2 border border-ink-900/8 bg-white p-8 shadow-card">
          <h1 className="font-display text-xl font-semibold text-ink-950">Welcome</h1>
          <p className="mt-1.5 text-sm text-ink-500">Sign in with your Google account to continue.</p>

          <button
            onClick={handleGoogle}
            disabled={submitting}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-full border border-ink-900/15 bg-white py-3 text-sm font-semibold text-ink-900 transition hover:border-ink-900/30 disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
              <path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 010-3.42V4.95H.96a9 9 0 000 8.1l3-2.34z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.95l3 2.34C4.67 5.16 6.66 3.58 9 3.58z" />
            </svg>
            {submitting ? "Signing in…" : "Continue with Google"}
          </button>

          {error && <p className="mt-4 text-sm font-medium text-red-600">{error}</p>}

          <p className="mt-6 text-xs text-ink-300">
            By continuing you agree to Coursewell's Terms and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
