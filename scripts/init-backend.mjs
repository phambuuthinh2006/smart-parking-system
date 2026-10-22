import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
try {
  writeFileSync(
    new URL("../.env", import.meta.url),
    readFileSync(new URL("../.env.example", import.meta.url), "utf8")
      .replace("replace-with-random-password", randomBytes(24).toString("hex"))
      .replace(
        "replace-with-a-random-key-at-least-24-characters",
        randomBytes(32).toString("hex"),
      ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Created .env with unique local credentials. Keep this file private.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(".env already exists; kept existing configuration.");
}
