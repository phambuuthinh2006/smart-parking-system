const args = process.argv.slice(2);
let once = false,
  temperature = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--once") once = true;
  else if (args[i] === "--temperature" && args[i + 1] !== undefined)
    temperature = Number(args[++i]);
  else
    throw new Error(
      "Usage: npm run temperature:simulate -- [--temperature 81] [--once]",
    );
}
if (
  temperature !== null &&
  (!Number.isFinite(temperature) ||
    temperature < -40 ||
    temperature > 150 ||
    Math.abs(temperature * 100 - Math.round(temperature * 100)) > 0.00001)
)
  throw new Error(
    "Temperature must be -40..150°C with at most two decimal places.",
  );
if (!process.env.DEVICE_API_KEY)
  throw new Error("Missing DEVICE_API_KEY. Run npm run backend:init first.");
const base =
  process.env.DEVICE_BACKEND_URL ||
  `http://127.0.0.1:${process.env.API_PORT || 18080}`;
const cycle = [27, 49, 50, 47, 45];
let tick = 0;
console.log(
  "HTTP temperature emulator, not physical sensor data. Open Device Mode. Ctrl+C stops reports.",
);
while (true) {
  const value = temperature ?? cycle[tick % cycle.length];
  try {
    const response = await fetch(`${base}/api/device/temperature`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Key": process.env.DEVICE_API_KEY,
      },
      body: JSON.stringify({
        deviceId: "esp8266-01",
        temperatureCelsius: value,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok)
      throw new Error(`Backend returned HTTP ${response.status}`);
    const data = await response.json();
    tick++;
    console.log(
      `Reading ${tick}: ${value}°C → ${data.temperature.status}; saved in PostgreSQL.`,
    );
  } catch (error) {
    console.error(error.message);
    if (once) process.exitCode = 1;
  }
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, 15000));
}
