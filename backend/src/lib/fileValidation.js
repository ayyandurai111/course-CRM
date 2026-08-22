const crypto = require("crypto");

/**
 * Single source of truth for what the platform accepts as an upload.
 * Content `type` (VIDEO / PDF / POST) maps to a Storage sub-folder and a
 * configurable size limit — see requirements #3-#5 of the security spec.
 */
const UPLOAD_RULES = {
  VIDEO: {
    folder: "videos",
    extensions: [".mp4", ".webm"],
    mimeTypes: ["video/mp4", "video/webm"],
    maxSizeEnv: "MAX_VIDEO_SIZE_MB",
    defaultMaxSizeMb: 500,
  },
  PDF: {
    folder: "pdfs",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    maxSizeEnv: "MAX_PDF_SIZE_MB",
    defaultMaxSizeMb: 50,
  },
  // "POST" is the content type used for image posts throughout the app;
  // it maps to the "images" storage folder from the spec.
  POST: {
    folder: "images",
    extensions: [".jpg", ".jpeg", ".png", ".webp"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSizeEnv: "MAX_IMAGE_SIZE_MB",
    defaultMaxSizeMb: 10,
  },
};

function maxSizeBytesFor(type) {
  const rule = UPLOAD_RULES[type];
  if (!rule) return 0;
  const mb = Number(process.env[rule.maxSizeEnv]) || rule.defaultMaxSizeMb;
  return mb * 1024 * 1024;
}

/** The single largest size any upload could be — used as multer's hard ceiling. */
function maxPossibleSizeBytes() {
  return Math.max(...Object.keys(UPLOAD_RULES).map((t) => maxSizeBytesFor(t)));
}

function safeExtension(originalName) {
  const match = /\.[a-zA-Z0-9]+$/.exec(String(originalName || ""));
  return match ? match[0].toLowerCase() : "";
}

function isExtensionAllowed(type, ext) {
  const rule = UPLOAD_RULES[type];
  return !!rule && rule.extensions.includes(ext);
}

function isMimeAllowed(type, mime) {
  const rule = UPLOAD_RULES[type];
  return !!rule && rule.mimeTypes.includes(String(mime || "").toLowerCase());
}

/**
 * Lightweight magic-byte / file-signature check. This is not a full
 * format parser — it's enough to catch the common case of a renamed or
 * mislabeled file (e.g. a .exe renamed to .mp4) without adding a new
 * dependency. `buf` should be at least the first 16 bytes of the file.
 */
function matchesFileSignature(type, buf) {
  if (!buf || buf.length < 4) return false;

  const startsWith = (bytes, offset = 0) =>
    bytes.every((b, i) => buf[offset + i] === b);
  const asciiAt = (offset, str) =>
    buf.slice(offset, offset + str.length).toString("ascii") === str;

  switch (type) {
    case "PDF":
      // "%PDF-"
      return asciiAt(0, "%PDF-");
    case "POST":
      // JPEG: FF D8 FF | PNG: 89 50 4E 47 | WEBP: "RIFF"....."WEBP"
      if (startsWith([0xff, 0xd8, 0xff])) return true;
      if (startsWith([0x89, 0x50, 0x4e, 0x47])) return true;
      if (buf.length >= 12 && asciiAt(0, "RIFF") && asciiAt(8, "WEBP")) return true;
      return false;
    case "VIDEO":
      // MP4/MOV family: bytes 4-7 spell "ftyp" (ISO base media file format).
      if (buf.length >= 8 && asciiAt(4, "ftyp")) return true;
      // WebM/Matroska: EBML header 1A 45 DF A3.
      if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return true;
      return false;
    default:
      return false;
  }
}

/**
 * Builds the Storage object path from the spec:
 *   courses/{courseId}/{videos|pdfs|images}/{contentId}/{generatedFileName}
 * The generated file name never contains the original, user-supplied
 * filename — only a random id plus the validated extension — so it can
 * never be used for path traversal or to smuggle an unexpected extension.
 */
function buildStoragePath({ courseId, contentId, type, ext }) {
  const rule = UPLOAD_RULES[type];
  const randomId = crypto.randomBytes(16).toString("hex");
  const generatedFileName = `${contentId}-${randomId}${ext}`;
  return {
    storagePath: `courses/${courseId}/${rule.folder}/${contentId}/${generatedFileName}`,
    generatedFileName,
  };
}

/** Firestore doc IDs used as path segments — defends storage paths even if a ref is otherwise trusted. */
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
function isSafeId(id) {
  return typeof id === "string" && SAFE_ID_RE.test(id) && !id.includes("..");
}

/**
 * Strict parser for the platform's Storage layout:
 *   courses/{courseId}/{videos|pdfs|images}/{contentId}/{generatedFileName}
 *
 * Returns null for anything that doesn't match this exact 4-segment
 * shape — no extra segments, no leading/trailing slashes, no `..`, no
 * absolute paths, no segment containing characters outside isSafeId's
 * allowlist. This is the single source of truth callers must use
 * instead of a prefix check (spec #6): a prefix check only proves the
 * string *starts with* `courses/{courseId}/`, not that every segment is
 * well-formed or that the folder matches a real content type.
 */
const FOLDER_TO_TYPE = Object.fromEntries(Object.entries(UPLOAD_RULES).map(([type, rule]) => [rule.folder, type]));

function parseStoragePath(storagePath) {
  if (typeof storagePath !== "string" || storagePath.length === 0) return null;
  // Reject absolute paths, path traversal, and any whitespace/control
  // characters up front, before even trying to split on "/".
  if (storagePath.includes("..") || storagePath.startsWith("/") || /\s/.test(storagePath)) return null;

  const segments = storagePath.split("/");
  if (segments.length !== 5) return null;
  const [courses, courseId, folder, contentId, fileName] = segments;
  if (courses !== "courses") return null;
  if (!isSafeId(courseId) || !isSafeId(contentId)) return null;

  const type = FOLDER_TO_TYPE[folder];
  if (!type) return null;

  // fileName must be exactly what buildStoragePath() generates:
  // `${contentId}-${32 hex chars}${allowed extension}` — this ties the
  // object to this specific contentId (not just "some file in this
  // course's folder") and rules out a client smuggling an unexpected
  // extension via the filename.
  const rule = UPLOAD_RULES[type];
  const extPattern = rule.extensions.map((e) => e.replace(".", "\\.")).join("|");
  const fileNameRe = new RegExp(`^${contentId}-[a-f0-9]{32}(${extPattern})$`);
  if (!fileNameRe.test(fileName)) return null;

  return { courseId, contentId, type, folder };
}

/**
 * Full ownership/structure validation for a fileKey a client is
 * attaching to a content record (spec #6). Returns `{ ok: true }` or
 * `{ ok: false, reason }` — never throws, so route handlers can turn a
 * failure into a clean 400 without a try/catch.
 *
 * This never trusts the client-supplied fileKey alone: it re-derives
 * what the path is *required* to look like from the trusted
 * courseId/contentId/type the caller already validated against the
 * database, and only accepts an exact match.
 */
function isValidContentFileKey({ fileKey, courseId, contentId, type }) {
  const parsed = parseStoragePath(fileKey);
  if (!parsed) return { ok: false, reason: "fileKey is not a validly structured Storage path." };
  if (parsed.courseId !== courseId) return { ok: false, reason: "fileKey does not belong to the given course." };
  if (contentId && parsed.contentId !== contentId) {
    return { ok: false, reason: "fileKey does not belong to the given content." };
  }
  if (type && parsed.type !== type) {
    return { ok: false, reason: "fileKey's file type does not match the content type." };
  }
  return { ok: true, parsed };
}

module.exports = {
  UPLOAD_RULES,
  maxSizeBytesFor,
  maxPossibleSizeBytes,
  safeExtension,
  isExtensionAllowed,
  isMimeAllowed,
  matchesFileSignature,
  buildStoragePath,
  isSafeId,
  parseStoragePath,
  isValidContentFileKey,
};
