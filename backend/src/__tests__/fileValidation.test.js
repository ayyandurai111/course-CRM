const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isExtensionAllowed,
  isMimeAllowed,
  matchesFileSignature,
  safeExtension,
  buildStoragePath,
  isSafeId,
  maxSizeBytesFor,
  parseStoragePath,
  isValidContentFileKey,
} = require("../lib/fileValidation");

test("only mp4/webm extensions and mime types are allowed for VIDEO", () => {
  assert.equal(isExtensionAllowed("VIDEO", ".mp4"), true);
  assert.equal(isExtensionAllowed("VIDEO", ".webm"), true);
  assert.equal(isExtensionAllowed("VIDEO", ".mov"), false);
  assert.equal(isMimeAllowed("VIDEO", "video/mp4"), true);
  assert.equal(isMimeAllowed("VIDEO", "video/quicktime"), false);
});

test("only application/pdf is allowed for PDF", () => {
  assert.equal(isMimeAllowed("PDF", "application/pdf"), true);
  assert.equal(isMimeAllowed("PDF", "application/x-pdf"), false);
});

test("only jpeg/png/webp are allowed for POST (image), not gif", () => {
  assert.equal(isMimeAllowed("POST", "image/jpeg"), true);
  assert.equal(isMimeAllowed("POST", "image/png"), true);
  assert.equal(isMimeAllowed("POST", "image/webp"), true);
  assert.equal(isMimeAllowed("POST", "image/gif"), false);
  assert.equal(isExtensionAllowed("POST", ".gif"), false);
});

test("safeExtension extracts a lowercase extension and ignores path traversal", () => {
  assert.equal(safeExtension("movie.MP4"), ".mp4");
  assert.equal(safeExtension("../../etc/passwd"), "");
  assert.equal(safeExtension("no-extension"), "");
});

test("matchesFileSignature detects PDF magic bytes", () => {
  const buf = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3", "binary");
  assert.equal(matchesFileSignature("PDF", buf), true);
  assert.equal(matchesFileSignature("PDF", Buffer.from("not a pdf at all")), false);
});

test("matchesFileSignature detects PNG/JPEG/WEBP magic bytes for POST", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
  assert.equal(matchesFileSignature("POST", png), true);
  assert.equal(matchesFileSignature("POST", jpeg), true);
  assert.equal(matchesFileSignature("POST", webp), true);
  assert.equal(matchesFileSignature("POST", Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])), false);
});

test("matchesFileSignature detects MP4 (ftyp) and WebM (EBML) for VIDEO", () => {
  const mp4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]); // ....ftyp
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  assert.equal(matchesFileSignature("VIDEO", mp4), true);
  assert.equal(matchesFileSignature("VIDEO", webm), true);
  assert.equal(matchesFileSignature("VIDEO", Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])), false);
});

test("a renamed executable (wrong extension for its bytes) fails signature check", () => {
  // MZ header (a Windows executable) renamed to lesson.mp4 must not pass.
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  assert.equal(matchesFileSignature("VIDEO", exe), false);
});

test("buildStoragePath follows courses/{courseId}/{folder}/{contentId}/{generatedName}", () => {
  const { storagePath, generatedFileName } = buildStoragePath({
    courseId: "course-001",
    contentId: "content-001",
    type: "VIDEO",
    ext: ".mp4",
  });
  assert.match(storagePath, /^courses\/course-001\/videos\/content-001\/content-001-[a-f0-9]{32}\.mp4$/);
  assert.match(generatedFileName, /^content-001-[a-f0-9]{32}\.mp4$/);
});

test("isSafeId rejects path traversal and empty/oversized ids", () => {
  assert.equal(isSafeId("course-001"), true);
  assert.equal(isSafeId("../../etc"), false);
  assert.equal(isSafeId(""), false);
  assert.equal(isSafeId("a/b"), false);
  assert.equal(isSafeId("a".repeat(200)), false);
});

test("maxSizeBytesFor falls back to spec defaults when env vars are unset", () => {
  delete process.env.MAX_VIDEO_SIZE_MB;
  delete process.env.MAX_PDF_SIZE_MB;
  delete process.env.MAX_IMAGE_SIZE_MB;
  assert.equal(maxSizeBytesFor("VIDEO"), 500 * 1024 * 1024);
  assert.equal(maxSizeBytesFor("PDF"), 50 * 1024 * 1024);
  assert.equal(maxSizeBytesFor("POST"), 10 * 1024 * 1024);
});

// --- spec #6: strengthened fileKey validation ------------------------

test("parseStoragePath accepts a well-formed generated path", () => {
  const { storagePath, generatedFileName } = buildStoragePath({
    courseId: "course-001",
    contentId: "content-001",
    type: "VIDEO",
    ext: ".mp4",
  });
  const parsed = parseStoragePath(storagePath);
  assert.ok(parsed);
  assert.equal(parsed.courseId, "course-001");
  assert.equal(parsed.contentId, "content-001");
  assert.equal(parsed.type, "VIDEO");
  assert.ok(generatedFileName.startsWith("content-001-"));
});

test("parseStoragePath rejects path traversal and absolute paths", () => {
  assert.equal(parseStoragePath("courses/../../etc/passwd"), null);
  assert.equal(parseStoragePath("/courses/a/videos/b/c.mp4"), null);
  assert.equal(parseStoragePath("courses/a/videos/../b/c.mp4"), null);
});

test("parseStoragePath rejects wrong segment count / unexpected folders", () => {
  assert.equal(parseStoragePath("courses/a/videos/b/extra/c.mp4"), null);
  assert.equal(parseStoragePath("courses/a/videos/b"), null);
  assert.equal(parseStoragePath("courses/a/not-a-real-folder/b/c.mp4"), null);
});

test("parseStoragePath rejects a filename that doesn't match its declared contentId/extension", () => {
  // Right shape, but the file name doesn't embed contentId "b" and isn't a valid generated name.
  assert.equal(parseStoragePath("courses/a/videos/b/some-other-file.mp4"), null);
  // Right contentId prefix, wrong extension for the VIDEO folder.
  const { storagePath } = buildStoragePath({ courseId: "a", contentId: "b", type: "VIDEO", ext: ".mp4" });
  assert.equal(parseStoragePath(storagePath.replace(".mp4", ".exe")), null);
});

test("isValidContentFileKey rejects a file that belongs to a different course/content/type", () => {
  const { storagePath } = buildStoragePath({ courseId: "course-A", contentId: "content-1", type: "VIDEO", ext: ".mp4" });

  assert.equal(isValidContentFileKey({ fileKey: storagePath, courseId: "course-A", contentId: "content-1", type: "VIDEO" }).ok, true);
  // Cross-course reference.
  assert.equal(isValidContentFileKey({ fileKey: storagePath, courseId: "course-B", contentId: "content-1", type: "VIDEO" }).ok, false);
  // Cross-content reference within the same course.
  assert.equal(isValidContentFileKey({ fileKey: storagePath, courseId: "course-A", contentId: "content-2", type: "VIDEO" }).ok, false);
  // Wrong declared type for the content record.
  assert.equal(isValidContentFileKey({ fileKey: storagePath, courseId: "course-A", contentId: "content-1", type: "PDF" }).ok, false);
  // A prefix match alone (old, weaker check) must not be enough.
  assert.equal(
    isValidContentFileKey({ fileKey: `courses/course-A/../../etc/passwd`, courseId: "course-A", contentId: "content-1", type: "VIDEO" }).ok,
    false
  );
});
