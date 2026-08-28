const express = require("express");
const { WebhookReceiver } = require("livekit-server-sdk");
const { handleEgressEnded: realHandleEgressEnded } = require("../services/meetingRecordingService");

/**
 * Builds the LiveKit webhook router. `deps.handleEgressEnded` defaults
 * to the real service function; tests override it so the route's HTTP
 * layer (signature verification, status codes, event-type dispatch)
 * can be exercised against a real Express app + real
 * WebhookReceiver/AccessToken signing, without needing a live Supabase
 * connection. See meetings.routes.js's `startMeetingCore(id, deps)`
 * for the same pattern.
 */
function createLivekitWebhookRouter(deps = {}) {
  const handleEgressEnded = deps.handleEgressEnded || realHandleEgressEnded;
  const router = express.Router();

  let receiver = null;
  function webhookReceiver() {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return null;
    // Deliberately not cached across differing apiKey/apiSecret env
    // values (tests flip these between cases) — cheap to construct.
    if (!receiver || receiver.__apiKey !== apiKey || receiver.__apiSecret !== apiSecret) {
      receiver = new WebhookReceiver(apiKey, apiSecret);
      receiver.__apiKey = apiKey;
      receiver.__apiSecret = apiSecret;
    }
    return receiver;
  }

  // LiveKit signs this payload with the same API key/secret used to talk
  // to LiveKit's own API, so WebhookReceiver.receive() both verifies the
  // request actually came from our LiveKit deployment AND parses it —
  // there is no separate shared-secret to configure. This route is
  // mounted (see index.js) with a raw-body parser ahead of the global
  // express.json(), since the signature is computed over the exact raw
  // bytes LiveKit sent.
  router.post("/", async (req, res) => {
    const wr = webhookReceiver();
    if (!wr) {
      // Recording isn't configured on this deployment; nothing to verify
      // or act on. 200 so LiveKit doesn't retry forever.
      return res.status(200).end();
    }

    let event;
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
      event = await wr.receive(rawBody, req.get("Authorization"));
    } catch (err) {
      console.warn("[livekit-webhook] signature verification failed", err?.message || err);
      return res.status(401).end();
    }

    try {
      if (event.event === "egress_ended" && event.egressInfo) {
        await handleEgressEnded(event.egressInfo);
      }
    } catch (err) {
      // Log and still 200 — LiveKit will retry a 4xx/5xx indefinitely,
      // and a bug in our own bookkeeping shouldn't hold up its delivery
      // queue. The meeting stays in PROCESSING and is visible to admins
      // as needing attention rather than silently stuck.
      console.error("[livekit-webhook] failed to process egress_ended", err);
    }

    res.status(200).end();
  });

  return router;
}

module.exports = createLivekitWebhookRouter();
module.exports.createLivekitWebhookRouter = createLivekitWebhookRouter;
