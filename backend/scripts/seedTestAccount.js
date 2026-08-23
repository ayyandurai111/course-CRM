/**
 * Creates/updates a dedicated non-admin test student and gives it a
 * lifetime "[TEST] All Access" plan containing every current course.
 *
 * IMPORTANT: This is intentionally a demo/testing account. If its
 * credentials are exposed in the frontend build, anyone who has them can
 * sign in. Keep it disabled in production unless that is acceptable.
 *
 * Usage:
 *   TEST_ACCOUNT_EMAIL=test@example.com TEST_ACCOUNT_PASSWORD='...' \
 *   node scripts/seedTestAccount.js
 */
require("dotenv").config();
const { supabase } = require("../src/lib/supabase");

const email = (process.env.TEST_ACCOUNT_EMAIL || "").trim().toLowerCase();
const password = process.env.TEST_ACCOUNT_PASSWORD || "";
const name = process.env.TEST_ACCOUNT_NAME || "Test Student";
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

async function main() {
  if (!email || !password) {
    throw new Error("TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD are required.");
  }
  if (password.length < 8) {
    throw new Error("TEST_ACCOUNT_PASSWORD must be at least 8 characters.");
  }

  let authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
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

  const { error: userError } = await supabase.from("users").upsert({
    id: authUser.id,
    email,
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

  console.log(`Test account ready: ${email}`);
  console.log(`Plan: ${TEST_PLAN_NAME} (${courseIds.length} course(s), lifetime)`);
  console.log(`Subscription: ${subscription}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
