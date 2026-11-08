import { useId, useReducer, useEffect } from "react";
import {
  Flame,
  Thermometer,
  Volume2,
  VolumeX,
  RotateCcw,
  Snowflake,
  Cpu,
  FlaskConical,
  CircleHelp,
  Activity,
  DoorOpen,
  DoorClosed,
} from "lucide-react";
import {
  initialTemperatureState,
  temperatureReducer,
  temperatureEventLabel,
  TEMPERATURE_LIMITS,
  THRESHOLD_LIMITS,
  DEFAULT_TEMPERATURE,
} from "../services/temperatureAlarm";
import { unknownTemperature } from "../services/deviceTemperature";
import { useAlarmSound } from "../hooks/useAlarmSound";
import { formatTime } from "./ActivityHistory";
import "./FireAlarmPanel.css";

export default function FireAlarmPanel({
  simulation,
  onFireGateChange,
  telemetry,
  backendReachable,
}) {
  const [local, dispatch] = useReducer(
    temperatureReducer,
    undefined,
    initialTemperatureState,
  );
  const state = simulation ? local : telemetry || unknownTemperature();
  const alarm = state.status === "alarm",
    unknown = state.status === "unknown";
  const sound = useAlarmSound(alarm);
  const id = useId();
  useEffect(() => {
    if (simulation) onFireGateChange?.(state.gateOpenRequested);
  }, [simulation, state.gateOpenRequested, onFireGateChange]);
  const renderEvent = (event) => (
    <li key={event.id}>
      <span className={`fire-event-dot ${event.status}`} />
      <strong>{temperatureEventLabel(event)}</strong>
      <span>
        {event.temperature === null
          ? "No current reading"
          : `${event.temperature}°C`}{" "}
        · on {event.threshold}°C / off {event.clearThreshold ?? event.threshold}
        °C{!simulation && ` · ${event.source}`}
      </span>
      <time dateTime={new Date(event.time).toISOString()}>
        {formatTime(event.time)}
      </time>
    </li>
  );
  const title = simulation
    ? "Fire alarm simulation"
    : "Temperature & fire alarm";
  return (
    <section
      className={`panel fire-panel ${alarm ? "fire-alarm-active" : ""} ${unknown ? "fire-temperature-unknown" : ""}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="fire-heading">
        <span className="fire-heading-icon">
          <Flame size={21} />
        </span>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>
            {simulation
              ? "A temperature sensor, warning LED and siren — all simulated."
              : "Persisted temperature readings and alarm events from the device API."}
          </p>
        </div>
        <span className="fire-source">
          {simulation ? <FlaskConical size={13} /> : <Cpu size={13} />}{" "}
          {simulation ? "Local simulation" : "Device telemetry"}
        </span>
      </div>
      <div className="fire-grid">
        <div className="fire-temperature-controls">
          <div className="fire-reading">
            <span>
              <Thermometer size={17} />{" "}
              {simulation ? "Simulated temperature" : "Sensor temperature"}
            </span>
            <output
              htmlFor={simulation ? `${id}-temperature` : undefined}
              className="fire-temperature-value"
            >
              {state.temperature ?? "—"}
              {state.temperature !== null && <small>°C</small>}
            </output>
          </div>
          {simulation ? (
            <>
              <label
                className="fire-slider-label"
                htmlFor={`${id}-temperature`}
              >
                Adjust temperature{" "}
                <span>
                  {TEMPERATURE_LIMITS.min}–{TEMPERATURE_LIMITS.max}°C
                </span>
              </label>
              <input
                id={`${id}-temperature`}
                type="range"
                min={TEMPERATURE_LIMITS.min}
                max={TEMPERATURE_LIMITS.max}
                step="1"
                value={state.temperature}
                onChange={(e) =>
                  dispatch({
                    type: "temperature",
                    value: Number(e.target.value),
                  })
                }
              />
              <label
                className="fire-slider-label fire-threshold-label"
                htmlFor={`${id}-threshold`}
              >
                Demo alarm threshold{" "}
                <output htmlFor={`${id}-threshold`}>{state.threshold}°C</output>
              </label>
              <input
                id={`${id}-threshold`}
                type="range"
                min={THRESHOLD_LIMITS.min}
                max={THRESHOLD_LIMITS.max}
                step="1"
                value={state.threshold}
                onChange={(e) =>
                  dispatch({ type: "threshold", value: Number(e.target.value) })
                }
              />
              <label
                className="fire-slider-label fire-threshold-label"
                htmlFor={`${id}-clear-threshold`}
              >
                Clear alarm threshold{" "}
                <output htmlFor={`${id}-clear-threshold`}>
                  {state.clearThreshold}°C
                </output>
              </label>
              <input
                id={`${id}-clear-threshold`}
                type="range"
                min="0"
                max={state.threshold - 1}
                step="1"
                value={state.clearThreshold}
                onChange={(e) =>
                  dispatch({
                    type: "clearThreshold",
                    value: Number(e.target.value),
                  })
                }
              />
            </>
          ) : (
            <dl className="fire-device-details">
              <div>
                <dt>Alarm ON threshold</dt>
                <dd>{state.threshold}°C</dd>
              </div>
              <div>
                <dt>Alarm OFF threshold</dt>
                <dd>{state.clearThreshold}°C</dd>
              </div>
              <div>
                <dt>LED toggle interval</dt>
                <dd>{state.blinkIntervalMs} ms</dd>
              </div>
              <div>
                <dt>Last sensor report</dt>
                <dd>{formatTime(state.updatedAt)}</dd>
              </div>
              <div>
                <dt>Data source</dt>
                <dd>
                  {state.integrated
                    ? "Device HTTP API"
                    : "Waiting for backend upgrade"}
                </dd>
              </div>
            </dl>
          )}
          <p className="fire-rule">
            Alarm at {state.threshold}°C or above; clears at{" "}
            {state.clearThreshold}°C or below. Between these limits, the
            previous alarm state is retained.
          </p>
          {!simulation && unknown && (
            <p className="fire-unknown-note">
              <CircleHelp size={15} />
              <span>
                {!backendReachable
                  ? "Temperature is unconfirmed while the backend is unavailable."
                  : !state.integrated
                    ? "Update the backend to receive temperature telemetry."
                    : "Waiting for fresh temperature reports. A missing reading does not confirm that an alert has cleared."}
              </span>
            </p>
          )}
        </div>
        <div className="fire-actuators">
          <div
            className={`fire-condition ${alarm ? "is-alarm" : ""} ${unknown ? "is-unknown" : ""}`}
            role="status"
          >
            {unknown ? <CircleHelp size={19} /> : <Flame size={19} />}
            <div>
              <strong>
                {unknown
                  ? "Temperature status unknown"
                  : simulation
                    ? alarm
                      ? "Simulated heat alert"
                      : "No simulated heat alert"
                    : alarm
                      ? "Heat alert"
                      : "No heat alert"}
              </strong>
              <span>
                {unknown
                  ? "No current, confirmed sensor reading."
                  : alarm
                    ? "Threshold exceeded. Web alarm indicator is active."
                    : "Temperature is within the configured threshold."}
              </span>
            </div>
          </div>
          <div className="fire-indicators">
            <div className="fire-indicator">
              <span
                className={`fire-led ${alarm ? "is-on" : ""} ${unknown ? "is-unknown" : ""}`}
                aria-hidden="true"
                style={{
                  "--fire-blink-cycle": `${state.blinkIntervalMs * 2}ms`,
                }}
              />
              <div>
                <strong>{simulation ? "Alarm LED" : "Web alarm LED"}</strong>
                <span>{unknown ? "Unknown" : alarm ? "Active" : "Off"}</span>
              </div>
            </div>
            <div className="fire-indicator">
              {sound.playing ? <Volume2 size={23} /> : <VolumeX size={23} />}
              <div>
                <strong>{simulation ? "Siren" : "Web siren"}</strong>
                <span>
                  {sound.playing
                    ? "Sounding"
                    : !sound.enabled
                      ? "Muted"
                      : unknown
                        ? "Unconfirmed"
                        : alarm
                          ? "Paused"
                          : "Standby"}
                </span>
              </div>
            </div>
            <div className="fire-indicator fire-gate-indicator">
              {state.gateOpenRequested ? (
                <DoorOpen size={23} />
              ) : (
                <DoorClosed size={23} />
              )}
              <div>
                <strong>Gate preview</strong>
                <span>
                  {state.gateOpenRequested
                    ? unknown
                      ? "Open requested · unconfirmed"
                      : "Open requested"
                    : unknown
                      ? "No confirmed request"
                      : "No fire-open request"}
                </span>
              </div>
            </div>
          </div>
          <div className="fire-actions">
            {simulation && (
              <>
                <button
                  type="button"
                  className="fire-button fire-trigger"
                  onClick={() =>
                    dispatch({
                      type: "temperature",
                      value: state.threshold + 10,
                    })
                  }
                >
                  <Flame size={15} /> Simulate heat
                </button>
                <button
                  type="button"
                  className="fire-button"
                  onClick={() =>
                    dispatch({
                      type: "temperature",
                      value: DEFAULT_TEMPERATURE,
                    })
                  }
                >
                  <Snowflake size={15} /> Cool down
                </button>
              </>
            )}
            <button
              type="button"
              className="fire-button"
              aria-pressed={sound.enabled}
              disabled={!sound.supported || sound.pending}
              onClick={sound.toggle}
            >
              {sound.enabled ? <VolumeX size={15} /> : <Volume2 size={15} />}{" "}
              {!sound.supported
                ? "Sound unavailable"
                : sound.pending
                  ? "Enabling…"
                  : sound.enabled
                    ? "Mute sound"
                    : "Enable sound"}
            </button>
            {simulation && (
              <button
                type="button"
                className="fire-button fire-reset"
                aria-label="Reset fire simulation"
                onClick={() => {
                  sound.mute();
                  dispatch({ type: "reset" });
                }}
              >
                <RotateCcw size={15} />
              </button>
            )}
          </div>
          <p className="fire-audio-note">
            Sound starts only after you enable it. Muting does not clear the
            alert. LED toggles every {state.blinkIntervalMs} ms.
            {!simulation &&
              " Browser sound does not control the hardware buzzer."}
          </p>
          {sound.error && (
            <p className="fire-audio-error" role="status">
              {sound.error}
            </p>
          )}
        </div>
      </div>
      <div className="fire-history">
        <div className="fire-history-heading">
          <span>
            <Activity size={14} /> Alarm activity
          </span>
          <span>{simulation ? "Local" : "PostgreSQL"} · latest 20 events</span>
        </div>
        {state.events.length ? (
          <ul>{state.events.slice(0, 3).map(renderEvent)}</ul>
        ) : (
          <p>
            {simulation
              ? "No alarm events yet. Raise the temperature above the demo threshold to test."
              : "No temperature events yet. Send readings from your device or HTTP emulator."}
          </p>
        )}
        {state.events.length > 3 && (
          <details>
            <summary>Show earlier events ({state.events.length - 3})</summary>
            <ul>{state.events.slice(3).map(renderEvent)}</ul>
          </details>
        )}
      </div>
      <div className="fire-footer">
        {simulation ? <FlaskConical size={14} /> : <Cpu size={14} />}
        <span>
          {simulation
            ? "Demo data only. No temperature readings from hardware and no database writes. Switching data source resets this demo and stops sound."
            : "Readings and alarm events are saved in PostgreSQL. Temperature freshness is independent of parking sensors. This panel previews alarms in the browser; it does not send commands to the circuit."}
        </span>
      </div>
    </section>
  );
}
