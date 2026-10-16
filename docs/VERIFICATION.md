# Verification

Verified locally on 2026-10-16.

- `npm test`: five reducer/simulation tests pass (initial scenario, unknown counts, malformed and duplicate events, bounded/unique history, random updates/reset).
- `npm run build`: production build succeeds.
- Headless Chromium: initial 04/02/02 counts, bay selection synchronized with selector, manual updates, unknown status/counts, status filtering and empty result state, CSV download, automatic 3-second update, pause with no subsequent update, random state change, and reset all pass. No JavaScript page errors.
- Checked viewport widths 320, 360, 390, 680, 768, 820, 1024, and 1440 pixels. No horizontal page overflow.
- Inspected desktop and mobile screenshots. History controls remain visible while the event table scrolls. Vehicle art stays within the parking bays.

No backend, hardware telemetry, persistence, or hosted deployment was tested or implemented. State resets on page reload. The disconnected device label is intentional.

## Public preview tunnel

- `npm run share` downloads the official Linux cloudflared binary on first use and starts both Vite and a Cloudflare Quick Tunnel.
- Verified HTTPS HTTP 200 through the generated public URL and ran the same browser interaction/responsive checks through the tunnel successfully.
- Verified automatic fallback to port 5174 when port 5173 was already in use.
- Verified an unlisted origin Host header still receives HTTP 403; Vite host checks remain enabled.
- Pressing Ctrl+C stops the share command and its Vite/tunnel processes. The public URL is temporary.
