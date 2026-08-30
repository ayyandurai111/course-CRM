const test = require("node:test");
const assert = require("node:assert/strict");

const S3_ENV = {
  SUPABASE_S3_ACCESS_KEY: "AKIAFAKE",
  SUPABASE_S3_SECRET_KEY: "fake-secret",
  SUPABASE_S3_REGION: "us-east-1",
  SUPABASE_S3_ENDPOINT: "https://project.supabase.co/storage/v1/s3",
  SUPABASE_S3_BUCKET: "course-files",
};

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(vars)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    });
}

// recordingConfig.js is required fresh (not cached) in each test via
// delete require.cache, since it reads env vars inside its functions
// (not at module-load time) — but we still re-require defensively in
// case that ever changes.
function freshRecordingConfig() {
  delete require.cache[require.resolve("../recordingConfig.lib")];
  return require("../recordingConfig.lib");
}
function freshRecordingService() {
  delete require.cache[require.resolve("../meetingRecordingService")];
  delete require.cache[require.resolve("../recordingConfig.lib")];
  return require("../meetingRecordingService");
}

test("recordingConfig: disabled by default when no S3 vars are set", async () => {
  await withEnv(
    {
      SUPABASE_S3_ACCESS_KEY: undefined,
      SUPABASE_S3_SECRET_KEY: undefined,
      SUPABASE_S3_REGION: undefined,
      SUPABASE_S3_ENDPOINT: undefined,
      SUPABASE_S3_BUCKET: undefined,
      SUPABASE_STORAGE_BUCKET: undefined,
      MEETING_RECORDINGS_ENABLED: undefined,
    },
    () => {
      const { recordingEnabled, recordingS3Config } = freshRecordingConfig();
      assert.equal(recordingEnabled(), false);
      assert.equal(recordingS3Config(), null);
    }
  );
});

test("recordingConfig: any single missing S3 var disables recording (partial config is not enough)", async () => {
  for (const missingKey of Object.keys(S3_ENV)) {
    const env = { ...S3_ENV, [missingKey]: undefined };
    await withEnv(env, () => {
      const { recordingEnabled } = freshRecordingConfig();
      assert.equal(recordingEnabled(), false, `missing ${missingKey} should disable recording`);
    });
  }
});

test("recordingConfig: fully configured S3 vars enable recording and forcePathStyle is always true", async () => {
  await withEnv(S3_ENV, () => {
    const { recordingEnabled, recordingS3Config } = freshRecordingConfig();
    assert.equal(recordingEnabled(), true);
    const cfg = recordingS3Config();
    assert.equal(cfg.bucket, "course-files");
    assert.equal(cfg.forcePathStyle, true);
  });
});

test("recordingConfig: SUPABASE_S3_BUCKET falls back to SUPABASE_STORAGE_BUCKET when unset", async () => {
  await withEnv({ ...S3_ENV, SUPABASE_S3_BUCKET: undefined, SUPABASE_STORAGE_BUCKET: "fallback-bucket" }, () => {
    const { recordingS3Config } = freshRecordingConfig();
    assert.equal(recordingS3Config().bucket, "fallback-bucket");
  });
});

test("recordingConfig: MEETING_RECORDINGS_ENABLED=false is a hard kill switch even with full S3 config present", async () => {
  await withEnv({ ...S3_ENV, MEETING_RECORDINGS_ENABLED: "false" }, () => {
    const { recordingEnabled } = freshRecordingConfig();
    assert.equal(recordingEnabled(), false);
  });
});

const meeting = { id: "m1", courseId: "course-1", roomName: "course-course-1-abc" };

test("startRecording: a no-op when recording isn't configured — never touches the egress client at all", async () => {
  await withEnv(
    { SUPABASE_S3_ACCESS_KEY: undefined, SUPABASE_S3_SECRET_KEY: undefined, SUPABASE_S3_REGION: undefined, SUPABASE_S3_ENDPOINT: undefined },
    async () => {
      const { startRecording } = freshRecordingService();
      const egressClient = {
        startRoomCompositeEgress: async () => { throw new Error("must not be called"); },
      };
      const result = await startRecording({ meeting, egressClient });
      assert.equal(result, null);
    }
  );
});

