# Implementation review — 2026-10-22

## Codex self-review

Reviewed HTTP validation/key handling, transaction boundaries, concurrency, STOMP permissions, reconnect/freshness logic, source isolation, Docker separation and documentation.

- No device key in React or VITE variables. Generated `.env` is ignored and created with 0600 permissions; existing credentials are preserved.
- Status validation is performed before writes. Per-device PostgreSQL lock serializes reports/heartbeat/expiry. Events are generated only for actual state changes; realtime publication runs after commit.
- Fixed timestamp precision mismatch found by the replay test. Future/stale observations are rejected; clockless MCU mode explicitly relies on receive order.
- Browser cannot SEND to the broker or subscribe outside the parking topic. Reads are intentionally public in this test prototype.
- Device/sensor freshness are independent. Unknown is never counted as confirmed availability; heartbeat does not revive old sensor data.
- Full snapshot revisions protect against older HTTP results replacing newer realtime data. Polling heals missed messages; stale UI masks unconfirmed occupancy during backend outages.
- Simulation remains local and cannot write device tables. Switching to Device pauses automatic simulation.
- Database/ports/volume are separate from other projects. Integration fixtures only accept the `parking_test` database name.

Validation evidence is in [VERIFICATION.md](VERIFICATION.md). Independent review was completed by agy after this self-review; see [AGY_REVIEW.md](AGY_REVIEW.md) for findings and their disposition.

## Intentional limits

Single device and single backend instance; simple in-memory STOMP broker. No viewer login or event retention job. No physical ESP8266 test yet; HTTP device emulator and actual PostgreSQL were used. LAN HTTP example requires HTTPS before exposure outside a trusted test LAN. No deployment performed.

## Changes following independent review

- Expiry now has a dedicated scheduler, separate from STOMP heartbeats, so a blocked database expiry task cannot occupy the heartbeat thread.
- Shared origin parser trims whitespace, removes empty entries and duplicates.
- Malformed JSON consistently returns an application JSON error with HTTP 400.
- Request timeout/cancellation uses basic AbortController and cleanup; no dependency on AbortSignal.any support.
- Validation after these changes: 11 Java tests, 10 Node tests, frontend build, Docker rebuild/start and browser HTTP→database→STOMP flow pass.
