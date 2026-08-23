const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const multer = require("multer");
const http = require("http");

const { MULTIPART_LIMITS, findUnexpectedUploadField } = require("../routes/upload.routes");

// --- application-level allowlist against nested/unexpected fields ---

test("findUnexpectedUploadField: accepts exactly the expected flat fields", () => {
  assert.equal(findUnexpectedUploadField({ type: "PDF", courseId: "abc" }), null);
});

test("findUnexpectedUploadField: rejects a bracket-notation nested field ('a[b][c]' surfaces as top-level key 'a')", () => {
  assert.equal(findUnexpectedUploadField({ a: { b: { c: "1" } } }), "a");
});

test("findUnexpectedUploadField: rejects any unexpected top-level field name, nested or not", () => {
  assert.equal(findUnexpectedUploadField({ type: "PDF", extra: "x" }), "extra");
});

test("findUnexpectedUploadField: an empty body has no unexpected fields", () => {
  assert.equal(findUnexpectedUploadField({}), null);
  assert.equal(findUnexpectedUploadField(undefined), null);
});


function buildTestApp() {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: MULTIPART_LIMITS });
  app.post("/upload", upload.single("file"), (req, res) => {
    res.json({ ok: true, fields: req.body, fileSize: req.file ? req.file.size : null });
  });
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.message, code: err.code });
    }
    res.status(500).json({ error: err.message });
  });
  return app;
}

async function withServer(fn) {
  const app = buildTestApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

function postMultipart(port, parts, { headers = {} } = {}) {
  const boundary = "----testboundary" + Math.random().toString(36).slice(2);
  const chunks = [];
  for (const part of parts) {
    if (part.type === "field") {
      chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`);
    } else if (part.type === "file") {
      chunks.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`
      );
      chunks.push(part.data);
      chunks.push("\r\n");
    }
  }
  chunks.push(`--${boundary}--\r\n`);
  const body = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/upload",
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length, ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("normal upload: two fields + one file within limits succeeds", async () => {
  await withServer(async (port) => {
    const result = await postMultipart(port, [
      { type: "field", name: "type", value: "PDF" },
      { type: "field", name: "courseId", value: "11111111-1111-1111-1111-111111111111" },
      { type: "file", name: "file", filename: "a.pdf", data: Buffer.alloc(100, "x") },
    ]);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.fileSize, 100);
  });
});

test("too many fields (over the fields limit) is rejected, not silently truncated", async () => {
  await withServer(async (port) => {
    const parts = [];
    for (let i = 0; i < MULTIPART_LIMITS.fields + 5; i++) {
      parts.push({ type: "field", name: `f${i}`, value: "x" });
    }
    parts.push({ type: "file", name: "file", filename: "a.pdf", data: Buffer.alloc(10) });
    const result = await postMultipart(port, parts);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "LIMIT_FIELD_COUNT");
  });
});

test("too many files (over the files:1 limit) is rejected", async () => {
  await withServer(async (port) => {
    const result = await postMultipart(port, [
      { type: "field", name: "type", value: "PDF" },
      { type: "file", name: "file", filename: "a.pdf", data: Buffer.alloc(10) },
      { type: "file", name: "file", filename: "b.pdf", data: Buffer.alloc(10) },
    ]);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "LIMIT_FILE_COUNT");
  });
});

test("oversized file (over fileSize limit) is rejected with 413", async () => {
  const app = express();
  // Use a small fileSize for this test so we don't need a real 500MB buffer.
  const upload = multer({ storage: multer.memoryStorage(), limits: { ...MULTIPART_LIMITS, fileSize: 1000 } });
  app.post("/upload", upload.single("file"), (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.message, code: err.code });
    res.status(500).json({ error: err.message });
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = server.address().port;
    const result = await postMultipart(port, [{ type: "file", name: "file", filename: "big.bin", data: Buffer.alloc(5000) }]);
    assert.equal(result.status, 413);
    assert.equal(result.body.code, "LIMIT_FILE_SIZE");
  } finally {
    server.close();
  }
});

test("a bracket-notation field name beyond fieldNestingDepth is rejected outright (multer-specific LIMIT_FIELD_NESTING)", async () => {
  // multer layers a real `fieldNestingDepth` option on top of busboy
  // (see node_modules/multer/lib/make-middleware.js) specifically to
  // cap how deep append-field's bracket-notation nesting is allowed to
  // go. MULTIPART_LIMITS sets this to 2, so `a[b][c][d]` (3 levels of
  // brackets) must be rejected before any nested object is even built.
  await withServer(async (port) => {
    const result = await postMultipart(port, [
      { type: "field", name: "a[b][c][d]", value: "1" },
      { type: "file", name: "file", filename: "a.pdf", data: Buffer.alloc(10) },
    ]);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "LIMIT_FIELD_NESTING");
  });
});

test("a bracket-notation field name within fieldNestingDepth is allowed through by multer (still caught by the route's own allowlist — see upload.routes.js)", async () => {
  await withServer(async (port) => {
    const result = await postMultipart(port, [
      { type: "field", name: "a[b]", value: "1" }, // 1 level, within depth 2
      { type: "file", name: "file", filename: "a.pdf", data: Buffer.alloc(10) },
    ]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.fields, { a: { b: "1" } });
  });
});

test("field value exceeding fieldSize is rejected outright (fail-closed), not silently truncated and accepted", async () => {
  await withServer(async (port) => {
    const longValue = "x".repeat(MULTIPART_LIMITS.fieldSize + 500);
    const result = await postMultipart(port, [
      { type: "field", name: "type", value: longValue },
      { type: "file", name: "file", filename: "a.pdf", data: Buffer.alloc(10) },
    ]);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "LIMIT_FIELD_VALUE");
  });
});
