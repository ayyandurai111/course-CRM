const { URL } = require("url");

function allowedImageOrigins() {
  const configured = (process.env.ALLOWED_IMAGE_ORIGINS || "").split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean);
  const allow = new Set(configured);

  // Images this app generates itself (course thumbnails uploaded through
  // POST /courses/thumbnail) are always served back from this same
  // Supabase project's own Storage origin — that URL never needs an
  // admin to remember to add it to ALLOWED_IMAGE_ORIGINS, since it's not
  // third-party content, it's our own upload pipeline's output.
  if (process.env.SUPABASE_URL) {
    try {
      allow.add(new URL(process.env.SUPABASE_URL).origin);
    } catch {
      // Malformed SUPABASE_URL is caught elsewhere (lib/supabase.js);
      // just don't add a bogus origin here.
    }
  }
  return allow;
}

function isAllowedHttpsImageUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const allow = allowedImageOrigins();
    if (allow.size === 0) return false;
    return allow.has(url.origin);
  } catch { return false; }
}

module.exports = { isAllowedHttpsImageUrl };
