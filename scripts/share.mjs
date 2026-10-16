import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const version = "2026.10.1";
let server;
let tunnel;
let stopping = false;
let startupTimer;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(startupTimer);
  const forcedExit = setTimeout(() => process.exit(code), 5000);
  forcedExit.unref();
  if (tunnel && tunnel.exitCode === null) tunnel.kill("SIGTERM");
  await server?.close();
  process.exitCode = code;
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function getCloudflared() {
  // An explicitly configured/system-installed binary also supports other OSes.
  const override = process.env.CLOUDFLARED_BIN;
  if (override) return override;
  const probe = spawn("cloudflared", ["--version"], { stdio: "ignore" });
  const installed = await new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.once("exit", (code) => resolve(code === 0));
  });
  if (installed) return "cloudflared";

  const architectures = { x64: "amd64", arm64: "arm64", arm: "arm" };
  if (process.platform !== "linux" || !architectures[process.arch]) {
    throw new Error(
      "Install cloudflared for your platform, then run npm run share again.",
    );
  }
  const asset = `cloudflared-linux-${architectures[process.arch]}`;
  const binary = join(root, ".cache", "cloudflared", version, asset);
  try {
    await access(binary);
    return binary;
  } catch {
    /* First run. */
  }
  await mkdir(dirname(binary), { recursive: true });
  const temporary = `${binary}.${process.pid}.download`;
  console.log(
    `Downloading cloudflared ${version} from the official Cloudflare release (first run only)...`,
  );
  try {
    const response = await fetch(
      `https://github.com/cloudflare/cloudflared/releases/download/${version}/${asset}`,
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok || !response.body)
      throw new Error(`Download failed: HTTP ${response.status}`);
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { mode: 0o700 }),
    );
    await chmod(temporary, 0o700);
    await rename(temporary, binary);
  } finally {
    await rm(temporary, { force: true });
  }
  return binary;
}

try {
  const binary = await getCloudflared();
  if (!stopping) {
    server = await createServer({
      root,
      server: { host: "127.0.0.1", port: 5173, open: false },
    });
    await server.listen();
    const address = server.httpServer.address();
    const localUrl = `http://127.0.0.1:${address.port}`;
    console.log(
      `\nDashboard: ${localUrl}\nStarting public tunnel. Keep this terminal open; press Ctrl+C to stop both services.\n`,
    );
    // Rewrite only the origin Host header. Vite's host allowlist remains enabled.
    tunnel = spawn(
      binary,
      [
        "tunnel",
        "--no-autoupdate",
        "--protocol",
        "http2",
        "--url",
        localUrl,
        "--http-host-header",
        "localhost",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let recent = "";
    let publicUrl;
    let announced = false;
    const onOutput = (chunk) => {
      process.stdout.write(chunk);
      recent = (recent + chunk.toString()).slice(-16000);
      publicUrl ??= recent.match(
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
      )?.[0];
      if (
        !announced &&
        publicUrl &&
        recent.includes("Registered tunnel connection")
      ) {
        announced = true;
        clearTimeout(startupTimer);
        console.log(
          `\nPUBLIC DASHBOARD: ${publicUrl}\nShare this URL. It works while this command is running.\n`,
        );
      }
    };
    tunnel.stdout.on("data", onOutput);
    tunnel.stderr.on("data", onOutput);
    tunnel.once("error", (error) => {
      console.error(`Tunnel failed: ${error.message}`);
      void stop(1);
    });
    tunnel.once("exit", (code) => {
      if (!stopping) {
        console.error(`Tunnel stopped (exit ${code}).`);
        void stop(code || 1);
      }
    });
    startupTimer = setTimeout(() => {
      console.error(
        "Tunnel startup timed out. Check your internet connection and try again.",
      );
      void stop(1);
    }, 60000);
  }
} catch (error) {
  console.error(`Unable to share dashboard: ${error.message}`);
  await stop(1);
}
