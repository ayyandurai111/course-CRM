const { supabase } = require("../../../shared/backend-core/supabase");

/**
 * Best-effort, idempotent Supabase Auth user deletion. Mirrors
 * lib/storage.js's deleteFileSafely: never throws, and treats "the
 * user is already gone" as success rather than failure, so retrying
 * this after a previous partial success is always safe.
 *
 * IMPORTANT (spec fix — deleted-user recreation): this must be called
 * with the DB profile row's `is_active`/`pending_deletion` already set
 * (see students.routes.js), never the other way around. If this Auth
 * deletion fails, the profile row staying present with is_active=false
 * is what keeps the account from ever regaining access or being
 * silently recreated — see the users table comment in schema.sql for
 * the full reasoning (the `on delete cascade` FK from public.users to
 * auth.users is what removes the profile row automatically once this
 * actually succeeds).
 */
async function deleteAuthUserSafely(userId) {
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      // GoTrue returns a 404-style error for an id that no longer
      // exists in auth.users — that's the desired end state, not a
      // failure to report/retry.
      const status = error.status || error.code;
      const alreadyGone = status === 404 || /not.?found/i.test(error.message || "");
      if (alreadyGone) return { ok: true };
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

module.exports = { deleteAuthUserSafely };
