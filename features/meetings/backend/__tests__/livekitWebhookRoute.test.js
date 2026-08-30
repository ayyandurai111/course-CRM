const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const { AccessToken } = require("livekit-server-sdk");
const { createLivekitWebhookRouter } = require("../livekitWebhook.routes");

const REAL_API_KEY = "webhook-test-key";
const REAL_API_SECRET = "webhook-test-secret-thats-long-enough";

/**
 * Signs a webhook body exactly the way a real LiveKit server does:
 * an AccessToken JWT whose `sha256` grant is the base64 SHA-256 digest
 * of the exact raw body bytes. WebhookReceiver.receive() verifies both
 * the JWT signature (proves it was minted with our api key/secret) AND
 * that this digest matches the body actually delivered (proves the
 * body wasn't tampered with in transit) — see WebhookReceiver.test.ts
 * in the SDK itself, which this mirrors.
 */
async function signWebhook(body, { apiKey = REAL_API_KEY, apiSecret = REAL_API_SECRET } = {}) {
  const sha = crypto.createHash("sha256").update(body).digest("base64");
  const token = new AccessToken(apiKey, apiSecret);
  token.sha256 = sha;
  return token.toJwt();
}

function buildApp(deps) {
  const app = express();
  app.use(express.raw({ type: "*/*" }));
  app.use("/webhook", createLivekitWebhookRouter(deps));
  return app;
}

async function withServer(deps, fn) {
  const app = buildApp(deps);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

function postWebhook(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/webhook", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(vars)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    });
}

// ---------------------------------------------------------------------
// Auth / signature verification — the actual security boundary of this
// endpoint. Anyone who can POST arbitrary egress_ended events to this
// route can forge a "recording finished" content publish target, so
// every one of these must hold.
// ---------------------------------------------------------------------

test("webhook: correctly signed egress_ended is accepted (200) and dispatched to handleEgressEnded with the right payload", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let received = null;
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_123", status: 3 } });
    const token = await signWebhook(body);
    await withServer({ handleEgressEnded: async (info) => { received = info; } }, async (port) => {
      const res = await postWebhook(port, body, { Authorization: token });
      assert.equal(res.status, 200);
    });
    assert.ok(received, "handleEgressEnded should have been called");
    assert.equal(received.egressId, "EG_123");
  });
});

test("webhook: missing Authorization header is rejected with 401 and never reaches handleEgressEnded", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let called = false;
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_no_auth" } });
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      const res = await postWebhook(port, body);
      assert.equal(res.status, 401);
    });
    assert.equal(called, false);
  });
});

test("webhook: a token signed with the WRONG api secret is rejected with 401 (forged webhook)", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let called = false;
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_forged" } });
    const forgedToken = await signWebhook(body, { apiSecret: "attacker-guessed-wrong-secret" });
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      const res = await postWebhook(port, body, { Authorization: forgedToken });
      assert.equal(res.status, 401);
    });
    assert.equal(called, false);
  });
});

test("webhook: a validly-signed token whose body digest doesn't match the delivered body is rejected (tampering after signing)", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let called = false;
    const originalBody = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_original" } });
    const token = await signWebhook(originalBody); // signs the digest of originalBody
    const tamperedBody = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_ATTACKER_SUBSTITUTED" } });
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      // Send the *tampered* body but the token signed for the original one.
      const res = await postWebhook(port, tamperedBody, { Authorization: token });
      assert.equal(res.status, 401);
    });
    assert.equal(called, false, "a body/signature mismatch must never reach application logic");
  });
});

test("webhook: a token minted for a DIFFERENT LiveKit deployment's api key is rejected even if that deployment's secret happens to be known", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let called = false;
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_other_deployment" } });
    const token = await signWebhook(body, { apiKey: "someone-elses-api-key", apiSecret: REAL_API_SECRET });
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      const res = await postWebhook(port, body, { Authorization: token });
      assert.equal(res.status, 401);
    });
    assert.equal(called, false);
  });
});

test("webhook: an empty/garbage Authorization header is rejected, not crashed on", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_garbage" } });
    await withServer({}, async (port) => {
      const res = await postWebhook(port, body, { Authorization: "Bearer not-a-real-jwt" });
      assert.equal(res.status, 401);
    });
  });
});

// ---------------------------------------------------------------------
// Behavior when recording isn't configured on this deployment at all.
// ---------------------------------------------------------------------

