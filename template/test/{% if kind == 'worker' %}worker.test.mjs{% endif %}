// Starts the built worker (npm run build first): it keeps running, works on its interval, and
// exits cleanly on SIGTERM as Kubernetes sends it. Uses only Node's built-in test runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the worker runs and stops on SIGTERM", async (t) => {
  const env = { ...process.env, WORK_INTERVAL_MS: "100", DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "app-")), "app.db") };
  const worker = spawn(process.execPath, ["dist/main.js"], { env, stdio: ["ignore", "pipe", "inherit"] });
  // Whatever happens below, the worker is stopped: a child left running would hold the test run open.
  t.after(() => { if (worker.exitCode === null) worker.kill("SIGKILL"); });
  let output = "";
  worker.stdout.on("data", (chunk) => (output += chunk));
  const runs = () => (output.match(/work done/g) ?? []).length;
  // Up to ten seconds for three runs: a slow machine takes a while to start Node, not to work.
  for (let waited = 0; runs() < 3 && waited < 10_000 && worker.exitCode === null; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(worker.exitCode, null, "the worker exited on its own");
  assert.ok(runs() >= 3, "the worker did not work on its interval");
  worker.kill("SIGTERM");
  const [code] = await once(worker, "exit");
  assert.equal(code, 0);
});
