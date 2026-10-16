import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  statistics,
  parkingReducer,
  randomUpdate,
} from "../src/services/parking.js";
test("initial four bays have the specified confirmed counts", () => {
  const state = initialState(1000);
  assert.deepEqual(statistics(state.spaces), {
    total: 4,
    available: 2,
    occupied: 2,
    unknown: 0,
  });
  assert.deepEqual(
    state.spaces.map((s) => s.status),
    ["occupied", "available", "occupied", "available"],
  );
});
test("unknown states reduce confirmed occupancy and create a timed event", () => {
  const state = parkingReducer(initialState(1000), {
    type: "update",
    spaceId: "P01",
    status: "unknown",
    time: 2000,
  });
  assert.deepEqual(statistics(state.spaces), {
    total: 4,
    available: 2,
    occupied: 1,
    unknown: 1,
  });
  assert.equal(state.events[0].spaceId, "P01");
  assert.equal(state.events[0].time, 2000);
});
test("duplicate states and malformed telemetry cannot add events or alter state", () => {
  const state = initialState();
  for (const action of [
    { spaceId: "P01", status: "occupied" },
    { spaceId: "P05", status: "occupied" },
    { spaceId: "P01", status: "invalid" },
  ])
    assert.equal(parkingReducer(state, { type: "update", ...action }), state);
});
test("rapid state changes have unique events and bounded newest-first history", () => {
  let state = initialState();
  for (let i = 0; i < 120; i++)
    state = parkingReducer(state, {
      type: "update",
      spaceId: "P01",
      status: i % 2 ? "occupied" : "available",
      time: i + 1000,
    });
  assert.equal(state.events.length, 100);
  assert.equal(new Set(state.events.map((e) => e.id)).size, 100);
  assert.equal(state.events[0].time, 1119);
});
test("auto simulation changes one slot, recovers unknowns, and reset restores initial state", () => {
  let state = parkingReducer(initialState(), {
    type: "update",
    spaceId: "P01",
    status: "unknown",
  });
  state = parkingReducer(
    state,
    randomUpdate(state.spaces, () => 0),
  );
  assert.equal(state.spaces[0].status, "occupied");
  assert.equal(state.events[0].source, "Auto simulation");
  state = parkingReducer(state, { type: "reset", time: 1000 });
  assert.deepEqual(state, initialState(1000));
});
