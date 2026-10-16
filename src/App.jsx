import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ParkingSquare,
  Radio,
  Unplug,
  LayoutGrid,
  CircleParking,
  CarFront,
  ArrowUpRight,
  FlaskConical,
  Play,
  Pause,
  RotateCcw,
  Shuffle,
  ChevronDown,
  Cpu,
  Info,
  ArrowRight,
  Check,
  CircleHelp,
} from "lucide-react";
import { useParking } from "./hooks/useParking";
import ParkingMap from "./components/ParkingMap";
import ActivityHistory, { formatTime } from "./components/ActivityHistory";
import { STATUSES } from "./services/parking";

export default function App() {
  const parking = useParking();
  const [selected, setSelected] = useState("P01");
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const reduced = useReducedMotion();
  const current = parking.spaces.find((s) => s.id === selected);
  const occupancy = Math.round(
    (parking.stats.occupied / parking.stats.total) * 100,
  );
  const cards = [
    {
      label: "Total spaces",
      value: parking.stats.total,
      icon: LayoutGrid,
      color: "blue",
      description: "One small lot. All in view.",
      meta: "Prototype capacity",
    },
    {
      label: "Available",
      value: parking.stats.available,
      icon: CircleParking,
      color: "green",
      description: "Ready for the next arrival.",
      meta: "Spaces open now",
    },
    {
      label: "Occupied",
      value: parking.stats.occupied,
      icon: CarFront,
      color: "red",
      description: "A clear picture of what’s parked.",
      meta: `${occupancy}% occupancy`,
    },
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <a
            className="brand"
            href="#"
            aria-label="Smart Parking Dashboard home"
          >
            <span className="brand-icon">
              <ParkingSquare size={27} strokeWidth={1.8} />
            </span>
            <div>
              <h1>
                Smart Parking <span>Dashboard</span>
              </h1>
              <p>Real-time Parking Monitoring</p>
            </div>
          </a>
          <div className="header-status">
            <span className="device-badge">
              <Unplug size={14} />
              <span>Device: Not Connected</span>
            </span>
            <span className="simulation-badge">
              <FlaskConical size={14} />
              Simulation Mode
            </span>
          </div>
        </div>
      </header>
      <main className="main-content">
        <div className="page-intro">
          <div>
            <div className="breadcrumb">
              WORKSPACE <span>/</span> OVERVIEW
            </div>
            <h2>
              A little lot. A smarter view<span>.</span>
            </h2>
            <p>Everything you need to see your parking, at a glance.</p>
          </div>
          <div className="local-status">
            <span className={`tiny-dot ${parking.running ? "running" : ""}`} />
            {parking.running
              ? "Auto simulation running"
              : "Local simulation ready"}
            <span className="local-sub">No hardware required</span>
          </div>
        </div>
        <section
          className="stats-grid"
          aria-label="Parking statistics"
          aria-live="polite"
        >
          {cards.map(
            ({ label, value, icon: Icon, color, description, meta }) => (
              <article className={`stat-card stat-${color}`} key={label}>
                <div className="stat-top">
                  <span>{label}</span>
                  <span className="stat-icon">
                    <Icon size={19} />
                  </span>
                </div>
                <div className="stat-value">
                  {String(value).padStart(2, "0")}
                  <span className="stat-meta">
                    {color === "red" ? (
                      <>
                        <span className="mini-progress">
                          <i style={{ width: `${occupancy}%` }} />
                        </span>
                        {meta}
                      </>
                    ) : (
                      <>
                        <span className={`tiny-dot ${color}`} />
                        {meta}
                      </>
                    )}
                  </span>
                </div>
                <p>{description}</p>
              </article>
            ),
          )}
        </section>
        {parking.stats.unknown > 0 && (
          <div className="unknown-notice" role="status">
            <CircleHelp size={16} />
            {parking.stats.unknown}{" "}
            {parking.stats.unknown === 1 ? "space has" : "spaces have"} unknown
            sensor data. Availability counts include confirmed states only.
          </div>
        )}
        <div className="dashboard-grid">
          <motion.div
            className="map-motion"
            onPointerMove={(e) => {
              if (e.pointerType !== "mouse" || reduced) return;
              const bounds = e.currentTarget.getBoundingClientRect();
              setPointer({
                x: (e.clientX - bounds.left) / bounds.width - 0.5,
                y: (e.clientY - bounds.top) / bounds.height - 0.5,
              });
            }}
            onPointerLeave={() => setPointer({ x: 0, y: 0 })}
            animate={{
              x: reduced ? 0 : pointer.x * 2,
              y: reduced ? 0 : pointer.y * 2,
            }}
            transition={{ type: "spring", stiffness: 140, damping: 25 }}
          >
            <ParkingMap
              spaces={parking.spaces}
              selected={selected}
              onSelect={setSelected}
            />
          </motion.div>
          <ActivityHistory events={parking.events} />
        </div>
        <section className="panel simulation-panel">
          <div className="simulation-title">
            <span className="control-icon">
              <FlaskConical size={20} />
            </span>
            <div>
              <h2>Simulation playground</h2>
              <p>A real-time feel, without the hardware.</p>
            </div>
            <span
              className={`paused-badge ${parking.running ? "is-running" : ""}`}
            >
              <span className="tiny-dot" />
              {parking.running ? "Running" : "Paused"}
            </span>
          </div>
          <div className="controls-body">
            <div className="manual-controls">
              <label htmlFor="space">PARKING SPACE</label>
              <div className="manual-row">
                <div className="select-wrap">
                  <select
                    id="space"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {parking.spaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <div
                  className="status-switch"
                  role="group"
                  aria-label={`Set ${selected} status`}
                >
                  {STATUSES.map((status) => (
                    <button
                      key={status}
                      className={
                        current.status === status ? `selected ${status}` : ""
                      }
                      aria-pressed={current.status === status}
                      onClick={() => parking.update(selected, status)}
                    >
                      {current.status === status && <Check size={13} />}
                      <span>{status}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="auto-controls">
              <label htmlFor="speed">AUTO SIMULATION</label>
              <div className="auto-row">
                <button
                  className="primary-button"
                  onClick={() => parking.setRunning(!parking.running)}
                >
                  {parking.running ? <Pause size={14} /> : <Play size={14} />}
                  <span>
                    {parking.running ? "Pause simulation" : "Start simulation"}
                  </span>
                </button>
                <div className="select-wrap speed-select">
                  <select
                    id="speed"
                    value={parking.interval}
                    onChange={(e) =>
                      parking.setIntervalSeconds(Number(e.target.value))
                    }
                  >
                    <option value={3}>Every 3s</option>
                    <option value={5}>Every 5s</option>
                    <option value={10}>Every 10s</option>
                  </select>
                  <ChevronDown size={13} />
                </div>
                <button
                  className="icon-button outlined"
                  title="Simulate one random state change"
                  aria-label="Simulate one random state change"
                  onClick={parking.randomize}
                >
                  <Shuffle size={16} />
                </button>
                <button
                  className="icon-button outlined"
                  title="Reset to initial states and sample history"
                  aria-label="Reset simulation"
                  onClick={parking.reset}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>
          </div>
          <div className="simulation-note">
            <Info size={14} />
            <span>
              Click a parking space to select it. Change its status above, or
              let the simulation do the driving.
            </span>
          </div>
        </section>
        <section className="system-strip" aria-label="System information">
          <div>
            <span className="system-icon">
              <Cpu size={17} />
            </span>
            <div>
              <strong>Built for the real world.</strong>
              <span>Running locally for now.</span>
            </div>
          </div>
          <div className="data-flow">
            <span className="source-active">
              <FlaskConical size={13} />
              Simulation
            </span>
            <ArrowRight size={13} />
            <span>React dashboard</span>
            <span className="flow-divider" />
            <span>
              Future: ESP8266 + Socket.IO <ArrowUpRight size={12} />
            </span>
          </div>
          <span className="last-update">
            <Radio size={13} />
            Last update {formatTime(parking.lastUpdate)}
          </span>
        </section>
        <footer>
          <span>
            <ParkingSquare size={14} />
            SMART PARKING SYSTEM<span className="footer-dot">·</span>University
            IoT Project
          </span>
          <span>Small prototype. Thoughtfully connected.</span>
        </footer>
      </main>
    </div>
  );
}
