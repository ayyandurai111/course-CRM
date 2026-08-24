/**
 * Creates/updates a dedicated non-admin test student and gives it a
 * lifetime "[TEST] All Access" plan containing every current course.
 *
 * This is shared logic used by scripts/seedTestAccount.js and
 * scripts/seedTestStudentAccount.js — the two differ only in which
 * env-var prefix they read credentials from, so two *separate* test
 * accounts can exist side by side without colliding.
 *
 * IMPORTANT: This is intentionally a demo/testing account. If its
 * credentials are exposed in the frontend build, anyone who has them can
 * sign in. Keep it disabled in production unless that is acceptable.
 */
const { supabase } = require("../../src/lib/supabase");

const TEST_PLAN_NAME = "[TEST] All Access";

async function findAuthUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === targetEmail);
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

/**
 * @param {{ email: string, password: string, name: string, label: string }} opts
 *   label is just used in log output (e.g. "Test student account").
 */
async function seedTestStudent({ email, password, name, label }) {
  const normalizedEmail = (email || "").trim().toLowerCase();

  if (!normalizedEmail || !password) {
    throw new Error(`${label}: email and password are required.`);
  }
  if (password.length < 8) {
    throw new Error(`${label}: password must be at least 8 characters.`);
  }

  let authUser = await findAuthUserByEmail(normalizedEmail);
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: { ...(authUser.user_metadata || {}), full_name: name },
    });
    if (error) throw error;
    authUser = data.user;
  }

  // Always force role back to STUDENT here — this account must never be
  // an admin, even if SEED_ADMIN_EMAIL was ever misconfigured to match
  // it, or someone manually promoted it in the past.
  const { error: userError } = await supabase.from("users").upsert({
    id: authUser.id,
    email: normalizedEmail,
    name,
    avatar_url: authUser.user_metadata?.avatar_url || null,
    role: "STUDENT",
    is_active: true,
    pending_deletion: false,
  });
  if (userError) throw userError;

  const { data: courses, error: coursesError } = await supabase.from("courses").select("id");
  if (coursesError) throw coursesError;
  const courseIds = (courses || []).map((course) => course.id);

  let { data: plan, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("name", TEST_PLAN_NAME)
    .limit(1)
    .maybeSingle();
  if (planError) throw planError;

  const planData = {
    name: TEST_PLAN_NAME,
    price_cents: 0,
    currency: "INR",
    billing_period: "ONE_TIME",
    description: "Testing only — unlocks every current course.",
    features: ["All current courses", "Lifetime test access"],
    is_popular: false,
    is_active: true,
    sort_order: -999,
    course_ids: courseIds,
    updated_at: new Date().toISOString(),
  };

  if (!plan) {
    const { data, error } = await supabase.from("plans").insert(planData).select("*").single();
    if (error) throw error;
    plan = data;
  } else {
    const { data, error } = await supabase.from("plans").update(planData).eq("id", plan.id).select("*").single();
    if (error) throw error;
    plan = data;
  }

  const { data: subscription, error: subError } = await supabase.rpc("assign_subscription", {
    p_student_id: authUser.id,
    p_plan_id: plan.id,
    p_expires_at: null,
  });
  if (subError) throw subError;

  console.log(`${label} ready: ${normalizedEmail}`);
  console.log(`Plan: ${TEST_PLAN_NAME} (${courseIds.length} course(s), lifetime)`);
  console.log(`Subscription: ${subscription}`);
}

module.exports = { seedTestStudent };
