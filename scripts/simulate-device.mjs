// HTTP client only: all persistence and realtime updates still go through Spring Boot.
const base =
  process.env.DEVICE_BACKEND_URL ||
  `http://127.0.0.1:${process.env.API_PORT || 18080}`;
const key = process.env.DEVICE_API_KEY;
if (!key)
  throw new Error("Missing DEVICE_API_KEY. Run npm run backend:init first.");
let tick = 0;
async function send() {
  const spaces = ["P01", "P02", "P03", "P04"].map((spaceId, i) => ({
    spaceId,
    status: (i + tick) % 2 ? "AVAILABLE" : "OCCUPIED",
  }));
  const response = await fetch(`${base}/api/device/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Key": key },
    body: JSON.stringify({ deviceId: "esp8266-01", spaces }),
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
  tick++;
  console.log(
    `HTTP sensor emulator: update ${tick} saved. This is simulated device traffic, not real ESP8266 hardware.`,
  );
}
console.log(
  "Open Device Mode. Ctrl+C stops this emulator; readings expire after the configured timeout.",
);
while (true) {
  try {
    await send();
  } catch (error) {
    console.error(error.message);
  }
  await new Promise((resolve) => setTimeout(resolve, 15000));
}
