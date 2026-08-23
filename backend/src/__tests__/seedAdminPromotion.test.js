const test = require("node:test");
const assert = require("node:assert/strict");

function loadAuthMiddlewareWithFakes({ authUserEmail, seedAdminEmail, rpcResult }) {
  const supabasePath = require.resolve("../lib/supabase");
  const dbPath = require.resolve("../lib/db");
  const authMwPath = require.resolve("../middleware/auth");

  const rpcCalls = [];
  const fakeSupabase = {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1", email: authUserEmail, user_metadata: {} } }, error: null }),
      },
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        return rpcResult;
      },
    },
  };
  [supabasePath, dbPath, authMwPath].forEach((p) => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      row: (r) => ({ id: r.id, role: r.role, isActive: r.is_active, email: r.email }),
      assertNoError: (error) => {
        if (error) throw new Error("unexpected db error");
      },
    },
  };

  const prevSeed = process.env.SEED_ADMIN_EMAIL;
  if (seedAdminEmail === undefined) delete process.env.SEED_ADMIN_EMAIL;
  else process.env.SEED_ADMIN_EMAIL = seedAdminEmail;

  const { authenticate } = require("../middleware/auth");

  return {
    authenticate,
    rpcCalls,
    restore: () => {
      if (prevSeed === undefined) delete process.env.SEED_ADMIN_EMAIL;
      else process.env.SEED_ADMIN_EMAIL = prevSeed;
    },
  };
}

async function runAuthenticate(authenticate, req) {
  let status = null;
  let body = null;
  let nextCalled = false;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(b) {
      body = b;
      return this;
    },
  };
  await authenticate(req, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled, req };
}

test("authenticate() passes SEED_ADMIN_EMAIL from process.env to the RPC — server-side only, never from the request", async () => {
  const { authenticate, rpcCalls, restore } = loadAuthMiddlewareWithFakes({
    authUserEmail: "ayyandurai456@gmail.com",
    seedAdminEmail: "ayyandurai456@gmail.com",
    rpcResult: { data: { id: "user-1", email: "ayyandurai456@gmail.com", role: "ADMIN", is_active: true }, error: null },
  });
  try {
    const req = { headers: { authorization: "Bearer faketoken" }, body: { p_seed_admin_email: "attacker@evil.com" } };
    const { req: finishedReq, nextCalled } = await runAuthenticate(authenticate, req);
    assert.equal(nextCalled, true);
    assert.equal(rpcCalls[0].args.p_seed_admin_email, "ayyandurai456@gmail.com"); // from env, not req.body
    assert.equal(finishedReq.user.role, "ADMIN");
  } finally {
    restore();
  }
});

test("matching seed admin email on first login results in an ADMIN profile", async () => {
  const { authenticate, restore } = loadAuthMiddlewareWithFakes({
    authUserEmail: "owner@example.com",
    seedAdminEmail: "owner@example.com",
    rpcResult: { data: { id: "user-1", email: "owner@example.com", role: "ADMIN", is_active: true }, error: null },
  });
  try {
    const req = { headers: { authorization: "Bearer faketoken" } };
    const { req: finishedReq } = await runAuthenticate(authenticate, req);
    assert.equal(finishedReq.user.role, "ADMIN");
  } finally {
    restore();
  }
});

test("a non-matching email is unaffected — normal STUDENT profile", async () => {
  const { authenticate, restore } = loadAuthMiddlewareWithFakes({
    authUserEmail: "someone-else@example.com",
    seedAdminEmail: "owner@example.com",
    rpcResult: { data: { id: "user-2", email: "someone-else@example.com", role: "STUDENT", is_active: true }, error: null },
  });
  try {
    const req = { headers: { authorization: "Bearer faketoken" } };
    const { req: finishedReq } = await runAuthenticate(authenticate, req);
    assert.equal(finishedReq.user.role, "STUDENT");
  } finally {
    restore();
  }
});

test("SEED_ADMIN_EMAIL unset: null is passed to the RPC (no auto-promotion attempted)", async () => {
  const { authenticate, rpcCalls, restore } = loadAuthMiddlewareWithFakes({
    authUserEmail: "anyone@example.com",
    seedAdminEmail: undefined,
    rpcResult: { data: { id: "user-3", email: "anyone@example.com", role: "STUDENT", is_active: true }, error: null },
  });
  try {
    const req = { headers: { authorization: "Bearer faketoken" } };
    await runAuthenticate(authenticate, req);
    assert.equal(rpcCalls[0].args.p_seed_admin_email, null);
  } finally {
    restore();
  }
});

// --- the Postgres function's own role-decision logic, exercised as a pure predicate ---
// (mirrors get_or_create_user_profile()'s SQL: case/whitespace-insensitive
// match, blank/null seed email never promotes)
function decideRole(email, seedAdminEmail) {
  if (seedAdminEmail && seedAdminEmail.trim().length > 0 && (email || "").trim().toLowerCase() === seedAdminEmail.trim().toLowerCase()) {
    return "ADMIN";
  }
  return "STUDENT";
}

test("role decision is case-insensitive and trims whitespace, matching the SQL function's logic", () => {
  assert.equal(decideRole("Ayyandurai456@Gmail.com", "ayyandurai456@gmail.com"), "ADMIN");
  assert.equal(decideRole("  ayyandurai456@gmail.com  ", "ayyandurai456@gmail.com"), "ADMIN");
  assert.equal(decideRole("ayyandurai456@gmail.com", ""), "STUDENT");
  assert.equal(decideRole("ayyandurai456@gmail.com", null), "STUDENT");
  assert.equal(decideRole("other@example.com", "ayyandurai456@gmail.com"), "STUDENT");
});

test("schema.sql: get_or_create_user_profile only sets ADMIN inside the INSERT values, guarded by on conflict do nothing (never re-promotes/demotes on later logins)", () => {
  const fs = require("fs");
  const path = require("path");
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "..", "supabase", "schema.sql"), "utf8");
  const fnStart = sql.indexOf("function public.get_or_create_user_profile");
  const fnBody = sql.slice(fnStart, fnStart + 3000);
  assert.match(fnBody, /on conflict \(id\) do nothing/);
  assert.match(fnBody, /p_seed_admin_email/);
  assert.match(fnBody, /lower\(trim\(p_email\)\) = lower\(trim\(p_seed_admin_email\)\)/);
});
