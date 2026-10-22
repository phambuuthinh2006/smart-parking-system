import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyDeviceState,
  newerSnapshot,
  parseSnapshot,
  visibleDeviceState,
} from "../src/services/deviceParking.js";
const time = "2026-10-22T03:00:00Z";
function fixture() {
  return {
    revision: 1,
    generatedAt: time,
    staleAfterSeconds: 45,
    device: { id: "esp8266-01", online: true, lastSeenAt: time },
    spaces: ["P01", "P02", "P03", "P04"].map((id, i) => ({
      id,
      status: i % 2 ? "AVAILABLE" : "OCCUPIED",
      updatedAt: time,
    })),
    events: [
      { id: 1, spaceId: "P01", status: "OCCUPIED", time, source: "DEVICE" },
    ],
  };
}
test("Device Mode starts with four unknown spaces and no sample history", () => {
  const state = emptyDeviceState();
  assert.deepEqual(state.stats, {
    total: 4,
    available: 0,
    occupied: 0,
    unknown: 4,
  });
  assert.deepEqual(state.events, []);
});
test("device adapter derives counts and accepts only the four known bays", () => {
  const state = parseSnapshot(fixture());
  assert.equal(state.stats.occupied, 2);
  assert.equal(state.events[0].source, "Device sensor");
  const bad = fixture();
  bad.spaces[3].id = "P01";
  assert.throws(() => parseSnapshot(bad));
  for (const mutate of [
    (d) => (d.events[0].time = "wrong"),
    (d) => (d.spaces[0].status = "empty"),
    (d) => (d.revision = -1),
    (d) => (d.device.online = "true"),
    (d) => (d.events[0].source = "=malicious"),
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => parseSnapshot(data));
  }
});
test("older HTTP snapshots cannot overwrite a newer WebSocket revision", () => {
  const state = parseSnapshot(fixture());
  assert.equal(newerSnapshot(state, { ...state, revision: 0 }), state);
  assert.equal(newerSnapshot(state, { ...state, revision: 2 }).revision, 2);
});
test("backend silence masks stale occupancy without discarding history", () => {
  const state = parseSnapshot(fixture());
  assert.equal(visibleDeviceState(state, 1000, 2000).deviceOnline, true);
  const stale = visibleDeviceState(state, 1000, 27000);
  assert.equal(stale.deviceOnline, false);
  assert.equal(stale.stats.unknown, 4);
  assert.equal(stale.events.length, 1);
});
test("heartbeat cannot revive stale sensor readings even if backend is reachable", () => {
  const state = parseSnapshot(fixture());
  state.generatedAt += 46000;
  state.device.lastSeenAt = state.generatedAt;
  const view = visibleDeviceState(state, 1000, 1000);
  assert.equal(view.deviceOnline, true);
  assert.equal(view.stats.unknown, 4);
});
