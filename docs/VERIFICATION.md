# Verification

## Firmware alarm policy — 2026-10-31 (50/45°C update)

- Supersedes the earlier 80°C prototype rule below. Defaults now match the supplied firmware constants: ON >=50°C, OFF <=45°C, retain prior state between them, LED toggles every 300ms, FIRE_OPENS_GATE true.
- Flyway V3 applied successfully. Readings/events retain previous policy values; sensor state waits for a new reading under the updated policy. Separate alarm_active latch is stored, not inferred from the latest temperature alone.
- Java suite: **17/17 pass** (16 integration + one unit). Adds boundary/holding behavior and alarm/gate latch surviving timeout and reactivation at 47°C. Node suite: **19/19 pass**. Frontend build succeeds.
- Browser verified both Simulation and Device: 49 cold normal → 50 alarm → 47 held alarm → 45 normal → 47 remains normal, with matching gate request preview and browser siren.
- Verified 600ms full LED cycle (=300ms per ON/OFF phase), mute/clear, reset policy, no JS errors and widths 320/390/768/1440 without overflow.
- Restarted backend while alarm was held at 47°C; another 47°C reading remained ALARM and gateOpenRequested true, demonstrating persistence of the latch. No hardware gate command or actual position was tested/claimed.
- Obsidian presentation sections 15–16 were rewritten with the new parameters, hysteresis example, SQL and ready-to-read narration.

## Temperature and fire-alarm integration — 2026-10-31

- Flyway V2 adds `temperature_sensor`, `temperature_reading`, `fire_alarm_event` to the same PostgreSQL database. Applied on the live project database; the 466 existing parking events and their earliest ID were preserved across migration.
- `npm run test:backend`: **16/16 pass, 0 skipped** (15 integration + one unit), on isolated `parking_test`. Adds strict 80/80.01 boundary, authenticated input validation/precision, atomic rejection, every-reading persistence versus transition-only events, independent timestamp replay, concurrency, expiry and committed temperature STOMP payloads.
- `npm test`: **19/19 pass** (parking, device adapter, local heat simulation and Device temperature validation/freshness/event-label tests).
- `npm run build`: pass; Docker backend rebuilt and started successfully. Existing V1 migration remains unchanged.
- Browser: actual authenticated HTTP → PostgreSQL → STOMP → local Device Mode. Verified 80°C NORMAL, 81°C ALARM, optical indicator, opt-in Web Audio and persisted event history. At least one new temperature frame was observed on STOMP.
- Browser reload kept readings/events; local Simulation changes did not write a temperature reading or replace the Device value. Device inputs are read-only.
- Real timeout test: sent no temperature for >45s while sending heartbeat; Device stayed Online, temperature became UNKNOWN, TIMEOUT event retained previous ALARM and was not labeled cleared, all siren oscillators stopped.
- Restarted backend, verified prior readings/events remained, and sent 27°C; browser recovered NORMAL without reload.
- Widths 320, 390, 768, 1440 had no horizontal overflow. Device screenshots: `screenshots/fire-device-desktop.png` and `fire-device-mobile.png`; local simulation screenshots are also included.
- `temperature:simulate -- --temperature 80 --once` and `81 --once` verified against live API; invalid input is rejected by the CLI. Every listed SQL in FIRE_ALARM.md was checked in a read-only transaction.
- No physical temperature sensor, hardware buzzer or hardware LED command path was tested. Device UI previews browser alarms; it does not claim that muting browser sound controls the circuit. Frontend changes are local and have not yet been pushed/deployed in this phase.

## Backend integration — 2026-10-22

Environment: Java 17.0.20.1, Spring Boot 3.5.16, PostgreSQL 16, Node 26.11.1, headless Chromium.

- `npm test`: **10/10 pass**, including initial simulation, unknown counts, duplicate/malformed events, bounded history, device adapter validation, revision ordering and frontend stale-data masking.
- `npm run test:backend`: **11/11 pass, 0 skipped** (10 integration tests and one unit test), against real PostgreSQL in the isolated `parking_test` database. Covers device-key authentication, atomic validation, duplicate reports, timestamp replay/out-of-order rejection, concurrent requests, timeout, heartbeat versus sensor freshness, history bounds, malformed JSON responses, origin normalization, committed STOMP snapshots and rejection of client SEND.
- `npm run build`: production frontend build succeeds.
- Browser: verified HTTP sensor reports → PostgreSQL → STOMP → React without refreshing. Device online is based on received telemetry. Switching modes pauses auto simulation, hides simulation controls, and keeps the two data sources separate. No JavaScript page errors.
- Browser widths **320, 390, 768 and 1440 px**: no horizontal page overflow. Screenshots: `screenshots/device-desktop.png`, `screenshots/device-mobile.png`.
- Docker: `npm run backend:up` builds and starts the non-root Java backend with the isolated PostgreSQL service; API returns HTTP 200. Repeated startup keeps credentials/data.
- Production frontend (`npm run preview`): stopped backend for over 70 seconds. Browser changed all bays to Unknown and Device Unconfirmed, then automatically reconnected via STOMP after backend restart and received new reports without refresh. Existing history remained in PostgreSQL.
- After agy's review, separated expiry/heartbeat schedulers, normalized origins, unified malformed-JSON errors, and replaced AbortSignal.any with per-request cancellation. Java and Node tests, frontend build, Docker rebuild/start and browser flow were rechecked.
- Frontend build contains no configured device key; `.env` is gitignored, mode 0600, and Vite refuses direct `.env` access (HTTP 403).
- Test HTTP traffic was generated by a software client, not physical ESP8266 hardware.

The timestamp replay test caught a precision mismatch between Java nanoseconds and PostgreSQL microseconds. Observations are now normalized to microseconds before comparison and persistence; replay rejection passes.

No physical sensor/firmware, hosted backend, public Device Mode tunnel, or Vercel-to-backend deployment has been tested. Browser verification used both Vite dev/production preview and the containerized Spring Boot/PostgreSQL stack. Historical Simulation/tunnel checks below are from the earlier frontend version.

## Frontend baseline — 2026-10-16

- Five reducer/simulation tests passed.
- Chromium: initial 04/02/02 counts, bay selection, manual status updates, filters/empty state, CSV export, auto simulation, pause, shuffle and reset passed.
- Widths 320, 360, 390, 680, 768, 820, 1024 and 1440 px had no page overflow.
- At that stage only local simulation existed; backend and persistence were added on 2026-10-22.

## Historical public preview checks — 2026-10-16

- `npm run share` downloaded official cloudflared and started Vite + Quick Tunnel.
- HTTPS HTTP 200 and browser interaction/responsive checks passed via public URL.
- Port fallback to 5174, unlisted Host HTTP 403 and Ctrl+C cleanup were verified.
- Tunnel code remains unchanged; Device Mode adds explicit backend-origin configuration as described in `BACKEND.md`.
