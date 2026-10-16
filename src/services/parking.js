export const SPACE_IDS = ["P01", "P02", "P03", "P04"];
export const STATUSES = ["available", "occupied", "unknown"];
export const initialSpaces = () =>
  SPACE_IDS.map((id, i) => ({
    id,
    status: i % 2 === 0 ? "occupied" : "available",
  }));
export function initialState(now = Date.now()) {
  const spaces = initialSpaces();
  return {
    spaces,
    events: [...spaces]
      .reverse()
      .map((space, i) => ({
        ...space,
        id: `initial-${space.id}`,
        spaceId: space.id,
        time: now - i * 37000,
        source: "Sample data",
      })),
    sequence: 0,
    lastUpdate: now,
  };
}
export function statistics(spaces) {
  return {
    total: spaces.length,
    available: spaces.filter((s) => s.status === "available").length,
    occupied: spaces.filter((s) => s.status === "occupied").length,
    unknown: spaces.filter((s) => s.status === "unknown").length,
  };
}
// All data sources enter through this reducer. A future HTTP/Socket.IO adapter can
// dispatch the same update action after validating telemetry, without changing the UI.
export function parkingReducer(state, action) {
  if (action.type === "reset") return initialState(action.time);
  if (
    action.type !== "update" ||
    !SPACE_IDS.includes(action.spaceId) ||
    !STATUSES.includes(action.status)
  )
    return state;
  if (
    state.spaces.find((s) => s.id === action.spaceId).status === action.status
  )
    return state;
  const time = action.time ?? Date.now();
  const sequence = state.sequence + 1;
  return {
    spaces: state.spaces.map((s) =>
      s.id === action.spaceId ? { ...s, status: action.status } : s,
    ),
    events: [
      {
        id: `event-${sequence}`,
        spaceId: action.spaceId,
        status: action.status,
        time,
        source: action.source ?? "Manual simulation",
      },
      ...state.events,
    ].slice(0, 100),
    sequence,
    lastUpdate: time,
  };
}
export function randomUpdate(spaces, random = Math.random) {
  const slot = spaces[Math.floor(random() * spaces.length)];
  return {
    type: "update",
    spaceId: slot.id,
    status: slot.status === "occupied" ? "available" : "occupied",
    source: "Auto simulation",
  };
}
