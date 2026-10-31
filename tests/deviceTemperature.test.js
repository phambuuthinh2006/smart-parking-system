import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDeviceTemperature,
  unknownTemperature,
} from "../src/services/deviceTemperature.js";
import {
  parseSnapshot,
  visibleDeviceState,
} from "../src/services/deviceParking.js";
import { temperatureEventLabel } from "../src/services/temperatureAlarm.js";
const time = "2026-10-31T09:00:00Z";
function sensor() {
  return {
    temperatureCelsius: 50,
    thresholdCelsius: 50,
    clearThresholdCelsius: 45,
    blinkIntervalMs: 300,
    fireOpensGate: true,
    alarmActive: true,
    gateOpenRequested: true,
    status: "ALARM",
    updatedAt: time,
    events: [
      {
        id: 1,
        deviceId: "esp8266-01",
        previousStatus: "NORMAL",
        status: "ALARM",
        temperatureCelsius: 50,
        thresholdCelsius: 80,
        time,
        source: "DEVICE",
      },
    ],
  };
}
function snapshot() {
  return {
    revision: 1,
    generatedAt: time,
    staleAfterSeconds: 45,
    device: { id: "esp8266-01", online: true, lastSeenAt: time },
    spaces: ["P01", "P02", "P03", "P04"].map((id) => ({
      id,
      status: "AVAILABLE",
      updatedAt: time,
    })),
    events: [],
    temperature: sensor(),
  };
}
test("older backend has unknown temperature instead of fictitious normal readings", () => {
  assert.deepEqual(parseDeviceTemperature(undefined), unknownTemperature());
  const data = snapshot();
  delete data.temperature;
  assert.equal(parseSnapshot(data).temperature.status, "unknown");
});
test("device temperature validates strict threshold consistency and typed history", () => {
  const data = parseDeviceTemperature(sensor());
  assert.equal(data.status, "alarm");
  assert.equal(data.temperature, 50);
  assert.equal(data.integrated, true);
  assert.equal(data.events[0].source, "Device sensor");
  for (const mutate of [
    (d) => (d.temperatureCelsius = 45),
    (d) => (d.temperatureCelsius = "50"),
    (d) => (d.updatedAt = null),
    (d) => (d.events[0].deviceId = "other"),
    (d) => d.events.push(d.events[0]),
    (d) => (d.status = "safe"),
  ]) {
    const input = sensor();
    mutate(input);
    assert.throws(() => parseDeviceTemperature(input));
  }
  const cold = sensor();
  cold.temperatureCelsius = 49;
  cold.status = "NORMAL";
  cold.alarmActive = false;
  cold.gateOpenRequested = false;
  assert.equal(parseDeviceTemperature(cold).status, "normal");
  const held = sensor();
  held.temperatureCelsius = 47;
  assert.equal(parseDeviceTemperature(held).status, "alarm");
  const badGate = sensor();
  badGate.gateOpenRequested = false;
  assert.throws(() => parseDeviceTemperature(badGate));
  const badPolicy = sensor();
  badPolicy.clearThresholdCelsius = 50;
  assert.throws(() => parseDeviceTemperature(badPolicy));
});
test("fresh parking and heartbeat cannot revive expired temperature telemetry", () => {
  const data = snapshot();
  data.generatedAt = "2026-10-31T09:00:46Z";
  data.device.lastSeenAt = data.generatedAt;
  data.spaces.forEach((s) => (s.updatedAt = data.generatedAt));
  const view = visibleDeviceState(parseSnapshot(data), 1000, 1000);
  assert.equal(view.deviceOnline, true);
  assert.equal(view.stats.available, 4);
  assert.equal(view.temperature.status, "unknown");
  assert.equal(view.temperature.temperature, null);
  assert.equal(view.temperature.events.length, 1);
});
test("backend loss masks temperature without deleting persisted alarm history", () => {
  const view = visibleDeviceState(parseSnapshot(snapshot()), 1000, 27000);
  assert.equal(view.backendReachable, false);
  assert.equal(view.temperature.status, "unknown");
  assert.equal(view.temperature.temperature, null);
  assert.equal(view.temperature.alarmActive, true);
  assert.equal(view.temperature.gateOpenRequested, true);
  assert.equal(view.temperature.events.length, 1);
});
test("sensor timeouts are not displayed as heat alert cleared", () => {
  assert.equal(
    temperatureEventLabel({ previousStatus: "alarm", status: "unknown" }),
    "Sensor data unavailable",
  );
  assert.equal(
    temperatureEventLabel({ previousStatus: "unknown", status: "normal" }),
    "Sensor data received",
  );
  assert.equal(
    temperatureEventLabel({ previousStatus: "alarm", status: "normal" }),
    "Heat alert cleared",
  );
});
