export const normalizePlate = (value) =>
  String(value)
    .toUpperCase()
    .replace(/[\s.-]/g, "");
export const validPlate = (value) =>
  /^[0-9]{2}[A-Z]{1,2}[0-9]{4,6}$/.test(normalizePlate(value));
export const activeVisit = (visit) =>
  ["PENDING_ENTRY", "INSIDE", "PENDING_EXIT"].includes(visit.status);
export const visitLabel = (status) =>
  ({
    PENDING_ENTRY: "Awaiting entry",
    INSIDE: "Inside",
    PENDING_EXIT: "Awaiting exit",
    EXITED: "Exited",
    CANCELLED: "Cancelled",
  })[status] || status;
export const outcomeLabel = (outcome) =>
  ({
    ENTRY_PENDING: "Đã duyệt xe vào. Đang chờ mạch mở cổng và phản hồi xe qua.",
    EXIT_PENDING: "Đã duyệt xe ra. Đang chờ mạch phản hồi xe qua.",
    AUTO_PASSAGE_CONFIRMED: "Mạch đã hoàn tất chu kỳ; lượt xe được ghi tự động.",
    AUTO_CANCELLED_CLOSE: "Mạch hủy yêu cầu vì không thấy xe; không ghi lượt qua.",
    ALREADY_INSIDE: "This plate is already inside; no new visit created.",
    INVALID_PLATE: "OCR text is not a supported plate. No open request sent.",
    NOT_REGISTERED: "Plate is not registered. No open request sent.",
    NOT_INSIDE: "No active visit found for this plate.",
    BARRIER_BUSY: "Another passage is pending. Finish or cancel it first.",
    CAPACITY_REACHED: "The tracked-visit capacity is full.",
    FIRE_OVERRIDE: "Fire override requests the barrier remain open.",
    PASSAGE_CONFIRMED:
      "Passage confirmed. Visit updated; barrier close requested.",
    MANUAL_OPEN: "Barrier open requested. No visit was created.",
    CANCELLED_CLOSE: "Pending passage cancelled; barrier close requested.",
  })[outcome] || outcome;
