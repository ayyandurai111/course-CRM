const test = require("node:test");
const assert = require("node:assert/strict");

function loadServiceWithFakes({ updateResult = { error: null }, authDeleteResult, pendingUsers = [] }) {
  const dbPath = require.resolve("../lib/db");
  const authAdminPath = require.resolve("../lib/authAdmin");
  const servicePath = require.resolve("../services/userDeletionService");

  const updateCalls = [];
  const authDeleteCalls = [];

  const fakeDb = {
    supabase: {
      from(table) {
        assert.equal(table, "users");
        return {
          update(patch) {
            return {
              eq(_col, id) {
                updateCalls.push({ id, patch });
                return Promise.resolve(updateResult);
              },
            };
          },
          select() {
            return this;
          },
          eq(_col, val) {
            this._pendingFilter = val;
            return this;
          },
          limit() {
            return Promise.resolve({ data: pendingUsers, error: null });
          },
        };
      },
    },
    row: (r) => r,
    rows: (data) => data || [],
    assertNoError: (error) => {
      if (error) throw new Error("unexpected db error");
    },
  };

  const fakeAuthAdmin = {
    deleteAuthUserSafely: async (userId) => {
      authDeleteCalls.push(userId);
      return typeof authDeleteResult === "function" ? authDeleteResult(userId) : authDeleteResult;
    },
  };

  [dbPath, authAdminPath, servicePath].forEach((p) => delete require.cache[p]);
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
  require.cache[authAdminPath] = { id: authAdminPath, filename: authAdminPath, loaded: true, exports: fakeAuthAdmin };

  const service = require("../services/userDeletionService");
  return { service, updateCalls, authDeleteCalls };
}

// --- beginStudentDeletion ordering ---

test("successful deletion: profile is marked inactive/pending BEFORE Auth deletion is attempted, then Auth succeeds", async () => {
  const { service, updateCalls, authDeleteCalls } = loadServiceWithFakes({
    authDeleteResult: { ok: true },
  });
  const result = await service.beginStudentDeletion("user-1");

  assert.equal(result.immediatelyDeleted, true);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0].patch, { is_active: false, pending_deletion: true });
  assert.equal(updateCalls[0].id, "user-1");
  assert.deepEqual(authDeleteCalls, ["user-1"]);
});

test("Auth deletion failure: profile stays marked pending — is NOT hard-deleted, is NOT reactivated", async () => {
  const { service, updateCalls } = loadServiceWithFakes({
    authDeleteResult: { ok: false, error: new Error("Auth service unavailable") },
  });
  const result = await service.beginStudentDeletion("user-2");

  assert.equal(result.immediatelyDeleted, false);
  // The only DB write is the initial mark — no compensating delete or
  // rollback that would un-mark is_active/pending_deletion.
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].patch.is_active, false);
  assert.equal(updateCalls[0].patch.pending_deletion, true);
});

test("the DB row is marked inactive/pending even before we know whether Auth deletion will succeed (access cut off either way)", async () => {
  // Regression guard for the original bug's root cause: the fix must
  // not reorder back to "delete DB row, then Auth" — it must never
  // hard-delete the row from application code at all (cascade does it).
  let markedBeforeAuthCall = false;
  const dbPath = require.resolve("../lib/db");
  const authAdminPath = require.resolve("../lib/authAdmin");
  const servicePath = require.resolve("../services/userDeletionService");
  [dbPath, authAdminPath, servicePath].forEach((p) => delete require.cache[p]);
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      supabase: {
        from: () => ({
          update: (patch) => ({
            eq: () => {
              assert.deepEqual(patch, { is_active: false, pending_deletion: true });
              markedBeforeAuthCall = true;
              return Promise.resolve({ error: null });
            },
          }),
        }),
      },
      row: (r) => r,
      rows: (d) => d || [],
      assertNoError: () => {},
    },
  };
  require.cache[authAdminPath] = {
    id: authAdminPath,
    filename: authAdminPath,
    loaded: true,
    exports: {
      deleteAuthUserSafely: async () => {
        assert.equal(markedBeforeAuthCall, true, "DB row must be marked before Auth deletion is attempted");
        return { ok: true };
      },
    },
  };
  const service = require("../services/userDeletionService");
  await service.beginStudentDeletion("user-3");
  assert.equal(markedBeforeAuthCall, true);
});

