import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  CircleHelp,
} from "lucide-react";
import { Status } from "./ParkingMap";
export const formatTime = (time) =>
  time == null
    ? "—"
    : new Date(time).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
export default function ActivityHistory({ events }) {
  const [filter, setFilter] = useState("all");
  const filtered = events.filter(
    (event) => filter === "all" || event.status === filter,
  );
  function exportCsv() {
    const csv = [
      "Space,Status,Time,Source",
      ...filtered.map(
        (e) =>
          `${e.spaceId},${e.status},${new Date(e.time).toISOString()},${e.source}`,
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "smart-parking-activity.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">EVERY CHANGE, RECORDED</div>
          <h2>
            Activity history{" "}
            <span className="count-badge">{events.length}</span>
          </h2>
        </div>
        <button
          className="icon-button"
          onClick={exportCsv}
          aria-label="Export filtered activity as CSV"
          title="Export filtered activity as CSV"
        >
          <ArrowDownToLine size={18} />
        </button>
      </div>
      <div
        className="history-filters"
        role="group"
        aria-label="Filter activity"
      >
        {["all", "available", "occupied", "unknown"].map((f) => (
          <button
            key={f}
            className={filter === f ? "active" : ""}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All activity" : f}
          </button>
        ))}
      </div>
      <div className="activity-table-wrap">
        <table>
          <thead>
            <tr>
              <th>SPACE</th>
              <th>STATUS</th>
              <th>
                TIME <span>↓</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((event) => (
              <tr key={event.id}>
                <td>
                  <span className={`event-icon ${event.status}`}>
                    {event.status === "available" ? (
                      <ArrowUpRight size={15} />
                    ) : event.status === "occupied" ? (
                      <ArrowDownLeft size={15} />
                    ) : (
                      <CircleHelp size={15} />
                    )}
                  </span>
                  <strong>{event.spaceId}</strong>
                </td>
                <td>
                  <Status status={event.status} />
                </td>
                <td className="event-time">
                  <time dateTime={new Date(event.time).toISOString()}>
                    {formatTime(event.time)}
                  </time>
                  <span>{event.source}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty-history">
            <Activity size={24} />
            <strong>No activity yet</strong>
            <p>Changes with this status will appear here.</p>
          </div>
        )}
      </div>
      <div className="history-footer">
        <span className="tiny-dot" />
        Updates appear automatically
        <span className="history-limit">Latest 100 events</span>
      </div>
    </section>
  );
}
