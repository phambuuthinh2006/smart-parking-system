import test from "node:test";
import assert from "node:assert/strict";
import {
  initialTemperatureState,
  temperatureReducer,
} from "../src/services/temperatureAlarm.js";
test("firmware hysteresis latches at 50, holds at 47 and clears at 45", () => {
  let s = initialTemperatureState(1000);
  assert.equal(s.threshold, 50);
  assert.equal(s.clearThreshold, 45);
  assert.equal(s.blinkIntervalMs, 300);
  assert.equal(s.fireOpensGate, true);
  for (const [temperature, status, gate] of [
    [49, "normal", false],
    [50, "alarm", true],
    [47, "alarm", true],
    [49, "alarm", true],
    [45, "normal", false],
    [47, "normal", false],
    [50, "alarm", true],
  ]) {
    s = temperatureReducer(s, { type: "temperature", value: temperature });
    assert.equal(s.status, status);
    assert.equal(s.gateOpenRequested, gate);
  }
  assert.deepEqual(
    s.events.map((e) => e.status),
    ["alarm", "normal", "alarm"],
  );
});
test("demo threshold edits retain valid OFF < ON and reevaluate the latch", () => {
  let s = temperatureReducer(initialTemperatureState(), {
    type: "temperature",
    value: 48,
  });
  s = temperatureReducer(s, { type: "threshold", value: 47 });
  assert.equal(s.status, "alarm");
  s = temperatureReducer(s, { type: "clearThreshold", value: 46 });
  assert.equal(s.status, "alarm");
  s = temperatureReducer(s, { type: "temperature", value: 46 });
  assert.equal(s.status, "normal");
  s = temperatureReducer(s, { type: "threshold", value: 40 });
  assert.equal(s.clearThreshold, 39);
  assert.equal(s.status, "alarm");
});
test("invalid and duplicate inputs do not corrupt the simulated sensor", () => {
  const s = initialTemperatureState();
  for (const action of [
    { type: "temperature", value: NaN },
    { type: "temperature", value: Infinity },
    { type: "temperature", value: -1 },
    { type: "temperature", value: 121 },
    { type: "temperature", value: "90" },
    { type: "temperature", value: 27 },
    { type: "threshold", value: 0 },
    { type: "threshold", value: 101 },
    { type: "clearThreshold", value: 50 },
    { type: "clearThreshold", value: -1 },
    { type: "not-a-sensor", value: 90 },
  ])
    assert.equal(temperatureReducer(s, action), s);
});
test("continued heat does not repeat alarm events; reset restores firmware policy", () => {
  let s = temperatureReducer(initialTemperatureState(), {
    type: "temperature",
    value: 50,
  });
  s = temperatureReducer(s, { type: "temperature", value: 47 });
  assert.equal(s.events.length, 1);
  for (let i = 0; i < 50; i++)
    s = temperatureReducer(s, {
      type: "temperature",
      value: i % 2 ? 50 : 27,
      time: 1000 + i,
    });
  assert.equal(s.events.length, 20);
  assert.equal(new Set(s.events.map((e) => e.id)).size, 20);
  assert.deepEqual(
    temperatureReducer(s, { type: "reset", time: 5000 }),
    initialTemperatureState(5000),
  );
});