// --- retry ---

test("retry: a pending user whose Auth deletion now succeeds is counted as deleted (cascade handles the row)", async () => {
  const { service } = loadServiceWithFakes({
    pendingUsers: [{ id: "user-4", pendingDeletion: true, isActive: false }],
    authDeleteResult: { ok: true },
  });
  const summary = await service.retryPendingUserDeletions();
  assert.equal(summary.scanned, 1);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.stillPending, 0);
});

test("retry: a pending user whose Auth deletion still fails remains pending for the next run", async () => {
  const { service } = loadServiceWithFakes({
    pendingUsers: [{ id: "user-5", pendingDeletion: true, isActive: false }],
    authDeleteResult: { ok: false, error: new Error("still down") },
  });
  const summary = await service.retryPendingUserDeletions();
  assert.equal(summary.deleted, 0);
  assert.equal(summary.stillPending, 1);
});

test("retry: no pending users is a safe no-op", async () => {
  const { service, authDeleteCalls } = loadServiceWithFakes({ pendingUsers: [] });
  const summary = await service.retryPendingUserDeletions();
  assert.deepEqual(summary, { scanned: 0, deleted: 0, stillPending: 0 });
  assert.equal(authDeleteCalls.length, 0);
});

// --- authAdmin idempotency ---

test("deleteAuthUserSafely treats a 'not found' Auth error as success (idempotent retry)", async () => {
  const supabasePath = require.resolve("../lib/supabase");
  const authAdminPath = require.resolve("../lib/authAdmin");
  [supabasePath, authAdminPath].forEach((p) => delete require.cache[p]);
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      supabase: { auth: { admin: { deleteUser: async () => ({ error: { status: 404, message: "User not found" } }) } } },
    },
  };
  const { deleteAuthUserSafely } = require("../lib/authAdmin");
  const result = await deleteAuthUserSafely("gone-user");
  assert.equal(result.ok, true);
});

test("deleteAuthUserSafely reports a real failure (not 'not found') so it can be retried", async () => {
  const supabasePath = require.resolve("../lib/supabase");
  const authAdminPath = require.resolve("../lib/authAdmin");
  [supabasePath, authAdminPath].forEach((p) => delete require.cache[p]);
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      supabase: { auth: { admin: { deleteUser: async () => ({ error: { status: 503, message: "Service unavailable" } }) } } },
    },
  };
  const { deleteAuthUserSafely } = require("../lib/authAdmin");
  const result = await deleteAuthUserSafely("some-user");
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

// --- login/access after a pending or failed deletion ---

test("authenticate(): a user marked pending_deletion (is_active=false) is rejected even though their Auth session is still valid", async () => {
  const supabasePath = require.resolve("../lib/supabase");
  const dbPath = require.resolve("../lib/db");
  const authMwPath = require.resolve("../middleware/auth");
  [supabasePath, dbPath, authMwPath].forEach((p) => delete require.cache[p]);

  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      supabase: {
        auth: { getUser: async () => ({ data: { user: { id: "user-6", email: "a@b.com", user_metadata: {} } }, error: null }) },
        rpc: async () => ({
          // Simulates get_or_create_user_profile() returning the
          // EXISTING row (on conflict do nothing) — still inactive and
          // pending deletion, never a freshly-recreated STUDENT.
          data: { id: "user-6", email: "a@b.com", role: "STUDENT", is_active: false, pending_deletion: true },
          error: null,
        }),
      },
    },
  };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { row: (r) => ({ isActive: r.is_active, role: r.role, id: r.id }), assertNoError: () => {} },
  };

  const { authenticate } = require("../middleware/auth");
  let statusCode = null;
  let jsonBody = null;
  const req = { headers: { authorization: "Bearer faketoken" } };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };
  let nextCalled = false;
  await authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false, "request must not proceed to the route handler");
  assert.equal(statusCode, 401);
  assert.match(jsonBody.error, /suspended/i);
});

