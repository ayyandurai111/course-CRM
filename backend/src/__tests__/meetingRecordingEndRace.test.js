const test = require("node:test");
const assert = require("node:assert/strict");
const { markRecordingProcessingIfActive } = require("../routes/meetings.routes");

function fakeDb(initial) {
  const state = { ...initial };
  return {
    state,
    from(table) {
      assert.equal(table, "meetings");
      let filters = {};
      const chain = {
        update(patch) {
          return {
            eq(column, value) {
              filters[column] = value;
              return this;
            },
            then(resolve) {
              const matches = Object.entries(filters).every(([k, v]) => state[k] === v);
              if (matches) Object.assign(state, patch);
              resolve({ error: null });
            },
          };
        },
      };
      return chain;
    },
  };
}

test("recording transition: RECORDING -> PROCESSING is conditional and succeeds while active", async () => {
  const db = fakeDb({ id: "m1", recording_status: "RECORDING" });
  await markRecordingProcessingIfActive("m1", db);
  assert.equal(db.state.recording_status, "PROCESSING");
});

test("recording transition: webhook can win the race; READY is never regressed to PROCESSING", async () => {
  const db = fakeDb({ id: "m2", recording_status: "READY" });
  await markRecordingProcessingIfActive("m2", db);
  assert.equal(db.state.recording_status, "READY");
});

test("recording transition: FAILED is never overwritten by meeting end", async () => {
  const db = fakeDb({ id: "m3", recording_status: "FAILED" });
  await markRecordingProcessingIfActive("m3", db);
  assert.equal(db.state.recording_status, "FAILED");
});
