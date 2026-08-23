const { URL } = require("url");

function allowedImageOrigins() {
  return new Set((process.env.ALLOWED_IMAGE_ORIGINS || "").split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean));
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