test("startRecording: success — writes to the canonical courses/{courseId}/videos/{contentId}/ path and returns a RECORDING patch", async () => {
  await withEnv(S3_ENV, async () => {
    const { startRecording } = freshRecordingService();
    const { parseStoragePath } = require("../../../storage-upload/backend/fileValidation.lib");

    let capturedOutput = null;
    const egressClient = {
      startRoomCompositeEgress: async (roomName, output) => {
        assert.equal(roomName, meeting.roomName);
        capturedOutput = output;
        return { egressId: "EG_new123" };
      },
    };

    const patch = await startRecording({ meeting, egressClient });
    assert.equal(patch.recordingStatus, "RECORDING");
    assert.equal(patch.recordingEgressId, "EG_new123");
    assert.equal(patch.recordingError, null);
    assert.ok(patch.recordingContentId, "should generate a content id up front");
    assert.equal(patch.recordingFileKey, capturedOutput.filepath);

    // Critical invariant: the path egress is told to write to must be
    // the EXACT shape contentService's publish-time validation
    // (isValidContentFileKey / assertFileOwnershipConsistent) requires
    // — otherwise a "ready" recording could never actually be
    // published. Verify by round-tripping through the real parser.
    const parsed = parseStoragePath(patch.recordingFileKey);
    assert.ok(parsed, "recordingFileKey must be a validly structured Storage path");
    assert.equal(parsed.courseId, meeting.courseId);
    assert.equal(parsed.contentId, patch.recordingContentId);
    assert.equal(parsed.type, "VIDEO");

    // S3 upload target must carry the configured credentials/bucket,
    // not e.g. accidentally point at a different or empty bucket.
    assert.equal(capturedOutput.output.case, "s3");
    assert.equal(capturedOutput.output.value.bucket, "course-files");
    assert.equal(capturedOutput.output.value.forcePathStyle, true);
  });
});

test("startRecording: egress API failure is caught and reported as FAILED — never throws (so meeting start can't be blocked by this)", async () => {
  await withEnv(S3_ENV, async () => {
    const { startRecording } = freshRecordingService();
    const egressClient = {
      startRoomCompositeEgress: async () => { throw new Error("LiveKit egress service unreachable"); },
    };
    const patch = await startRecording({ meeting, egressClient });
    assert.equal(patch.recordingStatus, "FAILED");
    assert.match(patch.recordingError, /unreachable/);
  });
});

test("startRecording: two calls for two different meetings never reuse the same recordingContentId (no collision -> no cross-course file overwrite)", async () => {
  await withEnv(S3_ENV, async () => {
    const { startRecording } = freshRecordingService();
    const egressClient = { startRoomCompositeEgress: async () => ({ egressId: "EG_x" }) };
    const a = await startRecording({ meeting: { ...meeting, id: "m-a" }, egressClient });
    const b = await startRecording({ meeting: { ...meeting, id: "m-b" }, egressClient });
    assert.notEqual(a.recordingContentId, b.recordingContentId);
    assert.notEqual(a.recordingFileKey, b.recordingFileKey);
  });
});

test("stopRecording: no-op (and never calls the egress client) when the meeting has no recordingEgressId", async () => {
  const { stopRecording } = freshRecordingService();
  const egressClient = { stopEgress: async () => { throw new Error("must not be called without an egress id"); } };
  const result = await stopRecording({ meeting: { id: "m1" }, egressClient });
  assert.equal(result, null);
});

test("stopRecording: success stops the correct egress id and marks PROCESSING", async () => {
  const { stopRecording } = freshRecordingService();
  let stoppedId = null;
  const egressClient = { stopEgress: async (id) => { stoppedId = id; } };
  const result = await stopRecording({ meeting: { id: "m1", recordingEgressId: "EG_active" }, egressClient });
  assert.equal(stoppedId, "EG_active");
  assert.deepEqual(result, { recordingStatus: "PROCESSING" });
});

test("stopRecording: egress API failure is swallowed (best-effort) and returns null rather than throwing/blocking meeting end", async () => {
  const { stopRecording } = freshRecordingService();
  const egressClient = { stopEgress: async () => { throw new Error("egress already gone"); } };
  const result = await stopRecording({ meeting: { id: "m1", recordingEgressId: "EG_gone" }, egressClient });
  assert.equal(result, null);
});
