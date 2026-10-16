// Starts the Fable API for the browser end-to-end tests, on a fresh throwaway
// database seeded by api/scripts/e2e_seed.py. Never touches a real database:
// the seed script refuses any path that does not name an e2e file.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "api");
const db = process.env.FABLE_DB_PATH;
if (!db || !path.basename(db).includes("e2e")) {
  console.error("FABLE_DB_PATH must name a throwaway e2e database file.");
  process.exit(1);
}

export function python() {
  if (process.env.FABLE_E2E_PYTHON) return process.env.FABLE_E2E_PYTHON;
  const venv = process.platform === "win32" ? path.join(api, ".venv", "Scripts", "python.exe") : path.join(api, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python";
}

for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });

const seeded = spawnSync(python(), ["scripts/e2e_seed.py"], { cwd: api, env: process.env, stdio: "inherit" });
if (seeded.status !== 0) process.exit(seeded.status ?? 1);

const port = process.env.E2E_API_PORT ?? "8766";
const server = spawn(python(), ["-m", "uvicorn", "main:app", "--port", port], { cwd: api, env: process.env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
