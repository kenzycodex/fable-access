// Starts the Fable API for the browser end-to-end tests, on a fresh throwaway
// database seeded by api/scripts/e2e_seed.py. Never touches a real database:
// the seed script refuses any path that does not name an e2e file.
//
// Two ways to run it:
//   default            the API's own virtualenv on this machine (api/.venv)
//   FABLE_E2E_DOCKER=1 Linux, in a python:3.12-slim container (the production
//                      base image), with packages from the "fable-pydeps"
//                      volume. See "Running on Linux" in docs/DEPLOYMENT.md.
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
const port = process.env.E2E_API_PORT ?? "8766";

export const CONTAINER = "fable-e2e-api";
const IMAGE = process.env.FABLE_E2E_IMAGE ?? "python:3.12-slim";

export function python() {
  if (process.env.FABLE_E2E_PYTHON) return process.env.FABLE_E2E_PYTHON;
  const venv = process.platform === "win32" ? path.join(api, ".venv", "Scripts", "python.exe") : path.join(api, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python";
}

function local() {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });
  const seeded = spawnSync(python(), ["scripts/e2e_seed.py"], { cwd: api, env: process.env, stdio: "inherit" });
  if (seeded.status !== 0) process.exit(seeded.status ?? 1);
  const server = spawn(python(), ["-m", "uvicorn", "main:app", "--port", port], { cwd: api, env: process.env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
  server.on("exit", (code) => process.exit(code ?? 0));
}

function docker() {
  // The database lives in its own volume, inside the container only.
  const dbInside = `/e2e/${path.basename(db)}`;
  const forward = Object.keys(process.env).filter((k) =>
    /^(FABLE_|SMTP_|ANTHROPIC_|OPENAI_|WEBAUTHN_|ENVIRONMENT$|E2E_)/.test(k) && k !== "FABLE_DB_PATH");
  const envArgs = forward.flatMap((k) => ["-e", `${k}=${process.env[k]}`]);
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  const script = [
    `rm -f ${dbInside} ${dbInside}-wal ${dbInside}-shm`,
    "/deps/venv/bin/python scripts/e2e_seed.py",
    `exec /deps/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port ${port}`,
  ].join(" && ");
  const server = spawn("docker", [
    "run", "--rm", "--name", CONTAINER, "-p", `${port}:${port}`,
    "-v", "fable-pydeps:/deps", "-v", "fable-e2e-data:/e2e", "-v", `${api}:/app:ro`, "-w", "/app",
    "-e", `FABLE_DB_PATH=${dbInside}`, "-e", "PYTHONDONTWRITEBYTECODE=1", ...envArgs,
    IMAGE, "sh", "-c", script,
  ], { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const stop = () => spawnSync("docker", ["stop", "-t", "2", CONTAINER], { stdio: "ignore" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stop(); process.exit(0); });
  process.on("exit", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

if (process.env.FABLE_E2E_DOCKER === "1") docker();
else local();
