const test = require("node:test");
const assert = require("node:assert/strict");
const { startMeetingCore } = require("../routes/meetings.routes");

// A tiny fake `meetings` table with just enough chainable query-builder
// surface to exercise startMeetingCore's update-then-select flow, plus a
// call log so tests can assert exactly what happened and in what order.
function makeFakeMeetingsTable(initialRow) {
  let row = { ...initialRow };
  const calls = [];

  return {
    calls,
    currentRow: () => row,
    from(table) {
      if (table !== "meetings") throw new Error(`unexpected table ${table}`);
      return {
        update(patch) {
          const state = { eqs: {} };
          const apply = () => {
            const matches = Object.entries(state.eqs).every(([col, val]) => row[col] === val);
            calls.push({ op: "update", eqs: { ...state.eqs }, matched: matches });
            if (!matches) return { data: null, error: null };
            row = { ...row, ...patch };
            return { data: { ...row, courses: null }, error: null };
          };
          const chain = {
            eq(col, val) {
              state.eqs[col] = val;
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              return apply();
            },
            // Mirrors real supabase-js: the query builder itself is
            // thenable, so `await builder.eq(...).eq(...)` (no
            // .select()/.maybeSingle()) still executes the update.
            then(resolve, reject) {
              try {
                resolve(apply());
              } catch (e) {
                reject(e);
              }
            },
          };
          return chain;
        },
      };
    },
  };
}

test("start race: only the winning request creates a LiveKit room; the loser never touches LiveKit and does not delete the winner's room", async () => {
  const db = makeFakeMeetingsTable({ id: "m1", status: "SCHEDULED", room_name: "course-x-room-1" });
  const liveKitCalls = [];
  const fakeApi = {
    room: {
      createRoom: async (opts) => { liveKitCalls.push({ op: "create", opts }); },
      deleteRoom: async (name) => { liveKitCalls.push({ op: "delete", name }); },
    },
  };
  const deps = { supabase: db, liveKitApi: () => fakeApi };

  // Simulate two "concurrent" requests by calling sequentially — the
  // atomic UPDATE...WHERE status='SCHEDULED' is what actually decides
  // the winner, not call ordering here.
  const first = await startMeetingCore("m1", deps);
  const second = await startMeetingCore("m1", deps);

  assert.equal(first.conflict, false, "first caller should win and start the meeting");
  assert.equal(second.conflict, true, "second caller should see the meeting as no longer startable");

  // Exactly one LiveKit room creation, ever — the loser must bail out
  // before calling LiveKit at all.
  assert.equal(liveKitCalls.filter((c) => c.op === "create").length, 1);
  // Critically: the loser must NEVER delete the room — that was the bug
  // (deleting the winner's just-started, live room).
  assert.equal(liveKitCalls.filter((c) => c.op === "delete").length, 0);

  assert.equal(db.currentRow().status, "LIVE");
});

test("start race: if LiveKit room creation fails, the meeting is rolled back to SCHEDULED instead of being stuck LIVE with no room", async () => {
  const db = makeFakeMeetingsTable({ id: "m2", status: "SCHEDULED", room_name: "course-y-room-1" });
  const fakeApi = {
    room: {
      createRoom: async () => { throw new Error("LiveKit unavailable"); },
    },
  };
  const deps = { supabase: db, liveKitApi: () => fakeApi };

  await assert.rejects(() => startMeetingCore("m2", deps), /LiveKit unavailable/);
  assert.equal(db.currentRow().status, "SCHEDULED", "must roll back so the meeting isn't stuck LIVE with no real room");
});

test("start race: a meeting that is not SCHEDULED (already LIVE/ENDED/CANCELLED) is rejected without touching LiveKit", async () => {
  const db = makeFakeMeetingsTable({ id: "m3", status: "LIVE", room_name: "course-z-room-1" });
  const liveKitCalls = [];
  const fakeApi = { room: { createRoom: async () => { liveKitCalls.push("create"); } } };
  const deps = { supabase: db, liveKitApi: () => fakeApi };

  const result = await startMeetingCore("m3", deps);
  assert.equal(result.conflict, true);
  assert.equal(liveKitCalls.length, 0);
});
