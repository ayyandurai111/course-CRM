const { supabase } = require("../../../shared/backend-core/supabase");
const { row, assertNoError } = require("../../../shared/backend-core/db");
const { isAllowedHttpsImageUrl } = require("../../../shared/backend-core/urlSecurity");

/**
 * Verifies the Supabase access token on the Authorization header (via
 * the service-role client's auth.getUser(), which validates the JWT
 * server-side), then loads the matching `users` profile row (role,
 * isActive, etc.) and attaches it to req.user. If this is the user's
 * first request (no profile row yet), a profile is created
 * automatically — this is what makes "sign in with Google" work with
 * zero separate registration step, same as the old Firebase version.
 *
 * Seed-admin auto-promotion: the new profile's role is decided entirely
 * server-side, inside get_or_create_user_profile() (see
 * supabase/schema.sql) — it's ADMIN if-and-only-if `authUser.email`
 * (the Google-OAuth-verified email Supabase itself just validated two
 * lines above, not anything from the request body) matches the
 * operator's SEED_ADMIN_EMAIL env var, otherwise STUDENT. The frontend
 * has no say in this at all: it never sees SEED_ADMIN_EMAIL, never
 * sends a role, and the decision is made and persisted by the Postgres
 * function before this middleware ever reads the row back. See that
 * function's doc comment for the full security rationale and the
 * "only fires on first login" guarantee.
 *
 * Spec #10: profile lookup-or-create goes through the
 * get_or_create_user_profile() Postgres function (see
 * supabase/schema.sql) instead of a SELECT-then-INSERT pair here. Two
 * simultaneous first-login requests for the same brand-new auth user
 * both call that function; its `on conflict (id) do nothing` makes
 * exactly one of them actually insert, and both read back the same
 * single row — no duplicate-profile race, and an existing user's
 * role/is_active can never be overwritten by a "first login" that
 * isn't actually first. The identity provider's verified authUser.id is
 * the only identifier ever used — never anything client-supplied.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const accessToken = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!accessToken) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    const authUser = authData.user;
    const meta = authUser.user_metadata || {};

    const { data: profile, error } = await supabase.rpc("get_or_create_user_profile", {
      p_user_id: authUser.id,
      p_email: authUser.email || "",
      p_name: meta.full_name || meta.name || authUser.email?.split("@")[0] || "New user",
      p_avatar_url: isAllowedHttpsImageUrl(meta.avatar_url) ? meta.avatar_url : (isAllowedHttpsImageUrl(meta.picture) ? meta.picture : null),
      // Server-only env var — never sent to or read from the frontend.
      // See doc comment above / get_or_create_user_profile()'s comment
      // in schema.sql for exactly how this is used.
      p_seed_admin_email: process.env.SEED_ADMIN_EMAIL || null,
    });
    assertNoError(error, "Failed to load or create user profile");
    if (!profile) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    const userData = row(Array.isArray(profile) ? profile[0] : profile);
    if (!userData.isActive) {
      return res.status(401).json({ error: "This account has been suspended." });
    }

    req.user = userData;
    next();
  } catch (err) {
    next(err);
  }
}

/** Blocks non-admins. Must run after authenticate(). */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
