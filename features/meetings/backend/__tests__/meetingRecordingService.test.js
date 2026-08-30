const test = require("node:test");
const assert = require("node:assert/strict");
const { EgressStatus } = require("livekit-server-sdk");
const { handleEgressEnded } = require("../meetingRecordingService");

/**
 * A tiny fake covering just the `meetings` + `content` query-builder
 * surface handleEgressEnded actually uses: select/eq/maybeSingle,
 * update/eq, and insert (with a fake unique-violation for the
 * "webhook redelivered" case). Mirrors the fake used in
 * meetingStartRaceCondition.test.js.
 */
function makeFakeDb({ meetings = [], content = [], recordingSegments = [] } = {}) {
  const state = { meetings: [...meetings], content: [...content], meeting_recording_segments: [...recordingSegments] };

  function meetingsTable() {
    let filters = {};
    const chain = {
      select() { return chain; },
      eq(col, val) { filters[col] = val; return chain; },
      async maybeSingle() {
        const found = state.meetings.find((m) => Object.entries(filters).every(([c, v]) => m[c] === v));
        return { data: found ? { ...found } : null, error: null };
      },
      update(patch) {
        const updateFilters = { ...filters };
        return {
          eq(col, val) { updateFilters[col] = val; return this; },
          then(resolve) {
            state.meetings = state.meetings.map((m) =>
              Object.entries(updateFilters).every(([c, v]) => m[c] === v) ? { ...m, ...patch } : m
            );
            resolve({ data: null, error: null });
          },
        };
      },
    };
    return chain;
  }

  function contentTable() {
    return {
      insert(payload) {
        return (async () => {
          if (state.content.some((c) => c.id === payload.id)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          state.content.push({ ...payload });
          return { error: null };
        })();
      },
    };
  }

  // Only used by the "unknown egress id" fallback path in
  // handleEgressEnded (see handleEgressEndedForArchivedSegment) — no
  // test here currently exercises an actual archived-segment webhook,
  // so this just needs to correctly report "not found" for any egress
  // id, matching real Supabase's maybeSingle() behavior on a miss.
  function recordingSegmentsTable() {
    let filters = {};
    return {
      select() { return this; },
      eq(col, val) { filters[col] = val; return this; },
      async maybeSingle() {
        const found = state.meeting_recording_segments.find((s) => Object.entries(filters).every(([c, v]) => s[c] === v));
        return { data: found ? { ...found } : null, error: null };
      },
    };
  }

  return {
    from(table) {
      if (table === "meetings") return meetingsTable();
      if (table === "content") return contentTable();
      if (table === "meeting_recording_segments") return recordingSegmentsTable();
      throw new Error(`unexpected table ${table}`);
    },
    currentMeetings: () => state.meetings,
    currentContent: () => state.content,
  };
}

const baseMeeting = {
  id: "m1",
  title: "Algebra Live Class",
  description: "Chapter 4",
  course_id: "course-1",
  created_by_id: "admin-1",
  recording_egress_id: "EG_abc",
  recording_content_id: "content-abc",
  recording_file_key: "courses/course-1/videos/content-abc/content-abc-deadbeef.mp4",
  recording_status: "PROCESSING",
};

test("egress_ended success: creates a DRAFT content row from the meeting's recording and marks it READY", async () => {
  const db = makeFakeDb({ meetings: [baseMeeting] });
  const egressInfo = {
    egressId: "EG_abc",
    status: EgressStatus.EGRESS_COMPLETE,
    fileResults: [{ duration: 125n * 1_000_000_000n, size: 987654n }],
  };

  await handleEgressEnded(egressInfo, db);

  const meeting = db.currentMeetings()[0];
  assert.equal(meeting.recording_status, "READY");
  assert.equal(meeting.recording_duration_seconds, 125);
  assert.equal(meeting.recording_file_size_bytes, 987654);

  const [contentRow] = db.currentContent();
  assert.ok(contentRow, "a content row should have been created");
  assert.equal(contentRow.id, "content-abc");
  assert.equal(contentRow.type, "VIDEO");
  assert.equal(contentRow.course_id, "course-1");
  assert.equal(contentRow.file_key, baseMeeting.recording_file_key);
  assert.equal(contentRow.status, "DRAFT");
  assert.equal(contentRow.title, "Algebra Live Class");
});

test("egress_ended failure status: marks the meeting FAILED and never creates a content row", async () => {
  const db = makeFakeDb({ meetings: [{ ...baseMeeting, id: "m2", recording_egress_id: "EG_fail" }] });
  const egressInfo = { egressId: "EG_fail", status: EgressStatus.EGRESS_FAILED, error: "encoder crashed", fileResults: [] };

  await handleEgressEnded(egressInfo, db);

  const meeting = db.currentMeetings()[0];
  assert.equal(meeting.recording_status, "FAILED");
  assert.match(meeting.recording_error, /encoder crashed/);
  assert.equal(db.currentContent().length, 0);
});

test("egress_ended with no file result: treated as failed even if status looks successful", async () => {
  const db = makeFakeDb({ meetings: [{ ...baseMeeting, id: "m3", recording_egress_id: "EG_nofile" }] });
  const egressInfo = { egressId: "EG_nofile", status: EgressStatus.EGRESS_COMPLETE, fileResults: [] };

  await handleEgressEnded(egressInfo, db);

  assert.equal(db.currentMeetings()[0].recording_status, "FAILED");
});

test("egress_ended for an unknown egress id is a no-op (not one of ours, or already handled)", async () => {
  const db = makeFakeDb({ meetings: [baseMeeting] });
  await handleEgressEnded({ egressId: "EG_someone_else", status: EgressStatus.EGRESS_COMPLETE, fileResults: [{ duration: 1n, size: 1n }] }, db);
  assert.equal(db.currentMeetings()[0].recording_status, "PROCESSING", "unrelated meeting must be untouched");
});

test("egress_ended redelivery: a duplicate content row (already inserted) still results in READY, not an error", async () => {
  const db = makeFakeDb({
    meetings: [{ ...baseMeeting, id: "m4", recording_egress_id: "EG_redelivered" }],
    content: [{ id: "content-abc", title: "already inserted" }],
  });
  const egressInfo = { egressId: "EG_redelivered", status: EgressStatus.EGRESS_COMPLETE, fileResults: [{ duration: 60n * 1_000_000_000n, size: 100n }] };

  await handleEgressEnded(egressInfo, db);

  assert.equal(db.currentMeetings()[0].recording_status, "READY");
  assert.equal(db.currentContent().length, 1, "must not insert a second row");
});
