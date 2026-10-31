import {
  DEFAULT_THRESHOLD,
  DEFAULT_CLEAR_THRESHOLD,
  DEFAULT_BLINK_INTERVAL_MS,
  FIRE_OPENS_GATE,
} from "./temperatureAlarm.js";
const statuses = ["normal", "alarm", "unknown"];
export const unknownTemperature = () => ({
  temperature: null,
  threshold: DEFAULT_THRESHOLD,
  clearThreshold: DEFAULT_CLEAR_THRESHOLD,
  blinkIntervalMs: DEFAULT_BLINK_INTERVAL_MS,
  fireOpensGate: FIRE_OPENS_GATE,
  alarmActive: false,
  gateOpenRequested: false,
  status: "unknown",
  updatedAt: null,
  events: [],
  integrated: false,
});
function status(value) {
  const result = typeof value === "string" ? value.toLowerCase() : "";
  if (!statuses.includes(result)) throw new Error("Invalid temperature status");
  return result;
}
function time(value, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid temperature timestamp");
  return Date.parse(value);
}
function reading(value, nullable = false) {
  if (value === null && nullable) return null;
  if (!Number.isFinite(value) || value < -40 || value > 150)
    throw new Error("Invalid temperature reading");
  return value;
}
export function parseDeviceTemperature(data) {
  // Backward-compatible with a backend that has not applied the temperature upgrade yet.
  if (data === undefined) return unknownTemperature();
  if (!data || !Array.isArray(data.events) || data.events.length > 20)
    throw new Error("Invalid temperature snapshot");
  const currentStatus = status(data.status),
    temperature = reading(data.temperatureCelsius, true),
    threshold = reading(data.thresholdCelsius);
  const updatedAt = time(data.updatedAt, true);
  const legacy = data.clearThresholdCelsius === undefined;
  const clearThreshold = legacy
    ? threshold
    : reading(data.clearThresholdCelsius);
  const blinkIntervalMs = legacy
    ? DEFAULT_BLINK_INTERVAL_MS
    : data.blinkIntervalMs;
  const fireOpensGate = legacy ? false : data.fireOpensGate;
  const alarmActive = legacy ? currentStatus === "alarm" : data.alarmActive;
  const gateOpenRequested = legacy ? false : data.gateOpenRequested;
  if (
    !legacy &&
    (clearThreshold >= threshold ||
      !Number.isInteger(blinkIntervalMs) ||
      blinkIntervalMs < 300 ||
      blinkIntervalMs > 10000 ||
      typeof fireOpensGate !== "boolean" ||
      typeof alarmActive !== "boolean" ||
      typeof gateOpenRequested !== "boolean" ||
      gateOpenRequested !== (fireOpensGate && alarmActive))
  )
    throw new Error("Invalid alarm policy");
  if (
    currentStatus !== "unknown" &&
    (temperature === null ||
      updatedAt === null ||
      (legacy
        ? (currentStatus === "alarm") !== temperature > threshold
        : (currentStatus === "alarm") !== alarmActive ||
          (alarmActive
            ? temperature <= clearThreshold
            : temperature >= threshold)))
  )
    throw new Error("Inconsistent temperature status");
  if (currentStatus === "unknown" && temperature !== null)
    throw new Error("Unknown temperature must not imply a current reading");
  const ids = new Set();
  const events = data.events.map((event) => {
    if (
      !Number.isSafeInteger(event.id) ||
      event.id < 1 ||
      ids.has(event.id) ||
      event.deviceId !== "esp8266-01" ||
      !["DEVICE", "TIMEOUT"].includes(event.source)
    )
      throw new Error("Invalid temperature event");
    ids.add(event.id);
    return {
      id: `temperature-${event.id}`,
      status: status(event.status),
      previousStatus: status(event.previousStatus),
      temperature: reading(event.temperatureCelsius, true),
      threshold: reading(event.thresholdCelsius),
      clearThreshold: reading(
        event.clearThresholdCelsius ?? event.thresholdCelsius,
      ),
      gateOpenRequested: event.gateOpenRequested ?? null,
      time: time(event.time),
      source: event.source === "TIMEOUT" ? "Sensor timeout" : "Device sensor",
    };
  });
  return {
    temperature,
    threshold,
    clearThreshold,
    blinkIntervalMs,
    fireOpensGate,
    alarmActive,
    gateOpenRequested,
    status: currentStatus,
    updatedAt,
    events,
    integrated: true,
  };
}
