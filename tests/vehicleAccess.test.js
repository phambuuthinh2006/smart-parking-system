import test from "node:test";
import assert from "node:assert/strict";
import {
  initialAccessSimulation,
  localAccessAction,
  validPlate,
  parseAccess,
  formatPlateDisplay,
} from "../src/services/vehicleAccess.js";
const detect = (state, plate, direction = "ENTRY") =>
  localAccessAction(state, { kind: "DETECTION", plate, direction }).state;
const pass = (state) => localAccessAction(state, { kind: "PASSAGE" }).state;
test("entry and exit timestamps require explicit passage; repeated entry cannot create visits", () => {
  let state = detect(initialAccessSimulation(), "43A-123.45");
  assert.equal(state.stats.inside, 0);
  assert.equal(state.visits[0].entryAt, null);
  state = pass(state);
  state = detect(state, "43A12345");
  assert.equal(state.visits.length, 1);
  assert.equal(state.stats.inside, 1);
  state = detect(state, "43A12345", "EXIT");
  assert.equal(state.stats.inside, 1);
  assert.equal(state.visits[0].exitAt, null);
  state = pass(state);
  assert.equal(state.stats.inside, 0);
  assert.equal(state.stats.exited, 1);
  assert.ok(state.visits[0].entryAt && state.visits[0].exitAt);
});
test("gate busy, cancellation, capacity and fire override preserve ledger invariants", () => {
  let state = detect(initialAccessSimulation(), "43A12345");
  assert.equal(detect(state, "43A12346").visits.length, 1);
  state = localAccessAction(state, { kind: "CLOSE" }).state;
  assert.equal(state.visits[0].status, "CANCELLED");
  assert.equal(state.visits[0].entryAt, null);
  for (let i = 0; i < 4; i++) state = pass(detect(state, `43A1234${i}`));
  assert.equal(
    localAccessAction(state, {
      kind: "DETECTION",
      plate: "43A12349",
      direction: "ENTRY",
    }).outcome,
    "CAPACITY_REACHED",
  );
  assert.equal(localAccessAction(state, { kind: "OPEN" }, true).state, state);
  assert.equal(state.stats.inside, 4);
});
test("plate validation rejects OCR noise; older backend has no fabricated vehicle history", () => {
  assert.ok(validPlate("43-A1 123.45"));
  assert.equal(validPlate("car"), false);
  assert.equal(validPlate("43A12345<script>"), false);
  assert.equal(parseAccess(undefined).barrier.position, "UNKNOWN");
  assert.throws(() => parseAccess({}), /Invalid/);
});

test("hardware feedback and DEVICE passage events are accepted without inventing a visit", () => {
  const state = detect(initialAccessSimulation(), "43A12345");
  state.barrier.hardwareConnected = true;
  state.barrier.actualPosition = "OPEN";
  state.barrier.hardwarePhase = "OPEN";
  state.events[0].source = "DEVICE";
  state.events[0].outcome = "AUTO_PASSAGE_CONFIRMED";
  assert.equal(parseAccess(state).barrier.actualPosition, "OPEN");
  state.barrier.actualPosition = "made-up";
  assert.throws(() => parseAccess(state), /Invalid/);
});

test("formatPlateDisplay formats standard Vietnamese plates cleanly", () => {
  assert.equal(formatPlateDisplay("36H12345"), "36H-123.45");
  assert.equal(formatPlateDisplay("43A99999"), "43A-999.99");
  assert.equal(formatPlateDisplay("29B1234"), "29B-1234");
  assert.equal(formatPlateDisplay("51LD12345"), "51LD-123.45");
  assert.equal(formatPlateDisplay(""), "");
});
