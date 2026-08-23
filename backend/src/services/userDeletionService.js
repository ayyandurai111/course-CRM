const { supabase, row, rows, assertNoError } = require("../lib/db");
const { deleteAuthUserSafely } = require("../lib/authAdmin");

const DEFAULT_RETRY_BATCH_SIZE = 200;

/**
 * Begins deletion of a student account (spec fix — "deleted user
 * recreation"). Fixes the ordering bug where the DB profile was deleted
 * BEFORE the Supabase Auth account: if the Auth deletion then failed,
 * the Auth account could still log in, and get_or_create_user_profile()
 * would silently recreate a fresh STUDENT profile for it on next login
 * — effectively undeleting the account.
 *
 * New order:
 *   1. Mark the DB row `is_active = false, pending_deletion = true`
 *      FIRST. This alone is enough to block all access immediately —
 *      middleware/auth.js already rejects any request where
 *      is_active is false — regardless of what happens next.
 *   2. Attempt to delete the Supabase Auth account.
 *   3a. If it succeeds, Postgres's own `on delete cascade` (public.users
 *       references auth.users) removes the profile row — and every
 *       subscription/content_progress row via further cascades —
 *       automatically. No separate DB delete call is needed or made.
 *   3b. If it fails, the row stays exactly as marked in step 1: present,
 *       inactive, pending_deletion. It is retried by
 *       retryPendingUserDeletions() (see jobs/userDeletionRetryJob.js)
 *       until it eventually succeeds. The account can never regain
 *       access in the meantime, and — critically — can never be
 *       recreated, because the profile row still exists (so
 *       get_or_create_user_profile()'s `on conflict do nothing` just
 *       returns the existing, inactive row rather than inserting a new
 *       STUDENT one).
 *
 * Returns `{ immediatelyDeleted: boolean }`.
 */
async function beginStudentDeletion(userId) {
  const { error: markError } = await supabase
    .from("users")
    .update({ is_active: false, pending_deletion: true })
    .eq("id", userId);
  assertNoError(markError, "Failed to mark student for deletion");

  const authResult = await deleteAuthUserSafely(userId);
  if (!authResult.ok) {
    console.error(`Failed to delete Supabase Auth user ${userId} (will retry):`, authResult.error);
    return { immediatelyDeleted: false };
  }
  return { immediatelyDeleted: true };
}

/**
 * Retries the Auth-side deletion for every user still marked
 * pending_deletion (Auth deletion failed at request time — e.g. a
 * transient Supabase Auth outage). Safe to run repeatedly/concurrently:
 * deleteAuthUserSafely is idempotent, and a row that succeeds simply
 * disappears via cascade (so it won't be selected again next run).
 */
async function retryPendingUserDeletions({ batchSize = DEFAULT_RETRY_BATCH_SIZE } = {}) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("pending_deletion", true)
    .limit(batchSize);
  assertNoError(error, "Failed to load pending user deletions");

  const users = rows(data);
  const summary = { scanned: users.length, deleted: 0, stillPending: 0 };

  for (const user of users) {
    const result = await deleteAuthUserSafely(user.id);
    if (result.ok) {
      summary.deleted += 1;
      // No explicit DB delete here either — the `on delete cascade` FK
      // does it. If, for some reason, the auth.users row was already
      // gone but this profile row was somehow never cascaded (should
      // not happen under normal Supabase operation), this is left for
      // manual investigation rather than force-deleted here, since a
      // silent forced delete is exactly the failure mode this fix
      // exists to prevent.
    } else {
      summary.stillPending += 1;
    }
  }

  return summary;
}

module.exports = { beginStudentDeletion, retryPendingUserDeletions };
