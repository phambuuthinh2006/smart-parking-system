import { SPACE_IDS, STATUSES, statistics } from "./parking.js";

export function emptyDeviceState() {
  const spaces = SPACE_IDS.map((id) => ({
    id,
    status: "unknown",
    updatedAt: null,
  }));
  return {
    revision: -1,
    spaces,
    events: [],
    stats: statistics(spaces),
    lastUpdate: null,
    generatedAt: null,
    staleAfterSeconds: 45,
    device: { id: "esp8266-01", online: false, lastSeenAt: null },
  };
}
const timestamp = (value, nullable = false) => {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid timestamp");
  return Date.parse(value);
};
const status = (value) => {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!STATUSES.includes(normalized)) throw new Error("Invalid parking status");
  return normalized;
};
// The device stream is a full snapshot. Never append sample events to it.
export function parseSnapshot(data) {
  if (
    !data ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    !Number.isInteger(data.staleAfterSeconds) ||
    data.staleAfterSeconds < 1 ||
    data.device?.id !== "esp8266-01" ||
    typeof data.device.online !== "boolean" ||
    !Array.isArray(data.spaces) ||
    data.spaces.length !== 4 ||
    !Array.isArray(data.events) ||
    data.events.length > 100
  )
    throw new Error("Invalid parking snapshot");
  const ids = new Set(data.spaces.map((s) => s.id));
  if (SPACE_IDS.some((id) => !ids.has(id)))
    throw new Error("Missing parking space");
  const spaces = SPACE_IDS.map((id) => {
    const space = data.spaces.find((s) => s.id === id);
    return {
      id,
      status: status(space.status),
      updatedAt: timestamp(space.updatedAt, true),
    };
  });
  const eventIds = new Set();
  const events = data.events.map((event) => {
    if (
      !SPACE_IDS.includes(event.spaceId) ||
      !Number.isSafeInteger(event.id) ||
      event.id < 1 ||
      eventIds.has(event.id) ||
      !["DEVICE", "TIMEOUT"].includes(event.source)
    )
      throw new Error("Invalid parking event");
    eventIds.add(event.id);
    return {
      id: `device-${event.id}`,
      spaceId: event.spaceId,
      status: status(event.status),
      time: timestamp(event.time),
      source: event.source === "DEVICE" ? "Device sensor" : "Sensor timeout",
    };
  });
  const device = {
    ...data.device,
    lastSeenAt: timestamp(data.device.lastSeenAt, true),
  };
  return {
    revision: data.revision,
    generatedAt: timestamp(data.generatedAt),
    staleAfterSeconds: data.staleAfterSeconds,
    device,
    spaces,
    events,
    stats: statistics(spaces),
    lastUpdate: device.lastSeenAt,
  };
}
export function newerSnapshot(current, next) {
  return next.revision >= current.revision ? next : current;
}

// Server age + elapsed local time avoids depending on synchronized browser clocks.
export function visibleDeviceState(snapshot, receivedAt, now) {
  const elapsed = receivedAt ? Math.max(0, now - receivedAt) : Infinity;
  const backendReachable = elapsed < 25000;
  const stale = (time) =>
    time === null ||
    snapshot.generatedAt - time + elapsed >= snapshot.staleAfterSeconds * 1000;
  const spaces = snapshot.spaces.map((space) => ({
    ...space,
    status:
      !backendReachable || stale(space.updatedAt) ? "unknown" : space.status,
  }));
  return {
    ...snapshot,
    spaces,
    stats: statistics(spaces),
    backendReachable,
    deviceOnline:
      backendReachable &&
      snapshot.device.online &&
      !stale(snapshot.device.lastSeenAt),
  };
}
