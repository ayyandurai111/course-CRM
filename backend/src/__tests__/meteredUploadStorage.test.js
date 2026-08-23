const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { PassThrough } = require("stream");
const express = require("express");
const multer = require("multer");

const uploadGate = require("../lib/uploadGate");
const { createMeteredDiskStorage } = require("../lib/meteredUploadStorage");

function fakeFile(stream) {
  return { originalname: "test.bin", mimetype: "application/octet-stream", stream };
}

function tmpFilesLeft() {
  return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("upload-"));
}

// --- Low-level engine behavior (no HTTP) --------------------------------

test("normal upload: bytes are written, counted, and reserved-bytes released via caller cleanup", async () => {
  uploadGate._resetForTests();
  const storage = createMeteredDiskStorage();
  const stream = new PassThrough();
  const req = {};
  const file = fakeFile(stream);

  const done = new Promise((resolve, reject) => {
    storage._handleFile(req, file, (err, info) => (err ? reject(err) : resolve(info)));
  });

  const payload = Buffer.from("a".repeat(1000));
  stream.end(payload);
  const info = await done;

  assert.equal(info.size, 1000);
  assert.equal(req._uploadReservedBytes, 1000);
  assert.equal(uploadGate.getUploadGateStats().reservedBytes, 1000);
  assert.ok(fs.existsSync(info.path));

  // Simulate the route's own cleanup (finally { removeTempFile }) plus
  // the uploadGate release that always runs on res close/finish.
  await fs.promises.unlink(info.path);
  uploadGate.releaseBytes(req._uploadReservedBytes);
  assert.equal(uploadGate.getUploadGateStats().reservedBytes, 0);
});

test("chunked upload (no declared size) is metered exactly the same as a normal one, byte for byte", async () => {
  uploadGate._resetForTests();
  const storage = createMeteredDiskStorage();
  const stream = new PassThrough();
  const req = {}; // no content-length concept at this layer at all — nothing to spoof
  const file = fakeFile(stream);

  const done = new Promise((resolve, reject) => {
    storage._handleFile(req, file, (err, info) => (err ? reject(err) : resolve(info)));
  });

  // Simulate chunked delivery: many small writes instead of one shot.
  for (let i = 0; i < 50; i++) stream.write(Buffer.alloc(2000, "x"));
  stream.end();

  const info = await done;
  assert.equal(info.size, 100000);
  assert.equal(uploadGate.getUploadGateStats().reservedBytes, 100000);
  await fs.promises.unlink(info.path);
  uploadGate.releaseBytes(100000);
});

test("an oversized chunked upload is aborted once it would exceed the shared temp-disk pool, and reserves nothing extra", async () => {
  uploadGate._resetForTests();
  // Shrink the pool for this test via a fresh module instance is not
  // possible (singleton state), so instead fill most of it first and
  // prove the *next* chunked upload is rejected rather than silently
  // allowed through with an unmetered (Content-Length-less) request.
  const cap = uploadGate.MAX_TEMP_STORAGE_BYTES;
  assert.equal(uploadGate.tryReserveBytes(cap - 500), true); // only 500 bytes left in the pool

  const storage = createMeteredDiskStorage();
  const stream = new PassThrough();
  const req = {};
  const file = fakeFile(stream);

  const result = await new Promise((resolve) => {
    storage._handleFile(req, file, (err, info) => resolve({ err, info }));
    // Send well more than the remaining 500-byte budget, in chunks,
    // with NO Content-Length header at all (this is the exact shape of
    // the chunked-upload bypass: an unknown-length stream).
    for (let i = 0; i < 10; i++) stream.write(Buffer.alloc(200));
    stream.end();
  });

  assert.ok(result.err, "upload must be aborted once the pool would be exceeded");
  assert.match(result.err.message, /temporary storage is at capacity/);
  // Reserved bytes must never exceed the pool cap even mid-abort.
  assert.ok(uploadGate.getUploadGateStats().reservedBytes <= cap);
  // The partial temp file must not be left behind.
  assert.ok(!fs.existsSync(req._uploadTempPath));

  uploadGate._resetForTests();
});

test("a client stream error (aborted connection) cleans up without hanging or leaking reservation", async () => {
  uploadGate._resetForTests();
  const storage = createMeteredDiskStorage();
  const stream = new PassThrough();
  const req = {};
  const file = fakeFile(stream);

  const done = new Promise((resolve) => {
    storage._handleFile(req, file, (err) => resolve(err));
  });

  stream.write(Buffer.alloc(500));
  stream.destroy(new Error("client aborted"));
  const err = await done;
  assert.ok(err);
  assert.equal(err.message, "client aborted");

  // Reservation made before the abort must be releasable by the caller
  // (uploadGate's res-close handler does this in the real route).
  uploadGate.releaseBytes(req._uploadReservedBytes || 0);
  assert.equal(uploadGate.getUploadGateStats().reservedBytes, 0);
});

// --- End-to-end: a genuinely chunked HTTP request, no Content-Length ---

function buildTestApp() {
  const app = express();
  const upload = multer({ storage: createMeteredDiskStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  app.post("/upload", upload.single("file"), (req, res) => {
    res.json({ size: req.file.size, reserved: req._uploadReservedBytes });
    fs.unlink(req.file.path, () => {});
    uploadGate.releaseBytes(req._uploadReservedBytes || 0);
  });
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

test("end-to-end: a real Transfer-Encoding: chunked multipart request (no Content-Length) is fully metered", async () => {
  uploadGate._resetForTests();
  const app = buildTestApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  try {
    const boundary = "----testboundary123";
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = Buffer.alloc(50000, "z");

    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/upload",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            // Deliberately NOT setting Content-Length. Node will use
            // Transfer-Encoding: chunked automatically for a request
            // whose length isn't declared and that isn't ended in one
            // write — exactly the bypass scenario from the spec.
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        }
      );
      req.on("error", reject);
      assert.equal(req.getHeader("content-length"), undefined);
      req.write(head);
      // Write in many small chunks to force real chunked transfer.
      for (let i = 0; i < 25; i++) req.write(body.subarray(i * 2000, (i + 1) * 2000));
      req.end(tail);
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.size, 50000);
    assert.equal(result.body.reserved, 50000);
    assert.equal(uploadGate.getUploadGateStats().reservedBytes, 0);
  } finally {
    server.close();
  }
});
