export const TEMPERATURE_LIMITS = { min: 0, max: 120 };
export const THRESHOLD_LIMITS = { min: 30, max: 100 };
export const DEFAULT_TEMPERATURE = 27;
export const DEFAULT_THRESHOLD = 50;
export const DEFAULT_CLEAR_THRESHOLD = 45;
export const DEFAULT_BLINK_INTERVAL_MS = 300;
export const FIRE_OPENS_GATE = true;

// Firmware hysteresis: latch at >= ON, clear at <= OFF, retain between them.
export const temperatureStatus = (
  temperature,
  threshold,
  clearThreshold,
  wasAlarm,
) =>
  (wasAlarm ? temperature > clearThreshold : temperature >= threshold)
    ? "alarm"
    : "normal";
export function initialTemperatureState(now = Date.now()) {
  return {
    temperature: DEFAULT_TEMPERATURE,
    threshold: DEFAULT_THRESHOLD,
    clearThreshold: DEFAULT_CLEAR_THRESHOLD,
    blinkIntervalMs: DEFAULT_BLINK_INTERVAL_MS,
    fireOpensGate: FIRE_OPENS_GATE,
    alarmActive: false,
    gateOpenRequested: false,
    status: "normal",
    events: [],
    sequence: 0,
    updatedAt: now,
  };
}
export function temperatureReducer(state, action) {
  if (action.type === "reset") return initialTemperatureState(action.time);
  if (!["temperature", "threshold", "clearThreshold"].includes(action.type))
    return state;
  const limits =
    action.type === "temperature"
      ? TEMPERATURE_LIMITS
      : action.type === "threshold"
        ? THRESHOLD_LIMITS
        : { min: 0, max: state.threshold - 1 };
  if (
    !Number.isFinite(action.value) ||
    action.value < limits.min ||
    action.value > limits.max ||
    state[action.type] === action.value
  )
    return state;
  const next = {
    ...state,
    [action.type]: action.value,
    updatedAt: action.time ?? Date.now(),
  };
  if (next.clearThreshold >= next.threshold)
    next.clearThreshold = next.threshold - 1;
  next.status = temperatureStatus(
    next.temperature,
    next.threshold,
    next.clearThreshold,
    state.alarmActive,
  );
  next.alarmActive = next.status === "alarm";
  next.gateOpenRequested = next.fireOpensGate && next.alarmActive;
  if (next.status !== state.status) {
    next.sequence++;
    next.events = [
      {
        id: next.sequence,
        status: next.status,
        temperature: next.temperature,
        threshold: next.threshold,
        clearThreshold: next.clearThreshold,
        gateOpenRequested: next.gateOpenRequested,
        time: next.updatedAt,
      },
      ...state.events,
    ].slice(0, 20);
  }
  return next;
}
export function temperatureEventLabel(event) {
  if (event.status === "unknown") return "Sensor data unavailable";
  if (event.status === "alarm") return "Heat alert activated";
  return event.previousStatus === "unknown"
    ? "Sensor data received"
    : "Heat alert cleared";
}
