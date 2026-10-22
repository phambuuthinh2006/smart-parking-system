import { spawn, spawnSync } from "node:child_process";
if (!process.env.TEST_DATABASE_URL) {
  const query = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "parking",
      "-d",
      "parking",
      "-tAc",
      "SELECT 1 FROM pg_database WHERE datname='parking_test'",
    ],
    { encoding: "utf8" },
  );
  if (query.status !== 0)
    throw new Error(
      "Start the project database first: docker compose up -d postgres",
    );
  if (query.stdout.trim() !== "1") {
    const create = spawnSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "createdb",
        "-U",
        "parking",
        "parking_test",
      ],
      { stdio: "inherit" },
    );
    if (create.status !== 0) process.exit(1);
  }
}
// The Java suite additionally refuses any database name other than parking_test.
const child = spawn("./mvnw", ["test"], {
  cwd: new URL("../backend", import.meta.url),
  stdio: "inherit",
  env: {
    ...process.env,
    TEST_DATABASE_URL:
      process.env.TEST_DATABASE_URL ||
      `jdbc:postgresql://127.0.0.1:${process.env.POSTGRES_PORT || 55432}/parking_test`,
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
