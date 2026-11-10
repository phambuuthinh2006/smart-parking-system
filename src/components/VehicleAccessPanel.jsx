import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ArrowRight,
  ArrowDownToLine,
  DoorOpen,
  DoorClosed,
  Check,
  RotateCcw,
  CarFront,
  FlaskConical,
  LoaderCircle,
} from "lucide-react";
import {
  initialAccessSimulation,
  localAccessAction,
  emptyAccess,
  validPlate,
  normalizePlate,
  visitLabel,
  outcomeLabel,
} from "../services/vehicleAccess";
import { formatTime } from "./ActivityHistory";
import "./VehicleAccessPanel.css";
export default function VehicleAccessPanel({
  simulation,
  telemetry,
  reachable,
  fireOverride,
  onServerAction,
}) {
  const [local, setLocal] = useState(initialAccessSimulation),
    [plate, setPlate] = useState("43A-123.45"),
    [direction, setDirection] = useState("ENTRY"),
    [filter, setFilter] = useState(""),
    [info, setInfo] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [clearConfirmed, setClearConfirmed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const state = simulation ? local : telemetry || emptyAccess();
  const barrier =
    simulation && fireOverride
      ? {
          ...state.barrier,
          position: "OPEN",
          fireOverride: true,
          reason: "FIRE_OVERRIDE",
        }
      : state.barrier;
  useEffect(() => {
    setClearConfirmed(false);
  }, [simulation, barrier.version, barrier.fireOverride]);
  const disabled =
    busy ||
    (!simulation &&
      (!reachable || !state.integrated || !state.simulationEnabled));
  const shownPosition = !simulation && barrier.hardwareConnected
    ? barrier.actualPosition || "UNKNOWN" : barrier.position;
  async function act(kind) {
    if (disabled) return;
    if (!simulation && ["PASSAGE", "CLOSE"].includes(kind) && !clearConfirmed) {
      setError("Confirm that the vehicle has passed and the barrier area is clear.");
      return;
    }
    setError("");
    setInfo("");
    if (kind === "DETECTION" && !validPlate(plate)) {
      setError("Enter a supported plate, for example 43A-123.45.");
      return;
    }
    setBusy(true);
    try {
      const eventId = crypto.randomUUID();
      let outcome;
      if (simulation) {
        const result = localAccessAction(
          local,
          { kind, plate, direction, eventId },
          barrier.fireOverride,
        );
        setLocal(result.state);
        outcome = result.outcome;
      } else {
        const body =
          kind === "DETECTION"
            ? {
                eventId,
                plate: normalizePlate(plate),
                direction,
                confidence: 1,
                cameraId: "web-demo",
              }
            : { eventId, action: kind, expectedVersion: barrier.version };
        const result = await onServerAction(
          kind === "DETECTION" ? "detections" : "barrier",
          body,
        );
        outcome = result.outcome;
      }
      if (mounted.current) {
        setInfo(outcomeLabel(outcome));
        setClearConfirmed(false);
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e.name === "TimeoutError"
            ? "Response timed out; the request may have been saved. Check the refreshed state before retrying."
            : e.message,
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const filtered = state.visits.filter((v) =>
    v.plate.includes(normalizePlate(filter)),
  );
  return (
    <section
      className="panel access-panel"
      aria-label="Vehicle access management"
    >
      <div className="access-heading">
        <span className="access-icon">
          <Camera size={21} />
        </span>
        <div>
          <h2>Vehicle access</h2>
          <p>Plate recognition, visit history and barrier requests.</p>
        </div>
        <span className="access-source">
          {simulation ? "Local simulation" : "PostgreSQL · live feed"}
        </span>
      </div>
      <div className="access-layout">
        <div className="access-barrier">
          <div className="access-barrier-caption">
            <strong>{simulation ? "Virtual barrier" : barrier.hardwareConnected ? "Barie · phản hồi Uno" : "Yêu cầu barie · chưa có phản hồi mạch"}</strong>
            <span
              className={`access-position access-${shownPosition.toLowerCase()}`}
            >
              {shownPosition}
            </span>
          </div>
          <div
            className={`barrier-scene ${shownPosition === "OPEN" ? "is-open" : ""} ${shownPosition === "UNKNOWN" ? "is-unknown" : ""}`}
            aria-hidden="true"
          >
            <div className="barrier-road">
              <CarFront size={43} />
              <ArrowRight size={20} />
            </div>
            <div className="barrier-post" />
            <div className="barrier-arm" />
            <span>ENTRY / EXIT</span>
          </div>
          <p className="access-barrier-reason">
            {barrier.fireOverride
              ? "Fire override: virtual barrier held open."
              : barrier.pendingPlate
                ? `${barrier.pendingPlate} · ${barrier.direction === "ENTRY" ? "waiting to enter" : "waiting to exit"}`
                : (state.stats.pendingParking || 0) > 0
                  ? "Xe đã qua cổng; chờ cảm biến P01 xác nhận vào ô."
                : barrier.position === "UNKNOWN"
                  ? "Waiting for backend confirmation."
                  : "Ready for the next detection."}
          </p>
          {!simulation && <p className="access-barrier-reason">
            {barrier.hardwareConnected
              ? `Tự động · Uno: ${barrier.hardwarePhase} · Yêu cầu: ${barrier.position}`
              : "Mạch chưa kết nối hoặc dữ liệu đã cũ. Chạy main.py và kiểm tra firmware protocol 2."}
            {barrier.hardwarePhase === "BLOCKED" && " · Cảm biến không hợp lệ: giữ cổng, chưa ghi lượt xe."}
          </p>}
          <div className="access-counts">
            <span>
              <strong>{state.stats.inside}</strong> tracked inside
            </span>
            <span>
              <strong>{state.stats.pendingEntry}</strong> awaiting entry
            </span>
            <span><strong>{state.stats.pendingParking || 0}</strong> chờ vào ô</span>
            <span>
              <strong>{state.stats.capacity}</strong> visit capacity
            </span>
          </div>
          <details open={simulation} className="access-manual-controls">
          <summary>{simulation ? "Simulation controls" : "Điều khiển thủ công / xử lý sự cố"}</summary>
          {!simulation && (
            <label className="access-clear-confirmation">
              <input type="checkbox" checked={clearConfirmed}
                onChange={(event) => setClearConfirmed(event.target.checked)} />{" "}
              Vehicle has passed; the barrier area is clear.
            </label>
          )}
          <div className="access-buttons">
            <button
              type="button"
              disabled={
                disabled || barrier.position !== "OPEN" || barrier.fireOverride || (!simulation && !clearConfirmed)
              }
              onClick={() => act("PASSAGE")}
            >
              <Check size={14} /> Confirm passage
            </button>
            <button
              type="button"
              disabled={
                disabled ||
                barrier.position !== "CLOSED" ||
                barrier.fireOverride
              }
              onClick={() => act("OPEN")}
            >
              <DoorOpen size={14} /> {simulation ? "Open virtual gate" : "Request open"}
            </button>
            <button
              type="button"
              disabled={
                disabled || barrier.position !== "OPEN" || barrier.fireOverride || (!simulation && !clearConfirmed)
              }
              onClick={() => act("CLOSE")}
            >
              <DoorClosed size={14} /> Cancel / close
            </button>
          </div>
          </details>
        </div>
        <div className="access-input">
          <h3>
            <FlaskConical size={15} />{" "}
            {simulation
              ? "Camera event simulation"
              : "Server simulation controls"}
          </h3>
          <p>
            {simulation
              ? "Try a plate locally. No database writes."
              : state.simulationEnabled
                ? "Demo events are saved to PostgreSQL with source SIMULATION."
                : "Camera detections are accepted by the protected HTTP API. Server demo controls are disabled."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("DETECTION");
            }}
          >
            <label>
              Plate number
              <input
                name="plate"
                maxLength={24}
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder="43A-123.45"
                disabled={disabled}
              />
            </label>
            <label>
              Direction
              <select
                aria-label="Direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                disabled={disabled}
              >
                <option value="ENTRY">Entry</option>
                <option value="EXIT">Exit</option>
              </select>
            </label>
            <button
              className="access-detect"
              type="submit"
              disabled={disabled || barrier.fireOverride}
            >
              {busy ? (
                <LoaderCircle size={15} className="access-spinner" />
              ) : (
                <Camera size={15} />
              )}{" "}
              Simulate detection
            </button>
          </form>
          <div className="access-message" role="status">
            {error ? (
              <span className="access-error">{error}</span>
            ) : (
              info ||
              (simulation ? "Recognition queues a visit. Confirm passage only after the simulated car crosses." : "Qua cổng → chờ vào ô. Chỉ cảm biến P01 có xe mới ghi Inside; lượt ra hoàn tất ở cổng.")
            )}
          </div>
          {simulation && (state.stats.pendingParking || 0) > 0 && <button className="access-reset" onClick={() => act("PARKED")}>Mô phỏng P01 có xe → Inside</button>}
          {simulation && (
            <button
              className="access-reset"
              type="button"
              onClick={() => {
                setLocal(initialAccessSimulation());
                setInfo("");
                setError("");
              }}
            >
              <RotateCcw size={13} /> Reset vehicle demo
            </button>
          )}
        </div>
      </div>
      <div className="access-ledger">
        <div className="access-ledger-heading">
          <h3>
            Active & recent visits <span>{state.visits.length}</span>
          </h3>
          <label>
            <span className="sr-only">Filter visits by plate</span>
            <input
              placeholder="Filter plate…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        </div>
        <div className="access-table-scroll">
          <table>
            <thead>
              <tr>
                <th>PLATE</th>
                <th>VISIT STATUS</th>
                <th>VÀO Ô (INSIDE)</th>
                <th>EXIT</th>
                <th>SOURCE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong className="access-plate">{v.plate}</strong>
                  </td>
                  <td>
                    <span
                      className={`visit-status visit-${v.status.toLowerCase()}`}
                    >
                      {visitLabel(v.status)}
                    </span>
                  </td>
                  <td>{formatTime(v.entryAt)}</td>
                  <td>{formatTime(v.exitAt)}</td>
                  <td>{v.source === "CAMERA" ? "Camera API" : "Simulation"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="access-empty">
              No matching visits. Send a detection to start.
            </p>
          )}
        </div>
      </div>
      <div className="access-events">
        <h3>Access activity</h3>
        {state.events.length ? (
          <ul>
            {state.events.slice(0, 5).map((e) => (
              <li key={e.id}>
                <Camera size={13} />
                <strong>{e.plate || "Virtual barrier"}</strong>
                <span>{outcomeLabel(e.outcome)}</span>
                <time dateTime={e.time}>{formatTime(e.time)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p>No access events yet.</p>
        )}
      </div>
      <div className="access-footer">
        <ArrowDownToLine size={14} />
        <span>
          {simulation
            ? "Local virtual barrier; no hardware commands. "
            : "Trạng thái mạch là phản hồi lệnh servo từ Uno, không phải cảm biến vị trí servo. Chu kỳ tự động suy luận xe rời vùng từ một cảm biến trên mô hình; xe lùi có thể bị hiểu là đã qua. Dữ liệu cũ hiển thị mất kết nối. "}
          Plate-to-slot mapping is not inferred from occupancy sensors.
          {!simulation &&
            " Latest 100 visits and 30 events; tracked visits do not replace parking occupancy counts."}
        </span>
      </div>
    </section>
  );
}
