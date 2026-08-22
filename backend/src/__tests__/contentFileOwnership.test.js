const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveContentUpdateFileKey,
  assertFileOwnershipConsistent,
  FileOwnershipError,
} = require("../services/contentService");

// Mirrors buildStoragePath()'s output format exactly:
//   courses/{courseId}/{videos|pdfs|images}/{contentId}/{contentId}-{32 hex chars}{ext}
function makeFileKey({ courseId, contentId, type }) {
  const folder = { VIDEO: "videos", PDF: "pdfs", POST: "images" }[type];
  const ext = { VIDEO: ".mp4", PDF: ".pdf", POST: ".jpg" }[type];
  return `courses/${courseId}/${folder}/${contentId}/${contentId}-${"a".repeat(32)}${ext}`;
}

const CONTENT_ID = "content-1";
const COURSE_A = "course-a";
const COURSE_B = "course-b";

function existingVideoInCourseA(overrides = {}) {
  return {
    id: CONTENT_ID,
    courseId: COURSE_A,
    type: "VIDEO",
    fileKey: makeFileKey({ courseId: COURSE_A, contentId: CONTENT_ID, type: "VIDEO" }),
    ...overrides,
  };
}

// --- Test 1: change courseId without a new file -----------------------
test("Test 1: changing courseId without a new file is rejected", () => {
  const existing = existingVideoInCourseA();
  assert.throws(() => resolveContentUpdateFileKey({ existing, patch: { courseId: COURSE_B } }), FileOwnershipError);
});

// --- Test 2: change courseId with a valid replacement file -------------
test("Test 2: changing courseId with a valid replacement file succeeds and the file belongs to the new course", () => {
  const existing = existingVideoInCourseA();
  const replacementFileKey = makeFileKey({ courseId: COURSE_B, contentId: CONTENT_ID, type: "VIDEO" });

  const result = resolveContentUpdateFileKey({ existing, patch: { courseId: COURSE_B, fileKey: replacementFileKey } });

  assert.equal(result.courseId, COURSE_B);
  assert.equal(result.fileKey, replacementFileKey);
  assert.equal(result.replacingFile, true);
});

// --- Test 3: attacker manually sends another course's fileKey ----------
test("Test 3: manually supplying another course's fileKey (no courseId change) is rejected", () => {
  const existing = existingVideoInCourseA();
  const someoneElsesFileKey = makeFileKey({ courseId: COURSE_B, contentId: CONTENT_ID, type: "VIDEO" });

  assert.throws(() => resolveContentUpdateFileKey({ existing, patch: { fileKey: someoneElsesFileKey } }), FileOwnershipError);
});

// --- Test 4: change type while keeping an incompatible existing file ---
test("Test 4: changing content type while keeping an incompatible existing file is rejected", () => {
  const existing = existingVideoInCourseA(); // has a .mp4 in videos/
  assert.throws(() => resolveContentUpdateFileKey({ existing, patch: { type: "PDF" } }), FileOwnershipError);
});

// --- Test 5: normal update with no courseId/type/file change -----------
test("Test 5: an unrelated field update with no courseId/type/file change succeeds", () => {
  const existing = existingVideoInCourseA();
  const result = resolveContentUpdateFileKey({ existing, patch: { title: "Updated title" } });

  assert.equal(result.courseId, COURSE_A);
  assert.equal(result.type, "VIDEO");
  assert.equal(result.fileKey, existing.fileKey);
  assert.equal(result.replacingFile, false);
});

// --- Additional coverage -------------------------------------------------

test("content with no existing file can freely change courseId and/or type", () => {
  const existing = existingVideoInCourseA({ fileKey: null });
  const result = resolveContentUpdateFileKey({ existing, patch: { courseId: COURSE_B, type: "PDF" } });
  assert.equal(result.fileKey, null);
  assert.equal(result.courseId, COURSE_B);
  assert.equal(result.type, "PDF");
});

test("a replacement fileKey that still doesn't match the FINAL courseId is rejected", () => {
  const existing = existingVideoInCourseA();
  // Admin says "move to course B" but the uploaded replacement file is
  // still (or was manually crafted to be) under course A.
  const staleFileKey = makeFileKey({ courseId: COURSE_A, contentId: CONTENT_ID, type: "VIDEO" });
  assert.throws(
    () => resolveContentUpdateFileKey({ existing, patch: { courseId: COURSE_B, fileKey: staleFileKey } }),
    FileOwnershipError
  );
});

test("a fileKey whose embedded contentId belongs to a different content item is rejected", () => {
  const existing = existingVideoInCourseA();
  const otherContentsFileKey = makeFileKey({ courseId: COURSE_A, contentId: "content-2", type: "VIDEO" });
  assert.throws(
    () => resolveContentUpdateFileKey({ existing, patch: { fileKey: otherContentsFileKey } }),
    FileOwnershipError
  );
});

// --- Publish-time defense-in-depth (assertFileOwnershipConsistent) -----

test("assertFileOwnershipConsistent passes for a consistent record", () => {
  assert.doesNotThrow(() => assertFileOwnershipConsistent(existingVideoInCourseA()));
});

test("assertFileOwnershipConsistent passes for content with no file at all", () => {
  assert.doesNotThrow(() => assertFileOwnershipConsistent(existingVideoInCourseA({ fileKey: null })));
});

test("assertFileOwnershipConsistent throws when the record's own courseId no longer matches its fileKey", () => {
  // Simulates data that somehow became inconsistent (e.g. a manual DB
  // edit, or a bug elsewhere) — courseId says B, but the fileKey path
  // still embeds A.
  const inconsistent = existingVideoInCourseA({ courseId: COURSE_B });
  assert.throws(() => assertFileOwnershipConsistent(inconsistent), FileOwnershipError);
});

test("assertFileOwnershipConsistent throws when the record's own type no longer matches its fileKey", () => {
  const inconsistent = existingVideoInCourseA({ type: "PDF" }); // fileKey is still a videos/*.mp4 path
  assert.throws(() => assertFileOwnershipConsistent(inconsistent), FileOwnershipError);
});
