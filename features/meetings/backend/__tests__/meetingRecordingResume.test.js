const test = require("node:test");
const assert = require("node:assert/strict");
const { resumeRecordingIfDropped } = require("../meetingRecordingService");

/**
 * Fake covering just what resumeRecordingIfDropped touches:
 * meeting_recording_segments (count + insert) and meetings (update ->
 * select("*, courses(...)")). Mirrors the fake in
 * meetingRecordingService.test.js but scoped to this one function.
 */
function makeFakeDb({ meetings = [], segments = [] } = {}) {
  const state = { meetings: [...meetings], meeting_recording_segments: [...segments] };

  function meetingsTable() {
    let filters = {};
    return {
      update(patch) {
        const updateFilters = { ...filters };
        const api = {
          eq(col, val) { updateFilters[col] = val; return api; },
          select() { return api; },
          async maybeSingle() {
            state.meetings = state.meetings.map((m) =>
              Object.entries(updateFilters).every(([c, v]) => m[c] === v) ? { ...m, ...patch } : m
            );
            const updated = state.meetings.find((m) =>
              Object.entries(updateFilters).every(([c, v]) => m[c] === v)
            );
            return { data: updated ? { ...updated, courses: { id: updated.course_id, title: "Course" } } : null, error: null };
          },
        };
        return api;
      },
      eq(col, val) { filters[col] = val; return this; },
    };
  }

  function segmentsTable() {
    let filters = {};
    return {
      select(_cols, opts) {
        if (opts && opts.count === "exact" && opts.head) {
          return {
            eq(col, val) {
              const n = state.meeting_recording_segments.filter((s) => s[col] === val).length;
              return { then: (resolve) => resolve({ count: n, error: null }) };
            },
          };
        }
        return this;
      },
      eq(col, val) { filters[col] = val; return this; },
      insert(payload) {
        state.meeting_recording_segments.push({ ...payload });
        return (async () => ({ error: null }))();
      },
    };
  }

  return {
    from(table) {
      if (table === "meetings") return meetingsTable();
      if (table === "meeting_recording_segments") return segmentsTable();
      throw new Error(`unexpected table ${table}`);
    },
    currentMeetings: () => state.meetings,
    currentSegments: () => state.meeting_recording_segments,
  };
}

function fakeEgressClient(egressId = "EG_new") {
  return { startRoomCompositeEgress: async () => ({ egressId }) };
}

const baseMeeting = {
  id: "m1",
  courseId: "course-1",
  title: "Algebra Live Class",
  description: "Chapter 4",
  roomName: "course-course-1-abc",
  createdById: "admin-1",
  recordingStatus: "PROCESSING",
  recordingEgressId: "EG_old",
  recordingContentId: "content-old",
  recordingFileKey: "courses/course-1/videos/content-old/x.mp4",
};

test("resumeRecordingIfDropped: no-op when recording is currently RECORDING (nothing dropped)", async () => {
  const db = makeFakeDb({ meetings: [{ ...baseMeeting, id: "m2" }] });
  const result = await resumeRecordingIfDropped({
    meeting: { ...baseMeeting, recordingStatus: "RECORDING" },
    egressClient: fakeEgressClient(),
    db,
  });
  assert.equal(result, null);
  assert.equal(db.currentSegments().length, 0);
});

test("resumeRecordingIfDropped: no-op when recording was never configured (NONE)", async () => {
  const db = makeFakeDb({ meetings: [baseMeeting] });
  const result = await resumeRecordingIfDropped({
    meeting: { ...baseMeeting, recordingStatus: "NONE", recordingEgressId: null },
    egressClient: fakeEgressClient(),
    db,
  });
  assert.equal(result, null);
  assert.equal(db.currentSegments().length, 0);
});

test("resumeRecordingIfDropped: archives the dropped segment and starts a new one when the egress already stopped", async () => {
  process.env.MEETING_RECORDINGS_ENABLED = "true";
  process.env.SUPABASE_S3_ACCESS_KEY = "k";
  process.env.SUPABASE_S3_SECRET_KEY = "s";
  process.env.SUPABASE_S3_REGION = "r";
  process.env.SUPABASE_S3_ENDPOINT = "https://example.com";
  process.env.SUPABASE_S3_BUCKET = "b";

  const db = makeFakeDb({ meetings: [baseMeeting] });
  const result = await resumeRecordingIfDropped({
    meeting: baseMeeting,
    egressClient: fakeEgressClient("EG_new"),
    db,
  });

  assert.ok(result, "should return the updated meeting row");
  assert.equal(result.recording_status, "RECORDING");
  assert.equal(result.recording_egress_id, "EG_new");
  assert.notEqual(result.recording_content_id, "content-old", "a fresh segment gets its own content id");

  const [archived] = db.currentSegments();
  assert.ok(archived, "the earlier segment should have been archived");
  assert.equal(archived.egress_id, "EG_old");
  assert.equal(archived.content_id, "content-old");
  assert.equal(archived.segment_number, 1);

  delete process.env.MEETING_RECORDINGS_ENABLED;
  delete process.env.SUPABASE_S3_ACCESS_KEY;
  delete process.env.SUPABASE_S3_SECRET_KEY;
  delete process.env.SUPABASE_S3_REGION;
  delete process.env.SUPABASE_S3_ENDPOINT;
  delete process.env.SUPABASE_S3_BUCKET;
});
