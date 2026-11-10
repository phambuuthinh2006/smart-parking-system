import { spawn } from "node:child_process";
const child = spawn(
  "java",
  ["-jar", "backend/target/smart-parking-1.0.0.jar"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: process.env.API_PORT || "18081",
      DATABASE_URL:
        process.env.DATABASE_URL ||
        `jdbc:postgresql://127.0.0.1:${process.env.POSTGRES_PORT || 55439}/parking`,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