export function emptyAccess() {
  return {
    integrated: false,
    simulationEnabled: false,
    barrier: {
      position: "UNKNOWN",
      version: 0,
      pendingVisitId: null,
      pendingPlate: null,
      direction: null,
      reason: "IDLE",
      fireOverride: false,
      hardwareConnected: false,
    },
    stats: {
      inside: 0,
      pendingEntry: 0,
      pendingExit: 0,
      exited: 0,
      capacity: 4,
    },
    visits: [],
    events: [],
  };
}
export function initialAccessSimulation() {
  const state = emptyAccess();
  return {
    ...state,
    integrated: true,
    simulationEnabled: true,
    barrier: { ...state.barrier, position: "CLOSED" },
    sequence: 0,
  };
}
const timestamp = (v, nullable = false) => {
  if (v === null && nullable) return null;
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
    throw new Error("Invalid access timestamp");
  return v;
};
export function parseAccess(data) {
  if (data === undefined) return emptyAccess();
  if (
    !data ||
    !data.barrier ||
    !data.stats ||
    !Array.isArray(data.visits) ||
    data.visits.length > 100 ||
    !Array.isArray(data.events) ||
    data.events.length > 30 ||
    typeof data.simulationEnabled !== "boolean"
  )
    throw new Error("Invalid vehicle access snapshot");
  const b = data.barrier;
  if (
    !["OPEN", "CLOSED"].includes(b.position) ||
    !Number.isSafeInteger(b.version) ||
    b.version < 0 ||
    typeof b.fireOverride !== "boolean" ||
    typeof b.hardwareConnected !== "boolean" ||
    (b.actualPosition !== undefined && !["OPEN", "CLOSED", "UNKNOWN"].includes(b.actualPosition)) ||
    !(b.pendingVisitId === null || Number.isSafeInteger(b.pendingVisitId))
  )
    throw new Error("Invalid virtual barrier");
  const stats = data.stats;
  for (const key of [
    "inside",
    "pendingEntry",
    "pendingExit",
    "exited",
    "capacity",
  ])
    if (!Number.isSafeInteger(stats[key]) || stats[key] < 0)
      throw new Error("Invalid visit statistics");
  if (
    stats.capacity !== 4 ||
    stats.inside + stats.pendingEntry > 4 ||
    stats.pendingExit > stats.inside
  )
    throw new Error("Invalid visit capacity");
  const ids = new Set();
  const visits = data.visits.map((v) => {
    if (
      !Number.isSafeInteger(v.id) ||
      v.id < 1 ||
      ids.has(v.id) ||
      !validPlate(v.plate) ||
      ![
        "PENDING_ENTRY",
        "INSIDE",
        "PENDING_EXIT",
        "EXITED",
        "CANCELLED",
      ].includes(v.status) ||
      !["CAMERA", "SIMULATION"].includes(v.source)
    )
      throw new Error("Invalid vehicle visit");
    ids.add(v.id);
    return {
      ...v,
      createdAt: timestamp(v.createdAt),
      entryAt: timestamp(v.entryAt, true),
      exitAt: timestamp(v.exitAt, true),
    };
  });
  const eventIds = new Set();
  const events = data.events.map((e) => {
    if (
      !Number.isSafeInteger(e.id) ||
      e.id < 1 ||
      eventIds.has(e.id) ||
      !["CAMERA", "SIMULATION", "DEVICE"].includes(e.source) ||
      typeof e.outcome !== "string" ||
      (e.plate !== null && !validPlate(e.plate)) ||
      (e.confidence !== null &&
        (!Number.isFinite(e.confidence) ||
          e.confidence < 0.75 ||
          e.confidence > 1))
    )
      throw new Error("Invalid access event");
    eventIds.add(e.id);
    return { ...e, time: timestamp(e.time) };
  });
  return { ...data, visits, events, integrated: true };
}
export function localAccessAction(
  state,
  action,
  fireOverride = false,
  now = Date.now(),
) {
  const at = new Date(now).toISOString();
  let next = structuredClone(state),
    outcome,
    visitId = null;
  const b = next.barrier;
  if (fireOverride) return { state, outcome: "FIRE_OVERRIDE" };
  if (action.kind === "DETECTION") {
    if (!validPlate(action.plate))
      throw new Error("Use a plate such as 43A-123.45.");
    const plate = normalizePlate(action.plate),
      current = next.visits.find((v) => v.plate === plate && activeVisit(v));
    if (action.direction === "ENTRY" && current) {
      outcome =
        current.status === "PENDING_ENTRY" ? "ENTRY_PENDING" : "ALREADY_INSIDE";
      visitId = current.id;
    } else if (action.direction === "EXIT" && !current) outcome = "NOT_INSIDE";
    else if (b.position === "OPEN") outcome = "BARRIER_BUSY";
    else if (action.direction === "ENTRY") {
      if (next.visits.filter(activeVisit).length >= 4)
        outcome = "CAPACITY_REACHED";
      else {
        visitId = ++next.sequence;
        next.visits.unshift({
          id: visitId,
          plate,
          status: "PENDING_ENTRY",
          source: "SIMULATION",
          createdAt: at,
          entryAt: null,
          exitAt: null,
        });
        outcome = "ENTRY_PENDING";
      }
    } else {
      visitId = current.id;
      current.status = "PENDING_EXIT";
      outcome = "EXIT_PENDING";
    }
    if (
      visitId &&
      ["ENTRY_PENDING", "EXIT_PENDING"].includes(outcome) &&
      b.position !== "OPEN"
    ) {
      Object.assign(b, {
        position: "OPEN",
        version: b.version + 1,
        pendingVisitId: visitId,
        pendingPlate: plate,
        direction: action.direction,
        reason: action.direction,
      });
    }
  } else {
    visitId = b.pendingVisitId;
    const current = next.visits.find((v) => v.id === visitId);
    if (action.kind === "OPEN") {
      if (b.position === "OPEN")
        throw new Error("Virtual barrier already open.");
      Object.assign(b, {
        position: "OPEN",
        version: b.version + 1,
        reason: "MANUAL",
      });
      outcome = "MANUAL_OPEN";
    } else {
      if (b.position !== "OPEN")
        throw new Error("Virtual barrier is already closed.");
      if (current) {
        if (action.kind === "PASSAGE") {
          current.status = b.direction === "ENTRY" ? "INSIDE" : "EXITED";
          current[b.direction === "ENTRY" ? "entryAt" : "exitAt"] = at;
        } else
          current.status = b.direction === "ENTRY" ? "CANCELLED" : "INSIDE";
      }
      outcome =
        action.kind === "PASSAGE" ? "PASSAGE_CONFIRMED" : "CANCELLED_CLOSE";
      Object.assign(b, {
        position: "CLOSED",
        version: b.version + 1,
        pendingVisitId: null,
        pendingPlate: null,
        direction: null,
        reason: "IDLE",
      });
    }
  }
  next.events.unshift({
    id: ++next.sequence,
    eventId: action.eventId || String(next.sequence),
    kind: action.kind,
    plate: action.plate
      ? normalizePlate(action.plate)
      : state.barrier.pendingPlate,
    direction: action.direction || state.barrier.direction,
    confidence: action.kind === "DETECTION" ? 1 : null,
    cameraId: "web-demo",
    source: "SIMULATION",
    outcome,
    visitId,
    time: at,
  });
  next.events = next.events.slice(0, 30);
  next.visits.sort(
    (a, b) => Number(activeVisit(b)) - Number(activeVisit(a)) || b.id - a.id,
  );
  next.visits = next.visits.slice(0, 100);
  next.stats = {
    inside: next.visits.filter((v) =>
      ["INSIDE", "PENDING_EXIT"].includes(v.status),
    ).length,
    pendingEntry: next.visits.filter((v) => v.status === "PENDING_ENTRY")
      .length,
    pendingExit: next.visits.filter((v) => v.status === "PENDING_EXIT").length,
    exited: next.visits.filter((v) => v.status === "EXITED").length,
    capacity: 4,
  };
  return { state: next, outcome };
}