test("webhook: with LIVEKIT_API_KEY/SECRET unset, any POST (even unsigned) is accepted as a no-op 200 instead of 401/500", async () => {
  await withEnv({ LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "" }, async () => {
    let called = false;
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_unconfigured" } });
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      const res = await postWebhook(port, body); // no Authorization header at all
      assert.equal(res.status, 200);
    });
    assert.equal(called, false, "must not process events when this deployment never configured LiveKit credentials");
  });
});

// ---------------------------------------------------------------------
// Event-type dispatch logic.
// ---------------------------------------------------------------------

test("webhook: a differently-typed event (e.g. room_started) is accepted but does NOT call handleEgressEnded", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let called = false;
    const body = JSON.stringify({ event: "room_started", room: { name: "some-room" } });
    const token = await signWebhook(body);
    // recordingEnabled left at its real (false, no S3 env set in
    // tests) default so this doesn't attempt a real Supabase call —
    // see the dedicated room_started tests below for that path with
    // fakes injected.
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      const res = await postWebhook(port, body, { Authorization: token });
      assert.equal(res.status, 200);
    });
    assert.equal(called, false);
  });
});

test("webhook: room_started for a LIVE meeting resumes a dropped recording when recording is configured", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET, LIVEKIT_WS_URL: "wss://livekit.example.com" }, async () => {
    const body = JSON.stringify({ event: "room_started", room: { name: "course-course-1-abc" } });
    const token = await signWebhook(body);
    let resumeCalledWith = null;
    const fakeSupabase = {
      from(table) {
        assert.equal(table, "meetings");
        return {
          select() { return this; },
          eq(col, val) {
            if (col === "room_name") assert.equal(val, "course-course-1-abc");
            if (col === "status") assert.equal(val, "LIVE");
            return this;
          },
          async maybeSingle() {
            return { data: { id: "m1", room_name: "course-course-1-abc", status: "LIVE", recording_status: "FAILED" }, error: null };
          },
        };
      },
    };
    await withServer(
      {
        recordingEnabled: () => true,
        supabase: fakeSupabase,
        resumeRecordingIfDropped: async (args) => { resumeCalledWith = args; return null; },
      },
      async (port) => {
        const res = await postWebhook(port, body, { Authorization: token });
        assert.equal(res.status, 200);
      }
    );
    assert.ok(resumeCalledWith, "resumeRecordingIfDropped should have been called");
    assert.equal(resumeCalledWith.meeting.id, "m1");
  });
});

test("webhook: room_started for a room with no matching LIVE meeting is a safe no-op", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    const body = JSON.stringify({ event: "room_started", room: { name: "not-a-meeting-room" } });
    const token = await signWebhook(body);
    let resumeCalled = false;
    const fakeSupabase = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: null, error: null }; },
        };
      },
    };
    await withServer(
      {
        recordingEnabled: () => true,
        supabase: fakeSupabase,
        resumeRecordingIfDropped: async () => { resumeCalled = true; },
      },
      async (port) => {
        const res = await postWebhook(port, body, { Authorization: token });
        assert.equal(res.status, 200);
      }
    );
    assert.equal(resumeCalled, false);
  });
});

test("webhook: room_started is skipped entirely when recording isn't configured (recordingEnabled() false)", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    const body = JSON.stringify({ event: "room_started", room: { name: "course-course-1-abc" } });
    const token = await signWebhook(body);
    let supabaseTouched = false;
    const fakeSupabase = {
      from() {
        supabaseTouched = true;
        throw new Error("should not be called");
      },
    };
    await withServer(
      { recordingEnabled: () => false, supabase: fakeSupabase, resumeRecordingIfDropped: async () => {} },
      async (port) => {
        const res = await postWebhook(port, body, { Authorization: token });
        assert.equal(res.status, 200);
      }
    );
    assert.equal(supabaseTouched, false);
  });
});

test("webhook: a genuine egress_started event (not egress_ended) is accepted and does NOT create/finalize a content row", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let called = false;
    const body = JSON.stringify({ event: "egress_started", egressInfo: { egressId: "EG_still_recording" } });
    const token = await signWebhook(body);
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      const res = await postWebhook(port, body, { Authorization: token });
      assert.equal(res.status, 200);
    });
    assert.equal(called, false);
  });
});

test("webhook: a well-authenticated request whose downstream handler throws still returns 200 (so LiveKit doesn't infinite-retry a bug in our own bookkeeping)", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_handler_throws" } });
    const token = await signWebhook(body);
    await withServer({ handleEgressEnded: async () => { throw new Error("boom"); } }, async (port) => {
      const res = await postWebhook(port, body, { Authorization: token });
      assert.equal(res.status, 200);
    });
  });
});

