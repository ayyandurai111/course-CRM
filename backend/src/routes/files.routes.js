const express = require("express");
const { supabase, row, assertNoError } = require("../lib/db");
const { authenticate } = require("../middleware/auth");
const { userCanAccessContent } = require("../services/accessService");
const { fileExists, getSignedUrl } = require("../lib/storage");

const router = express.Router();

// Spec fix — "Improve Signed URL Lifetime": this used to be 10 minutes,
// which is far longer than necessary for sensitive paid content — a URL
// leaked (browser history, a proxy log, a screen share, a shared link)
// stays usable for the whole window regardless of anything that happens
// to the user's access after it was issued (see the revocation note
// below). 90 seconds is comfortably enough for the client to request the
// URL and start the video/PDF load immediately, while keeping any leak
// window short. If a specific piece of content ever needs longer (e.g. a
// very slow first byte on a large video before the player starts
// pulling range requests), that should be a deliberate, documented
// exception here — not a blanket increase.
const SIGNED_URL_TTL_SECONDS = 90;

// GET /api/files/:contentId
// Verifies the requester is either an admin or a student whose active
// plan grants access to PUBLISHED content, then returns a short-lived
// signed URL to the file in Supabase Storage. Using a signed URL
// (rather than proxying bytes through this server) lets <video>/<iframe>
// use native HTTP range requests, so video scrubbing works properly.
//
// Authorization is re-checked from scratch on every single call to this
// route (spec requirement #1) — there is no caching of the access
// decision or the resulting URL anywhere (requirement #4): a fresh
// signed URL is generated per request, and the client is expected to
// fetch a new one each time the viewer is opened rather than persist
// one. This route is the ONLY way a signed URL for private course files
// is ever produced; Supabase Storage objects for course content are
// never made public (requirement #2), so there is no permanent/public
// URL for any of this content to leak in the first place.
//
// IMPORTANT — revocation semantics (spec requirements #5, #6, #8): if a
// student's subscription/plan access is revoked, this route will
// immediately deny any NEW signed URL request from that moment on
// (userCanAccessContent() re-evaluates access live on every call, not
// from a cached decision). However, Supabase Storage signed URLs are
// bearer tokens baked into the URL itself, verified independently by
// Storage — this application has no mechanism to invalidate a URL that
// was already handed out before it naturally expires. In other words:
// revocation is immediate for *future* URL issuance, but NOT
// retroactive for a URL a student already obtained — that URL remains
// usable by anyone who has it until SIGNED_URL_TTL_SECONDS elapses. This
// is a real, load-bearing limitation of signed-URL-based access control
// and is exactly why the TTL above is kept short rather than long: the
// TTL is the actual upper bound on how long access can outlive
// revocation. Do not describe this route elsewhere as providing instant
// revocation — it does not.
router.get("/:contentId", authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("content")
      .select("*")
      .eq("id", req.params.contentId)
      .maybeSingle();
    assertNoError(error, "Failed to load content");
    if (!data || !data.file_key) {
      return res.status(404).json({ error: "File not found." });
    }
    const content = row(data);

    if (req.user.role !== "ADMIN") {
      const allowed = await userCanAccessContent(req.user.id, content);
      if (!allowed) return res.status(403).json({ error: "You do not have access to this file." });
    }

    const exists = await fileExists(content.fileKey);
    if (!exists) return res.status(404).json({ error: "File not found in storage." });

    const url = await getSignedUrl(content.fileKey, SIGNED_URL_TTL_SECONDS);
    // No-store: this response must never be cached by a shared proxy or
    // the browser's HTTP cache — every call is meant to mint a fresh,
    // freshly-authorized URL (requirement #4).
    res.set("Cache-Control", "no-store");
    res.json({ url, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.SIGNED_URL_TTL_SECONDS = SIGNED_URL_TTL_SECONDS;
