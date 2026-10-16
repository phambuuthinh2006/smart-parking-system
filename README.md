# Smart Parking System

Frontend-only university IoT dashboard. React + Vite + Tailwind CSS v4 (Vite plugin), Lucide React, and Motion for vehicle presence and subtle pointer parallax. No backend or hardware is required.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Build with `npm run build`, serve the build with `npm run preview`, and check simulation logic with `npm test`.

## Share a public preview

```sh
npm run share
```

This starts Vite and a Cloudflare Quick Tunnel together. Wait for `PUBLIC DASHBOARD: https://...trycloudflare.com`, then share that URL. You do not need to start `npm run dev` separately. Press **Ctrl+C** to stop both services. Each run creates a temporary public URL; anyone with the link can open the simulated dashboard while the command runs. Simulation state is local to each browser tab.

On Linux, the command downloads the official cloudflared 2026.10.1 binary into the ignored `.cache/` directory on the first run and reuses it afterward. No Cloudflare account, token, or administrator installation is needed. If cloudflared is already on PATH, it is used directly. On other systems, install [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) first, or set `CLOUDFLARED_BIN` to its executable path.

Vite stays bound to loopback for sharing. The tunnel rewrites the origin Host header to localhost, preserving Vite's host checks. If port 5173 is busy, Vite chooses another available port automatically.

## Using the dashboard

- Select one of the four parking bays or choose it in the simulation controls.
- Set Available, Occupied, or Unknown. Counts and activity update together.
- Start/pause automatic simulation and choose a 3, 5, or 10 second interval.
- Shuffle simulates one random arrival/departure. Reset pauses and restores the initial states and four sample events.
- Filter history by status and download the filtered records as CSV.
- History retains the most recent 100 events. State lives in memory and reload restores the initial scenario.

Initial state: P01/P03 occupied, P02/P04 available. Unknown bays never count as confirmed available or occupied. Initial history is labeled Sample data; subsequent events identify their manual or automatic simulation source. The ESP8266 is always labeled Not Connected.

## Architecture and future integration

`src/services/parking.js` contains state transitions, input validation, derived statistics, and simulated updates. `src/hooks/useParking.js` owns lifecycle and timers. The components render shared state without separate counters.

A future telemetry adapter can dispatch `{ type: 'update', spaceId: 'P01', status: 'occupied', time: Date.now(), source: 'ESP8266' }` through the same reducer. Before production integration, add authenticated/validated transport, ordered device timestamps, stale sensor handling, connection lifecycle, and backend persistence. Only then replace the simulation and disconnected device labels with actual telemetry status. No Express, SQL, Socket.IO transport, authentication, or firmware is implemented here.

The UI uses local SVG vehicles with no stock photos or external font requests. CSS handles basic transitions; Motion handles vehicle entry/exit and a two-pixel pointer parallax. Reduced-motion preferences are respected.
