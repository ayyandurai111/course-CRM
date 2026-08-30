const test = require("node:test");
const assert = require("node:assert/strict");

// storageCleanupQueueService talks directly to `../lib/db` and
// `../lib/storage`. Neither this repo's test setup nor its existing
// tests spin up a real Supabase/Postgres instance, so this file injects
// lightweight fakes via the CommonJS module cache (a well-established
// Node testing pattern) to exercise the actual retry/queue logic
// end-to-end without any real I/O.
function loadServiceWithFakes({ queueRows, deleteFile }) {
  const dbPath = require.resolve("../../../../shared/backend-core/db");
  const storagePath = require.resolve("../../../../features/storage-upload/backend/storage.lib");
  const servicePath = require.resolve("../../../../features/storage-upload/backend/storageCleanupQueueService");

  const updates = []; // { id, patch }
  const fakeDb = {
    supabase: {
      from(table) {
        assert.equal(table, "storage_cleanup_queue");
        return {
          select() {
            return this;
          },
          in() {
            return this;
          },
          lt() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: queueRows, error: null });
          },
          update(patch) {
            return {
              eq(_col, id) {
                updates.push({ id, patch });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      },
    },
    rows: (data) => (data || []).map((r) => ({ ...r })), // camelCase passthrough for this flat fake data
    assertNoError: (error) => {
      if (error) throw new Error("unexpected db error");
    },
  };
  const fakeStorage = { deleteFileSafely: deleteFile };

  [dbPath, storagePath, servicePath].forEach((p) => delete require.cache[p]);
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
  require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: fakeStorage };

  const service = require("../../../storage-upload/backend/storageCleanupQueueService");
  return { service, updates };
}

test("normal deletion: a PENDING row whose Storage delete succeeds is marked DONE", async () => {
  const { service, updates } = loadServiceWithFakes({
    queueRows: [{ id: "q1", fileKey: "courses/a/videos/c1/f.mp4", attempts: 0, status: "PENDING" }],
    deleteFile: async () => ({ ok: true }),
  });
  const summary = await service.retryQueuedStorageCleanup();
  assert.equal(summary.scanned, 1);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.stillFailed, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.status, "DONE");
});

test("Storage deletion failure: row is marked FAILED with an incremented attempt count (retryable)", async () => {
  const { service, updates } = loadServiceWithFakes({
    queueRows: [{ id: "q2", fileKey: "courses/a/videos/c2/f.mp4", attempts: 2, status: "FAILED" }],
    deleteFile: async () => ({ ok: false, error: new Error("storage outage") }),
  });
  const summary = await service.retryQueuedStorageCleanup();
  assert.equal(summary.deleted, 0);
  assert.equal(summary.stillFailed, 1);
  assert.equal(updates[0].patch.status, "FAILED");
  assert.equal(updates[0].patch.attempts, 3);
  assert.match(updates[0].patch.last_error, /storage outage/);
});

test("missing Storage file (already gone) is treated as a successful cleanup, not a failure", async () => {
  // deleteFileSafely is documented to return ok:true for an object
  // that's already gone (Storage doesn't error on a missing object).
  const { service, updates } = loadServiceWithFakes({
    queueRows: [{ id: "q3", fileKey: "courses/a/videos/c3/gone.mp4", attempts: 0, status: "PENDING" }],
    deleteFile: async () => ({ ok: true }),
  });
  const summary = await service.retryQueuedStorageCleanup();
  assert.equal(summary.deleted, 1);
  assert.equal(updates[0].patch.status, "DONE");
});

test("retry: multiple PENDING/FAILED rows (mixed reasons — course_delete and content_delete) are all processed generically", async () => {
  const { service, updates } = loadServiceWithFakes({
    queueRows: [
      { id: "q4", fileKey: "courses/a/videos/c4/f.mp4", attempts: 0, status: "PENDING", reason: "content_delete" },
      { id: "q5", fileKey: "courses/a/pdfs/c5/f.pdf", attempts: 1, status: "FAILED", reason: "course_delete" },
    ],
    deleteFile: async (key) => (key.includes("c5") ? { ok: false, error: new Error("x") } : { ok: true }),
  });
  const summary = await service.retryQueuedStorageCleanup();
  assert.equal(summary.scanned, 2);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.stillFailed, 1);
  assert.equal(updates.find((u) => u.id === "q4").patch.status, "DONE");
  assert.equal(updates.find((u) => u.id === "q5").patch.status, "FAILED");
});

test("no queued items: retry is a safe no-op", async () => {
  const { service, updates } = loadServiceWithFakes({ queueRows: [], deleteFile: async () => ({ ok: true }) });
  const summary = await service.retryQueuedStorageCleanup();
  assert.deepEqual(summary, { scanned: 0, deleted: 0, stillFailed: 0 });
  assert.equal(updates.length, 0);
});
