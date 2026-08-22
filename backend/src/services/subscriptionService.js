// NOTE: supabase/db access is required lazily inside the functions below
// (not at module load time) so that isSubscriptionUsable — a pure,
// DB-independent function — can be unit-tested without a live Supabase
// client (see __tests__/subscriptionService.test.js).
function getDb() {
  return require("../lib/db");
}

/**
 * The single authoritative rule for "is this subscription usable right
 * now" (spec #7A). Every place in the app that needs to answer that
 * question — /api/me/plan, course access, content access, file access,
 * the student dashboard, admin subscription status — must call this
 * instead of re-implementing its own `status === 'ACTIVE'` check, so
 * they can never disagree with each other again.
 *
 * A null expires_at means "no expiry" (a lifetime/one-time plan — see
 * plans.billing_period 'ONE_TIME' in supabase/schema.sql), which is an
 * intentional, existing business rule, not a gap: it is NOT treated as
 * "already expired".
 */
function isSubscriptionUsable(sub) {
  if (!sub) return false;
  if (sub.status !== "ACTIVE") return false;
  if (sub.expiresAt && new Date(sub.expiresAt) <= new Date()) return false;
  return true;
}

/**
 * Loads the user's current subscription row (there can be at most one
 * ACTIVE row per user — enforced by subscriptions_one_active_per_user_idx
 * in supabase/schema.sql) and reports whether it's actually usable.
 * Spec #7D: an ACTIVE-but-expired row is deliberately NOT auto-flipped
 * to EXPIRED here — that would be a silent historical-record change the
 * spec explicitly warns against without confirming the business model —
 * it is simply reported as `usable: false` so every caller treats it
 * consistently as "no access" without touching the stored status.
 */
async function getCurrentSubscription(userId) {
  const { supabase, row, assertNoError } = getDb();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  assertNoError(error, "Failed to load subscription");

  const subscription = row(data);
  return { subscription, usable: isSubscriptionUsable(subscription) };
}

/**
 * Batched (spec #13) version for admin listings that need many users'
 * current subscriptions at once — one query instead of N.
 */
async function getCurrentSubscriptionsByUserIds(userIds) {
  const map = new Map();
  if (!userIds || userIds.length === 0) return map;

  const { supabase, rows, assertNoError } = getDb();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .in("user_id", userIds)
    .eq("status", "ACTIVE");
  assertNoError(error, "Failed to load subscriptions");

  for (const sub of rows(data)) {
    // subscriptions_one_active_per_user_idx guarantees at most one
    // ACTIVE row per user, so no de-duplication is needed here.
    map.set(sub.userId, { subscription: sub, usable: isSubscriptionUsable(sub) });
  }
  return map;
}

module.exports = { isSubscriptionUsable, getCurrentSubscription, getCurrentSubscriptionsByUserIds };
