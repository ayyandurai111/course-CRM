// NOTE: this file originally asserted that GET /api/files/:contentId
// returns a raw Supabase Storage signed URL directly to the client. That
// was superseded by the playback-token + HttpOnly-cookie + server-side
// stream design in files.routes.js (see that file's comments): the
// browser now gets a same-origin `/api/files/stream/:contentId` URL and
// an HttpOnly playback cookie, never the underlying Storage URL. This
// version of the test asserts the *current* contract instead of the
// retired one. It was failing with 500s because it never set
// PLAYBACK_TOKEN_SECRET, which createPlaybackToken() requires.
process.env.PLAYBACK_TOKEN_SECRET = process.env.PLAYBACK_TOKEN_SECRET || "01234567890123456789012345678901";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SIGNED_URL_TTL_SECONDS } = require("../../../storage-upload/backend/files.routes");
const { PLAYBACK_TOKEN_TTL_SECONDS } = require("../playbackToken.lib");

test("signed URL TTL for content is short (1-2 minutes), not the old 10-minute window", () => {
  assert.ok(SIGNED_URL_TTL_SECONDS <= 120, `expected <=120s, got ${SIGNED_URL_TTL_SECONDS}`);
  assert.ok(SIGNED_URL_TTL_SECONDS >= 30, `expected a still-usable TTL, got ${SIGNED_URL_TTL_SECONDS}`);
});

function loadFilesRouteWithFakes({ role = "STUDENT", canAccess = true, contentRow, fileExistsResult = true }) {
  const dbPath = require.resolve("../../../../shared/backend-core/db");
  const accessServicePath = require.resolve("../../../../features/plans-subscription/backend/accessService");
  const storagePath = require.resolve("../../../../features/storage-upload/backend/storage.lib");
  const authMwPath = require.resolve("../../../../features/auth/backend/auth.middleware");
  const filesRoutePath = require.resolve("../../../../features/storage-upload/backend/files.routes");

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
    getSignedUrl: async (key, ttl) => `https://storage.example/${key}?token=fake&ttl=${ttl}`,
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
  const router = require("../../../storage-upload/backend/files.routes");
  const app = express();
  app.use("/api/files", router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return { app };
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

test("authorized user: gets a same-origin stream URL + playback cookie, never a raw Storage URL, and the response is marked no-store", async () => {
  const { app } = loadFilesRouteWithFakes({ role: "STUDENT", canAccess: true, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 200);
  assert.equal(result.body.url, "/api/files/stream/content-1");
  assert.equal(result.body.expiresInSeconds, PLAYBACK_TOKEN_TTL_SECONDS);
  assert.match(result.headers["set-cookie"]?.[0] || "", /^course_playback=.+HttpOnly/);
  assert.equal(result.headers["cache-control"], "no-store, private");
});

test("unauthorized user (no plan access): denied with 403, no playback cookie is ever issued", async () => {
  const { app } = loadFilesRouteWithFakes({ role: "STUDENT", canAccess: false, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 403);
  assert.equal(result.headers["set-cookie"], undefined, "must not issue a playback cookie before authorization succeeds");
});

test("admin: bypasses the plan-access check but still gets a URL only if the file exists in storage", async () => {
  const { app } = loadFilesRouteWithFakes({ role: "ADMIN", canAccess: false, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 200);
  assert.equal(result.body.url, "/api/files/stream/content-1");
});

test("revoked subscription: a request made after access is revoked is denied immediately (no NEW playback session is issued)", async () => {
  const { app } = loadFilesRouteWithFakes({ role: "STUDENT", canAccess: false, contentRow: CONTENT_ROW });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 403);
});

test("content with no file key at all: 404, not a playback session for nothing", async () => {
  const { app } = loadFilesRouteWithFakes({ contentRow: { id: "content-2", file_key: null } });
  const result = await get(app, "/api/files/content-2");
  assert.equal(result.status, 404);
});

test("file missing from storage despite a valid DB row: 404, not a broken playback session", async () => {
  const { app } = loadFilesRouteWithFakes({ contentRow: CONTENT_ROW, fileExistsResult: false });
  const result = await get(app, "/api/files/content-1");
  assert.equal(result.status, 404);
});

test("each open mints its own fresh playback session rather than reusing/caching one", async () => {
  const { app } = loadFilesRouteWithFakes({ contentRow: CONTENT_ROW });
  const first = await get(app, "/api/files/content-1");
  const second = await get(app, "/api/files/content-1");
  assert.notEqual(first.headers["set-cookie"]?.[0], second.headers["set-cookie"]?.[0], "each request must mint its own fresh playback token rather than reuse/cache one");
});
