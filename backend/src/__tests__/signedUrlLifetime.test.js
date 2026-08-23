const test = require("node:test");
const assert = require("node:assert/strict");

const { SIGNED_URL_TTL_SECONDS } = require("../routes/files.routes");

test("signed URL TTL for content is short (1-2 minutes), not the old 10-minute window", () => {
  assert.ok(SIGNED_URL_TTL_SECONDS <= 120, `expected <=120s, got ${SIGNED_URL_TTL_SECONDS}`);
  assert.ok(SIGNED_URL_TTL_SECONDS >= 30, `expected a still-usable TTL, got ${SIGNED_URL_TTL_SECONDS}`);
});

function loadFilesRouteWithFakes({ role = "STUDENT", canAccess = true, contentRow, fileExistsResult = true, signResult }) {
  const dbPath = require.resolve("../lib/db");
  const accessServicePath = require.resolve("../services/accessService");
  const storagePath = require.resolve("../lib/storage");
  const authMwPath = require.resolve("../middleware/auth");
  const filesRoutePath = require.resolve("../routes/files.routes");

  const signCalls = [];
  const fakeDb = {
    supabase: {
      from(table) {
        assert.equal(table, "content");
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: contentRow, error: null });
          },
        };
      },
    },
    row: (r) => r,
    assertNoError: (error) => {
      if (error) throw new Error("unexpected db error");
    },
  };
  const fakeAccessService = { userCanAccessContent: async () => canAccess };
  const fakeStorage = {
    fileExists: async () => fileExistsResult,
    getSignedUrl: async (key, ttl) => {
      signCalls.push({ key, ttl });
      if (signResult === "error") throw new Error("Storage signing failed");
      return `https://storage.example/${key}?token=fake&ttl=${ttl}`;
    },
  };
  const fakeAuthMw = {
    authenticate: (req, res, next) => {
      req.user = { id: "user-1", role };
      next();
    },
  };

  [dbPath, accessServicePath, storagePath, authMwPath, filesRoutePath].forEach((p) => delete require.cache[p]);
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
  require.cache[accessServicePath] = { id: accessServicePath, filename: accessServicePath, loaded: true, exports: fakeAccessService };
  require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: fakeStorage };
  require.cache[authMwPath] = { id: authMwPath, filename: authMwPath, loaded: true, exports: fakeAuthMw };

  const express = require("express");
  const router = require("../routes/files.routes");
  const app = express();
  app.use("/api/files", router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return { app, signCalls };
}

async function get(app, path) {
  const http = require("http");
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = server.address().port;
    return await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${path}`, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}"), headers: res.headers }));
        })
        .on("error", reject);
    });
  } finally {
    server.close();
  }
}

const CONTENT_ROW = { id: "content-1", file_key: "courses/a/videos/content-1/f.mp4", status: "PUBLISHED", course_id: "course-a", type: "VIDEO" };

test("authorized user: receives a signed URL generated with the short TTL, and the response is marked no-store", async () => {
  const { app, signCalls } = loadFilesRouteWithFakes({ role: "STUDENT", canAccess: true, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 200);
  assert.match(result.body.url, /^https:\/\/storage\.example\//);
  assert.equal(result.body.expiresInSeconds, SIGNED_URL_TTL_SECONDS);
  assert.equal(signCalls[0].ttl, SIGNED_URL_TTL_SECONDS);
  assert.equal(result.headers["cache-control"], "no-store");
});

test("unauthorized user (no plan access): denied with 403, no signed URL is ever generated", async () => {
  const { app, signCalls } = loadFilesRouteWithFakes({ role: "STUDENT", canAccess: false, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 403);
  assert.equal(signCalls.length, 0, "must not sign a URL before authorization succeeds");
});

test("admin: bypasses the plan-access check but still gets a URL only if the file exists in storage", async () => {
  const { app, signCalls } = loadFilesRouteWithFakes({ role: "ADMIN", canAccess: false, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 200);
  assert.equal(signCalls.length, 1);
});

test("revoked subscription: a request made after access is revoked is denied immediately (no NEW URL is issued)", async () => {
  // Simulates the moment right after a subscription/plan is revoked —
  // userCanAccessContent now returns false — by requesting with
  // canAccess:false, mirroring what happens once access.getAccessibleCourseIds
  // no longer includes the course.
  const { app, signCalls } = loadFilesRouteWithFakes({ role: "STUDENT", canAccess: false, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 403);
  assert.equal(signCalls.length, 0);
});

test("content with no file key at all: 404, not a signed URL for nothing", async () => {
  const { app } = loadFilesRouteWithFakes({ contentRow: { id: "content-2", file_key: null } });
  const result = await get(app, "/api/files/content-2");
  assert.equal(result.status, 404);
});

test("file missing from storage despite a valid DB row: 404, not a broken signed URL", async () => {
  const { app, signCalls } = loadFilesRouteWithFakes({ contentRow: CONTENT_ROW, fileExistsResult: false });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 404);
  assert.equal(signCalls.length, 0);
});

test("Storage signing failure surfaces as an error, not a silently-broken 200", async () => {
  const { app } = loadFilesRouteWithFakes({ contentRow: CONTENT_ROW, signResult: "error" });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 500);
});

// --- "expired signed URL" behavior: documented, not something the app
// backend enforces server-side once issued (Storage/CDN owns that) ---

test("an expired signed URL is Storage's concern, not re-validated by this route — this app never caches or re-serves an old URL", async () => {
  // This route always mints a brand-new signed URL on every call (never
  // returns a cached one), so there is no code path here that could
  // hand back an already-expired URL from a previous request. Actual
  // expiry enforcement of the URL itself happens inside Supabase
  // Storage when the URL is eventually used, which this test suite
  // cannot exercise without live Storage — documented instead in
  // files.routes.js's revocation-semantics comment.
  const { app, signCalls } = loadFilesRouteWithFakes({ contentRow: CONTENT_ROW });
  await get(app, "/api/files/content-1");
  await get(app, "/api/files/content-1");
  assert.equal(signCalls.length, 2, "each request must mint its own fresh URL rather than reuse/cache one");
});
