const test = require("node:test");
const assert = require("node:assert/strict");
const { publishRecordingCore } = require("../routes/meetings.routes");
const { requireAdmin } = require("../middleware/auth");

function makeFakeSupabase(meetingsById) {
  return {
    from(table) {
      if (table !== "meetings") throw new Error(`unexpected table ${table}`);
      return {
        select() { return this; },
        eq(col, val) { this._id = val; return this; },
        async maybeSingle() {
          const found = meetingsById[this._id];
          return { data: found ? { ...found } : null, error: null };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------
// State machine: publishing must only ever be possible from a
// server-confirmed READY recording. A malicious or buggy client could
// call this endpoint at any point in a meeting's lifecycle (mid-live,
// right after scheduling, while still processing, after a failed
// recording, or twice in a row) — none of those should be able to
// publish arbitrary/incomplete/nonexistent content.
// ---------------------------------------------------------------------

test("publishRecordingCore: 404 when the meeting doesn't exist (no information leak about content ids either)", async () => {
  const deps = { supabase: makeFakeSupabase({}), publishNow: async () => { throw new Error("must not be called"); } };
  const result = await publishRecordingCore("does-not-exist", deps);
  assert.equal(result.status, 404);
});

test("publishRecordingCore: rejects with 409 when recordingStatus is RECORDING (meeting still live)", async () => {
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "RECORDING", recording_content_id: "c1" } }),
    publishNow: async () => { throw new Error("must not be called"); },
  };
  const result = await publishRecordingCore("m1", deps);
  assert.equal(result.status, 409);
});

test("publishRecordingCore: rejects with 409 when recordingStatus is PROCESSING (egress not finished yet)", async () => {
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "PROCESSING", recording_content_id: "c1" } }),
    publishNow: async () => { throw new Error("must not be called"); },
  };
  const result = await publishRecordingCore("m1", deps);
  assert.equal(result.status, 409);
});

test("publishRecordingCore: rejects with 409 when recordingStatus is FAILED", async () => {
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "FAILED", recording_content_id: null } }),
    publishNow: async () => { throw new Error("must not be called"); },
  };
  const result = await publishRecordingCore("m1", deps);
  assert.equal(result.status, 409);
});

test("publishRecordingCore: rejects with 409 when recordingStatus is NONE (recording never configured/attempted for this meeting)", async () => {
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "NONE", recording_content_id: null } }),
    publishNow: async () => { throw new Error("must not be called"); },
  };
  const result = await publishRecordingCore("m1", deps);
  assert.equal(result.status, 409);
});

test("publishRecordingCore: a corrupted row with recordingStatus READY but no recordingContentId is still rejected, not passed to publishNow(undefined)", async () => {
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "READY", recording_content_id: null } }),
    publishNow: async () => { throw new Error("must not be called with a missing content id"); },
  };
  const result = await publishRecordingCore("m1", deps);
  assert.equal(result.status, 409);
});

test("publishRecordingCore: READY + a content id publishes exactly that content id, nothing else", async () => {
  let publishedId = null;
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "READY", recording_content_id: "content-xyz" } }),
    publishNow: async (id) => { publishedId = id; return { id, status: "PUBLISHED" }; },
  };
  const result = await publishRecordingCore("m1", deps);
  assert.equal(result.status, 200);
  assert.equal(publishedId, "content-xyz");
  assert.equal(result.body.content.id, "content-xyz");
});

test("publishRecordingCore: a downstream publish failure (e.g. content already published/archived) propagates rather than being swallowed", async () => {
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "READY", recording_content_id: "content-xyz" } }),
    publishNow: async () => { const e = new Error("Content is already published."); e.status = 409; throw e; },
  };
  await assert.rejects(() => publishRecordingCore("m1", deps), /already published/);
});

test("publishRecordingCore: recording_content_id has no DB foreign key (by design — see migration comment), so if that content row was deleted out from under a READY meeting, publishNow's own 404 propagates cleanly instead of a DB-level crash", async () => {
  const deps = {
    supabase: makeFakeSupabase({ m1: { id: "m1", recording_status: "READY", recording_content_id: "content-deleted" } }),
    publishNow: async (id) => { const e = new Error(`Content ${id} not found.`); e.status = 404; throw e; },
  };
  await assert.rejects(
    () => publishRecordingCore("m1", deps),
    (err) => err.status === 404 && /not found/.test(err.message)
  );
});

// ---------------------------------------------------------------------
// Authorization: this route is mounted behind authenticate + requireAdmin.
// requireAdmin itself is a small pure function — verify it actually
// blocks non-admins/unauthenticated requests rather than trusting a
// client-supplied role.
// ---------------------------------------------------------------------

function fakeRes() {
  return { statusCode: null, jsonBody: null, status(c) { this.statusCode = c; return this; }, json(b) { this.jsonBody = b; return this; } };
}

test("requireAdmin: blocks a STUDENT with 403", () => {
  const req = { user: { id: "u1", role: "STUDENT" } };
  const res = fakeRes();
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("requireAdmin: blocks a request with no req.user at all (defense in depth if ever mounted without authenticate)", () => {
  const req = {};
  const res = fakeRes();
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("requireAdmin: a role value that merely CONTAINS 'ADMIN' (e.g. 'SUPERADMIN' or lowercase 'admin') is NOT treated as admin — exact match only", () => {
  for (const role of ["admin", "SUPERADMIN", "Admin ", " ADMIN"]) {
    const req = { user: { id: "u1", role } };
    const res = fakeRes();
    let nextCalled = false;
    requireAdmin(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403, `role "${role}" must not pass as ADMIN`);
    assert.equal(nextCalled, false);
  }
});

test("requireAdmin: allows an ADMIN through", () => {
  const req = { user: { id: "u1", role: "ADMIN" } };
  const res = fakeRes();
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});
