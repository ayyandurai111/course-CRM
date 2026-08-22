const express = require("express");
const { z } = require("zod");
const { supabase, assertNoError } = require("../lib/db");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { logAction } = require("../services/auditService");

const router = express.Router();

// Single row (id = 'landing') holding all editable landing-page copy in
// a jsonb column. Public GET so the landing page can render it with no
// auth; admin-only PUT to edit.
const SITE_CONTENT_ID = "landing";

router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("site_content")
      .select("content")
      .eq("id", SITE_CONTENT_ID)
      .maybeSingle();
    assertNoError(error, "Failed to load site content");
    // null tells the frontend "nothing customized yet" — it falls back
    // to its own bundled defaults rather than the backend hard-coding them.
    res.json({ content: data ? data.content : null });
  } catch (err) {
    next(err);
  }
});

const featureItemSchema = z.object({ glyph: z.string().min(1).max(4), title: z.string().min(1), desc: z.string().min(1) });
const faqItemSchema = z.object({ q: z.string().min(1), a: z.string().min(1) });

const siteContentSchema = z.object({
  hero: z.object({
    badge: z.string(),
    titleLine1: z.string().min(1),
    titleLine2: z.string(),
    subtitle: z.string().min(1),
    primaryCtaLabel: z.string().min(1),
    secondaryCtaLabel: z.string().min(1),
  }),
  courseShowcase: z.object({ eyebrow: z.string(), title: z.string().min(1) }),
  features: z.object({ eyebrow: z.string(), title: z.string().min(1), items: z.array(featureItemSchema).max(12) }),
  plansSection: z.object({ eyebrow: z.string(), title: z.string().min(1) }),
  faq: z.object({ eyebrow: z.string(), title: z.string().min(1), items: z.array(faqItemSchema).max(20) }),
  footer: z.object({ tagline: z.string() }),
  legal: z.object({ terms: z.string(), privacy: z.string() }),
});

router.put("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = siteContentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid site content." });
    }

    const { error } = await supabase.from("site_content").upsert({
      id: SITE_CONTENT_ID,
      content: parsed.data,
      updated_at: new Date(),
      updated_by: req.user.id,
    });
    assertNoError(error, "Failed to save site content");
    await logAction({ actorId: req.user.id, action: "siteContent.update", entityType: "SiteContent", entityId: "landing" });

    res.json({ content: parsed.data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
