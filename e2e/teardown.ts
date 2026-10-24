import { spawnSync } from "node:child_process";

// The API container (FABLE_E2E_DOCKER=1) outlives Playwright's stop signal on
// Windows, so it is removed here once the run ends.
export default function teardown() {
  if (process.env.FABLE_E2E_DOCKER === "1") spawnSync("docker", ["rm", "-f", "fable-e2e-api"], { stdio: "ignore" });
}
