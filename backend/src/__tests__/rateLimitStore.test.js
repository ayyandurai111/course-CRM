const test = require("node:test");
const assert = require("node:assert/strict");

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("no REDIS_URL: returns undefined so express-rate-limit uses its own default per-process store", () => {
  delete process.env.REDIS_URL;
  const storePath = require.resolve("../lib/rateLimitStore");
  delete require.cache[storePath];
  const { createRateLimitStore } = require("../lib/rateLimitStore");
  assert.equal(createRateLimitStore("api"), undefined);
});

test("REDIS_URL set but optional Redis packages not installed: falls back to undefined and does not throw", () => {
  withEnv({ REDIS_URL: "redis://localhost:6379" }, () => {
    const storePath = require.resolve("../lib/rateLimitStore");
    delete require.cache[storePath];
    const { createRateLimitStore } = require("../lib/rateLimitStore");

    const originalError = console.error;
    let warned = false;
    console.error = (...args) => {
      warned = true;
      originalError.call(console, ...args);
    };
    let result;
    try {
      result = createRateLimitStore("api");
    } finally {
      console.error = originalError;
    }
    // ioredis/rate-limit-redis are not dependencies of this project, so
    // this must fail closed to "no shared store" rather than throw.
    assert.equal(result, undefined);
    assert.equal(warned, true, "must warn loudly rather than silently degrade");
  });
});

test("createRateLimitStore never throws regardless of REDIS_URL value", () => {
  withEnv({ REDIS_URL: "not-a-real-url" }, () => {
    const storePath = require.resolve("../lib/rateLimitStore");
    delete require.cache[storePath];
    const { createRateLimitStore } = require("../lib/rateLimitStore");
    assert.doesNotThrow(() => createRateLimitStore("auth"));
  });
});

// --- documentation / wiring sanity checks ---

test("all four express-rate-limit instances are wired through createRateLimitStore (index.js x3, upload.routes.js x1)", () => {
  const fs = require("fs");
  const indexSrc = fs.readFileSync(require.resolve("../index.js"), "utf8");
  const uploadSrc = fs.readFileSync(require.resolve("../routes/upload.routes.js"), "utf8");
  assert.match(indexSrc, /require\(".\/lib\/rateLimitStore"\)/);
  assert.equal((indexSrc.match(/store: createRateLimitStore\(/g) || []).length, 3, "all three index.js rate limiters (general API, auth, LiveKit webhook) must use the shared store selector");
  assert.match(uploadSrc, /store: createRateLimitStore\(/);
});

test("docs/SCALING.md exists and documents every process-local counter", () => {
  const fs = require("fs");
  const path = require("path");
  const docPath = path.join(__dirname, "..", "..", "..", "docs", "SCALING.md");
  const content = fs.readFileSync(docPath, "utf8");
  assert.match(content, /activeCount/);
  assert.match(content, /reservedBytes/);
  assert.match(content, /try_reserve_upload_quota/);
});
