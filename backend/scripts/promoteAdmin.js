/**
 * Manual admin-promotion tool: promotes an existing Supabase-authenticated
 * user to ADMIN. Run this after that person has signed in at least once
 * (via Google) so their `users` profile row already exists.
 *
 * For creating the *first* admin, prefer POST /api/auth/bootstrap-admin
 * instead (see bootstrap_first_admin() in supabase/schema.sql) — it's
 * gated by ADMIN_BOOTSTRAP_TOKEN and self-disables once any admin
 * exists. This script remains useful afterwards for promoting
 * additional admins, since bootstrap_first_admin() only ever works once.
 *
 * Usage:
 *   node scripts/promoteAdmin.js someone@example.com
 */
require("dotenv").config();
const { supabase } = require("../../shared/backend-core/supabase");

async function findAuthUserByEmail(email) {
  // supabase-js's admin API doesn't expose a direct getUserByEmail, so
  // we page through auth.users and match — fine for an occasional
  // bootstrap script. For large user bases, query auth.users directly
  // via the SQL editor / Postgres connection instead.
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function main() {
  const email = process.argv[2] || process.env.SEED_ADMIN_EMAIL;
  if (!email) {
    console.error("Usage: node scripts/promoteAdmin.js someone@example.com");
    process.exit(1);
  }

  const authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    console.error(`No Supabase Auth user found for ${email}. Ask them to sign in at least once first.`);
    process.exit(1);
  }

  const { data: existing } = await supabase.from("users").select("id").eq("id", authUser.id).maybeSingle();

  if (!existing) {
    const meta = authUser.user_metadata || {};
    const { error } = await supabase.from("users").insert({
      id: authUser.id,
      email,
      name: meta.full_name || meta.name || email.split("@")[0],
      avatar_url: meta.avatar_url || meta.picture || null,
      role: "ADMIN",
      is_active: true,
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.from("users").update({ role: "ADMIN" }).eq("id", authUser.id);
    if (error) throw error;
  }

  console.log(`${email} is now an ADMIN. They may need to log out and back in for the role to take effect.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
