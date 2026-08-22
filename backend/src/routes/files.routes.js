const express = require("express");
const { supabase, row, assertNoError } = require("../lib/db");
const { authenticate } = require("../middleware/auth");
const { userCanAccessContent } = require("../services/accessService");
const { fileExists, getSignedUrl } = require("../lib/storage");

const router = express.Router();

const SIGNED_URL_TTL_SECONDS = 10 * 60; // 10 minutes

// GET /api/files/:contentId
// Verifies the requester is either an admin or a student whose active
// plan grants access to PUBLISHED content, then returns a short-lived
// signed URL to the file in Supabase Storage. Using a signed URL
// (rather than proxying bytes through this server) lets <video>/<iframe>
// use native HTTP range requests, so video scrubbing works properly.
// The URL expires quickly and is never persisted anywhere — a fresh one
// is fetched each time the viewer is opened.
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
    res.json({ url, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
