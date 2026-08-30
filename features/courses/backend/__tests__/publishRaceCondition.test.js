const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPublishRpcArgs,
  mapPublishRpcError,
  PublishConflictError,
  NotFoundError,
  InvalidTransitionError,
} = require("../../../content/backend/contentService");

// --- buildPublishRpcArgs: the exact snapshot sent to the atomic commit ---

test("buildPublishRpcArgs sends the content's own courseId/type/fileKey as the expected snapshot", () => {
  const content = { id: "content-1", courseId: "course-a", type: "VIDEO", fileKey: "courses/course-a/videos/content-1/x.mp4" };
  const args = buildPublishRpcArgs(content);
  assert.deepEqual(args, {
    p_content_id: "content-1",
    p_expected_course_id: "course-a",
    p_expected_type: "VIDEO",
    p_expected_file_key: "courses/course-a/videos/content-1/x.mp4",
  });
});

test("buildPublishRpcArgs normalizes a missing fileKey to null (POST/text content with no file)", () => {
  const content = { id: "content-2", courseId: "course-a", type: "POST", fileKey: null };
  assert.equal(buildPublishRpcArgs(content).p_expected_file_key, null);
  const content2 = { id: "content-3", courseId: "course-a", type: "POST" };
  assert.equal(buildPublishRpcArgs(content2).p_expected_file_key, null);
});

// --- mapPublishRpcError: translating Postgres errcodes from the atomic RPC ---

test("errcode 40001 (serialization_failure) — concurrent modification — maps to PublishConflictError (409, retryable)", () => {
  const content = { id: "content-1" };
  const mapped = mapPublishRpcError({ code: "40001", message: "changed" }, content);
  assert.ok(mapped instanceof PublishConflictError);
  assert.equal(mapped.status, 409);
  assert.match(mapped.message, /content-1/);
});

test("errcode P0002 (no_data_found) maps to NotFoundError (404) — e.g. content deleted concurrently", () => {
  const content = { id: "content-9" };
  const mapped = mapPublishRpcError({ code: "P0002", message: "not found" }, content);
  assert.ok(mapped instanceof NotFoundError);
  assert.equal(mapped.status, 404);
});

test("errcode 23514 (check_violation) maps to InvalidTransitionError (400) — status changed to a non-publishable one concurrently", () => {
  const content = { id: "content-5", status: "ARCHIVED" };
  const mapped = mapPublishRpcError({ code: "23514", message: "bad transition" }, content);
  assert.ok(mapped instanceof InvalidTransitionError);
  assert.equal(mapped.status, 400);
});

test("an unrecognized DB error is not silently swallowed or mis-mapped to a security-relevant error type", () => {
  const content = { id: "content-1" };
  const mapped = mapPublishRpcError({ code: "08006", message: "connection failure" }, content);
  assert.ok(!(mapped instanceof PublishConflictError));
  assert.ok(!(mapped instanceof NotFoundError));
  assert.ok(!(mapped instanceof InvalidTransitionError));
  assert.match(mapped.message, /connection failure/);
});

// --- PublishConflictError shape ---

test("PublishConflictError is a 409 with a retry-oriented message", () => {
  const err = new PublishConflictError("content-42");
  assert.equal(err.status, 409);
  assert.match(err.message, /retry/i);
});