test("webhook: egress_ended with no egressInfo at all is accepted and is a safe no-op", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET }, async () => {
    let called = false;
    const body = JSON.stringify({ event: "egress_ended" });
    const token = await signWebhook(body);
    await withServer({ handleEgressEnded: async () => { called = true; } }, async (port) => {
      const res = await postWebhook(port, body, { Authorization: token });
      assert.equal(res.status, 200);
    });
    assert.equal(called, false);
  });
});

// ---------------------------------------------------------------------
// participant_left: stop recording immediately when the ADMIN leaves,
// rather than waiting on LiveKit's own room-empty timeout.
// ---------------------------------------------------------------------

function fakeMeetingsSupabase({ meetingRow, onUpdate } = {}) {
  return {
    from(table) {
      assert.equal(table, "meetings");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: meetingRow, error: null }; },
        update(patch) {
          if (onUpdate) onUpdate(patch);
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    },
  };
}

test("webhook: participant_left for the ADMIN stops a RECORDING meeting immediately", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET, LIVEKIT_WS_URL: "wss://livekit.example.com" }, async () => {
    const body = JSON.stringify({
      event: "participant_left",
      room: { name: "course-course-1-abc" },
      participant: { identity: "admin-1", metadata: JSON.stringify({ role: "ADMIN" }) },
    });
    const token = await signWebhook(body);
    let stopCalledWith = null;
    let updatePatch = null;
    const fakeSupabase = fakeMeetingsSupabase({
      meetingRow: { id: "m1", room_name: "course-course-1-abc", status: "LIVE", recording_status: "RECORDING", recording_egress_id: "EG_1" },
      onUpdate: (patch) => { updatePatch = patch; },
    });
    await withServer(
      {
        recordingEnabled: () => true,
        supabase: fakeSupabase,
        stopRecording: async (args) => { stopCalledWith = args; return { recordingStatus: "PROCESSING" }; },
      },
      async (port) => {
        const res = await postWebhook(port, body, { Authorization: token });
        assert.equal(res.status, 200);
      }
    );
    assert.ok(stopCalledWith, "stopRecording should have been called");
    assert.equal(stopCalledWith.meeting.id, "m1");
    assert.equal(updatePatch.recording_status, "PROCESSING");
  });
});

test("webhook: participant_left for a STUDENT does NOT stop recording", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET, LIVEKIT_WS_URL: "wss://livekit.example.com" }, async () => {
    const body = JSON.stringify({
      event: "participant_left",
      room: { name: "course-course-1-abc" },
      participant: { identity: "student-1", metadata: JSON.stringify({ role: "STUDENT" }) },
    });
    const token = await signWebhook(body);
    let stopCalled = false;
    const fakeSupabase = fakeMeetingsSupabase({
      meetingRow: { id: "m1", room_name: "course-course-1-abc", status: "LIVE", recording_status: "RECORDING", recording_egress_id: "EG_1" },
    });
    await withServer(
      { recordingEnabled: () => true, supabase: fakeSupabase, stopRecording: async () => { stopCalled = true; } },
      async (port) => {
        const res = await postWebhook(port, body, { Authorization: token });
        assert.equal(res.status, 200);
      }
    );
    assert.equal(stopCalled, false);
  });
});

test("webhook: participant_left for the ADMIN when nothing is currently RECORDING is a safe no-op", async () => {
  await withEnv({ LIVEKIT_API_KEY: REAL_API_KEY, LIVEKIT_API_SECRET: REAL_API_SECRET, LIVEKIT_WS_URL: "wss://livekit.example.com" }, async () => {
    const body = JSON.stringify({
      event: "participant_left",
      room: { name: "course-course-1-abc" },
      participant: { identity: "admin-1", metadata: JSON.stringify({ role: "ADMIN" }) },
    });
    const token = await signWebhook(body);
    let stopCalled = false;
    const fakeSupabase = fakeMeetingsSupabase({
      meetingRow: { id: "m1", room_name: "course-course-1-abc", status: "LIVE", recording_status: "PROCESSING", recording_egress_id: "EG_1" },
    });
    await withServer(
      { recordingEnabled: () => true, supabase: fakeSupabase, stopRecording: async () => { stopCalled = true; } },
      async (port) => {
        const res = await postWebhook(port, body, { Authorization: token });
        assert.equal(res.status, 200);
      }
    );
    assert.equal(stopCalled, false);
  });
});
