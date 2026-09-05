import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ApiError, consumeSessionExpiredMessage } from "../../../../shared/frontend-core/lib/apiClient";
import Modal from "../../../../shared/frontend-core/components/modals/Modal";
import { brand } from "../../../../shared/frontend-core/theme/brand.config";

function friendlyAuthError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  const message = (err as { message?: string })?.message || "";
  if (/network/i.test(message)) return "Network error — check your connection and try again.";
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const { user, loginWithGoogle, loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testSubmitting, setTestSubmitting] = useState(false);
  const [testStudentSubmitting, setTestStudentSubmitting] = useState(false);

  // Supabase's Google sign-in is a full-page redirect (there's no
  // popup), so we can't get the signed-in user back synchronously from
  // handleGoogle(). Instead, redirect once the session lands back here
  // and AuthContext has resolved the profile.
  useEffect(() => {
    if (user) navigate(user.role === "ADMIN" ? "/admin" : "/dashboard", { replace: true });
  }, [user, navigate]);

  // Landed here because apiClient detected a dead session (forced
  // refresh failed too) and signed us out. Show that reason in a modal
  // — this is the "Session expired" step of the refresh flow: Dashboard
  // /Course/Admin all funnel through the same 401 -> forced refresh ->
  // signOut() -> redirect-to-login path, and this is where it surfaces.
  useEffect(() => {
    const msg = consumeSessionExpiredMessage();
    if (msg) setSessionExpiredMsg(msg);
  }, []);

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

  // The modal's own [Sign In] button just dismisses it — it reveals the
  // normal login card underneath, which already has Google (and, in dev,
  // test-account) sign-in options, rather than assuming Google is the
  // only path someone might want.
  function dismissSessionExpiredModal() {
    setSessionExpiredMsg(null);
  }

  async function handleTestAccount() {
    const email = import.meta.env.VITE_TEST_ACCOUNT_EMAIL;
    const password = import.meta.env.VITE_TEST_ACCOUNT_PASSWORD;
    if (!email || !password) {
      setError("Test account is not configured.");
      return;
    }

    setError(null);
    setTestSubmitting(true);
    try {
      await loginWithPassword(email, password);
    } catch (err) {
      setError(friendlyAuthError(err));
      setTestSubmitting(false);
    }
  }

  async function handleTestStudentAccount() {
    const email = import.meta.env.VITE_TEST_STUDENT_ACCOUNT_EMAIL;
    const password = import.meta.env.VITE_TEST_STUDENT_ACCOUNT_PASSWORD;
    if (!email || !password) {
      setError("Test student account is not configured.");
      return;
    }

    setError(null);
    setTestStudentSubmitting(true);
    try {
      await loginWithPassword(email, password);
    } catch (err) {
      setError(friendlyAuthError(err));
      setTestStudentSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-50 px-5">
      <div className="w-full max-w-sm text-center">
        <Link to="/" className="mb-8 block font-display text-lg font-semibold text-ink-950">
          {brand.name}
        </Link>

        <div className="rounded-xl2 border border-ink-900/8 bg-white p-8 shadow-card">
          <h1 className="font-display text-xl font-semibold text-ink-950">Welcome</h1>
          <p className="mt-1.5 text-sm text-ink-500">
            Sign in with Google to continue
            {import.meta.env.VITE_ENABLE_TEST_ACCOUNT === "true" || import.meta.env.VITE_ENABLE_TEST_STUDENT_ACCOUNT === "true"
              ? " or use a test account below."
              : "."}
          </p>

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

          {import.meta.env.VITE_ENABLE_TEST_ACCOUNT === "true" && (
            <button
              type="button"
              onClick={handleTestAccount}
              disabled={submitting || testSubmitting}
              className="mt-3 w-full rounded-full border border-amber-400/50 bg-amber-50 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
            >
              {testSubmitting ? "Signing in to test account…" : "Continue with Test Account"}
            </button>
          )}

          {import.meta.env.VITE_ENABLE_TEST_STUDENT_ACCOUNT === "true" && (
            <button
              type="button"
              onClick={handleTestStudentAccount}
              disabled={submitting || testStudentSubmitting}
              className="mt-3 w-full rounded-full border border-sky-400/50 bg-sky-50 py-3 text-sm font-semibold text-sky-800 transition hover:bg-sky-100 disabled:opacity-60"
            >
              {testStudentSubmitting ? "Signing in to test student account…" : "Continue with Test Student Account"}
            </button>
          )}

          {error && <p className="mt-4 text-sm font-medium text-red-600">{error}</p>}

          <p className="mt-6 text-xs text-ink-300">
            By continuing you agree to {brand.legalName}'s Terms and Privacy Policy.
          </p>
        </div>
      </div>

      {sessionExpiredMsg && (
        <Modal title="Session expired" onClose={dismissSessionExpiredModal} maxWidth="max-w-sm">
          <p className="text-sm text-ink-600">{sessionExpiredMsg}</p>
          <div className="mt-5 flex justify-end">
            <button
              onClick={dismissSessionExpiredModal}
              className="rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 transition hover:bg-ink-900"
            >
              Sign In
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
