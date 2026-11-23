import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// L11: tests run against prisma/test.sqlite, never the development database.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = path.join(root, "prisma", "test.sqlite");

export default function setup() {
  rmSync(dbFile, { force: true });
  rmSync(`${dbFile}-journal`, { force: true });
  execSync("npx prisma migrate deploy", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "file:./test.sqlite" },
    stdio: "ignore",
  });
}
