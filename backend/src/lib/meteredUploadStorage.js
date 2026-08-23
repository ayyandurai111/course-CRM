const fs = require("fs");
const os = require("os");
const path = require("path");
const { tryReserveBytes } = require("./uploadGate");

/**
 * Custom Multer storage engine that meters bytes into the shared
 * temp-disk pool (uploadGate.tryReserveBytes) LIVE, chunk-by-chunk, as
 * they are actually written to disk — instead of reserving a single
 * amount up front from the (spoofable/omittable) Content-Length header.
 *
 * This is what closes the chunked-upload resource-exhaustion bypass: a
 * request sent with `Transfer-Encoding: chunked` and no Content-Length
 * still has every byte it writes counted against MAX_TEMP_STORAGE_BYTES
 * in real time, so many such uploads in flight together can't silently
 * exceed the pool the way they could when the reservation was
 * Content-Length-only (which saw 0 declared bytes for a chunked
 * request and reserved nothing).
 *
 * Multer's own `limits.fileSize` is unrelated to this and already
 * enforced independently of Content-Length by busboy while parsing the
 * multipart stream itself — that remains the hard per-file size
 * ceiling. This engine adds the missing *aggregate, cross-request*
 * protection for temp disk specifically. When busboy's own limit fires
 * (the "limit" event on file.stream), this engine treats it the same
 * as any other hard cap being hit and aborts cleanly.
 *
 * Extracted into its own module (rather than inlined in
 * upload.routes.js) so it can be unit-tested directly against a raw
 * Node Readable stream, without spinning up Supabase-backed route
 * handlers.
 */
function createMeteredDiskStorage({ tempDir = os.tmpdir() } = {}) {
  return {
    _handleFile(req, file, cb) {
      const name = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const destPath = path.join(tempDir, name);
      // Recorded on `req` (not just the multer file object) so a
      // caller's own cleanup handler (e.g. uploadGate's res close/finish
      // listener) can unlink it and release its reserved bytes even if
      // the request aborts before multer's own callback chain finishes.
      req._uploadTempPath = destPath;
      req._uploadReservedBytes = 0;

      const outStream = fs.createWriteStream(destPath);
      let bytesWritten = 0;
      let settled = false;

      const finish = (err, info) => {
        if (settled) return;
        settled = true;
        cb(err, info);
      };

      const abort = (err) => {
        if (settled) return;
        file.stream.unpipe(outStream);
        outStream.destroy();
        file.stream.resume(); // drain remaining input so the request can end cleanly
        finish(err);
      };

      file.stream.on("data", (chunk) => {
        if (settled) return;
        if (!tryReserveBytes(chunk.length)) {
          abort(Object.assign(new Error("Server temporary storage is at capacity. Please try again shortly."), { status: 503 }));
          return;
        }
        req._uploadReservedBytes += chunk.length;
        bytesWritten += chunk.length;
      });
      file.stream.on("error", (err) => abort(err));
      outStream.on("error", (err) => abort(err));
      file.stream.on("limit", () =>
        abort(Object.assign(new Error("File exceeds the maximum allowed size."), { status: 413, code: "LIMIT_FILE_SIZE" }))
      );

      file.stream.pipe(outStream);
      outStream.on("finish", () => finish(null, { path: destPath, size: bytesWritten, filename: name }));
    },
    _removeFile(req, file, cb) {
      fs.unlink(file.path, () => cb());
    },
  };
}

module.exports = { createMeteredDiskStorage };
