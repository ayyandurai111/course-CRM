const express = require("express");
const { supabase, row, assertNoError } = require("../../../shared/backend-core/db");
const { authenticate } = require("../../auth/backend/auth.middleware");
const { userCanAccessContent } = require("../../plans-subscription/backend/accessService");
const { fileExists, getSignedUrl } = require("./storage.lib");
const { createPlaybackToken, verifyPlaybackToken, PLAYBACK_TOKEN_TTL_SECONDS } = require("../../content/backend/playbackToken.lib");
const { Readable } = require("stream");

const router = express.Router();

function setPlaybackCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.set("Set-Cookie", `course_playback=${encodeURIComponent(token)}; Path=/api/files/stream/; Max-Age=${PLAYBACK_TOKEN_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`);
}

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
async function loadAuthorizedContent(contentId, userId, role) {
  const { data, error } = await supabase
    .from("content")
    .select("*")
    .eq("id", contentId)
    .maybeSingle();
  assertNoError(error, "Failed to load content");
  if (!data || !data.file_key) return { status: 404 };
  const content = row(data);
  if (role !== "ADMIN") {
    const allowed = await userCanAccessContent(userId, content);
    if (!allowed) return { status: 403 };
  }
  const exists = await fileExists(content.fileKey);
  if (!exists) return { status: 404 };
  return { content };
}

// Mint a browser-bound playback cookie. The actual Storage signed URL is
// never exposed to the browser. The cookie is HttpOnly and SameSite=Strict,
// so copying the media URL alone does not grant access to another browser.
router.get("/:contentId/playback", authenticate, async (req, res, next) => {
  try {
    const result = await loadAuthorizedContent(req.params.contentId, req.user.id, req.user.role);
    if (result.status) return res.status(result.status).json({ error: result.status === 403 ? "You do not have access to this file." : "File not found." });

    const token = createPlaybackToken({ userId: req.user.id, contentId: req.params.contentId, role: req.user.role });
    setPlaybackCookie(res, token);
    res.set("Cache-Control", "no-store, private");
    res.json({
      url: `/api/files/stream/${encodeURIComponent(req.params.contentId)}`,
      expiresInSeconds: PLAYBACK_TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    next(err);
  }
});

// Stream protected media through the API instead of returning a permanent
// or directly reusable Supabase Storage URL. Supports HTTP Range requests
// so large videos remain seekable without downloading the entire file.
router.get("/stream/:contentId", async (req, res, next) => {
  try {
    const token = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("course_playback="))?.slice("course_playback=".length) || null;
    const claims = verifyPlaybackToken(token);
    if (!claims || claims.cid !== req.params.contentId) {
      return res.status(401).json({ error: "Playback session expired. Please reopen the content." });
    }

    // Perf note: this route runs on EVERY range request the <video>/<iframe>
    // makes while buffering/seeking — not just once per open — so any
    // per-request cost here is paid many times over the life of a single
    // playback session. Previously this did the full access check TWICE
    // (once inside loadAuthorizedContent below, again explicitly after)
    // plus a separate Storage `.list()` existence check on every single
    // chunk, which visibly delayed the start of playback. Fixed by:
    //   1. Loading the content row and the user's live profile in
    //      parallel (they're independent reads) instead of sequentially.
    //   2. Running the access check exactly once, using the fresh
    //      profile — still re-verified on every request (so
    //      suspension/plan revocation still stops playback immediately,
    //      per the original spec requirement), just no longer duplicated.
    //   3. Dropping the separate fileExists() Storage call from this hot
    //      path — fetchUpstream() below already surfaces a missing file
    //      as a natural 404 from the actual read, so the extra
    //      existence pre-check added a whole network round trip for no
    //      behavioral difference. (It's still done once, in loadAuthorizedContent,
    //      for the /playback route below, which only runs once per open.)
    const [{ data: contentData, error: contentError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from("content").select("*").eq("id", req.params.contentId).maybeSingle(),
      supabase.from("users").select("role,is_active").eq("id", claims.sub).maybeSingle(),
    ]);
    assertNoError(contentError, "Failed to load content");
    assertNoError(profileError, "Failed to verify playback account");
    if (!contentData || !contentData.file_key) return res.status(404).end();
    const content = row(contentData);

    if (!profile?.is_active) return res.status(401).end();
    if (profile.role !== "ADMIN") {
      const allowed = await userCanAccessContent(claims.sub, content);
      if (!allowed) return res.status(403).end();
    }

    // A hung or failed fetch to Storage here previously surfaced to the
    // browser as nothing at all — no response, no error — which looked
    // like a permanently black, silently-stuck video/PDF with no way to
    // recover short of a full page reload. Bound the upstream call and
    // retry once with a freshly minted signed URL (they're free to mint)
    // so a single transient hiccup doesn't require that.
    const UPSTREAM_TIMEOUT_MS = 15000;
    async function fetchUpstream(headers) {
      const url = await getSignedUrl(content.fileKey, 60);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        return await fetch(url, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    const headers = {};
    for (const name of ["range", "if-range", "if-none-match"]) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    let upstream;
    try {
      upstream = await fetchUpstream(headers);
    } catch {
      try {
        upstream = await fetchUpstream(headers);
      } catch {
        return res.status(502).end();
      }
    }
    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      return res.status(upstream.status === 404 ? 404 : 502).end();
    }

    const contentType = upstream.headers.get("content-type") || (content.type === "PDF" ? "application/pdf" : content.type === "VIDEO" ? "video/mp4" : "application/octet-stream");
    res.status(upstream.status);
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "no-store, private, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    });
    for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) res.set(name, value);
    }
    if (upstream.status === 304 || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    next(err);
  }
});

// Legacy endpoint deliberately remains authorization-protected but no longer
// exposes a Storage signed URL to clients. New clients must use /playback.
router.get("/:contentId", authenticate, async (req, res, next) => {
  try {
    const result = await loadAuthorizedContent(req.params.contentId, req.user.id, req.user.role);
    if (result.status) return res.status(result.status).json({ error: result.status === 403 ? "You do not have access to this file." : "File not found." });
    const token = createPlaybackToken({ userId: req.user.id, contentId: req.params.contentId, role: req.user.role });
    setPlaybackCookie(res, token);
    res.set("Cache-Control", "no-store, private");
    res.json({ url: `/api/files/stream/${encodeURIComponent(req.params.contentId)}`, expiresInSeconds: PLAYBACK_TOKEN_TTL_SECONDS });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.SIGNED_URL_TTL_SECONDS = SIGNED_URL_TTL_SECONDS;
