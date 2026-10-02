// Starts the built worker (npm run build first): it keeps running, works on its interval, and
// exits cleanly on SIGTERM as Kubernetes sends it. Uses only Node's built-in test runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the worker runs and stops on SIGTERM", async () => {
  const env = { ...process.env, WORK_INTERVAL_MS: "100", DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "app-")), "app.db") };
  const worker = spawn(process.execPath, ["dist/main.js"], { env, stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  worker.stdout.on("data", (chunk) => (output += chunk));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(worker.exitCode, null, "the worker exited on its own");
  assert.ok((output.match(/work done/g) ?? []).length >= 3, "the worker did not work on its interval");
  worker.kill("SIGTERM");
  const [code] = await once(worker, "exit");
  assert.equal(code, 0);
});
