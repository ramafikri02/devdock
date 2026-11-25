import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devdock-e2e-"));
const dataDir = path.join(tmpRoot, "app-data");
const fixtureDir = path.join(tmpRoot, "smoke-node-svc");
const markerToken = `DEVDOCK_E2E_${Date.now()}`;
const expectedOutput = `RUNTIME_OK:${markerToken}`;

function cleanup() {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(fixtureDir, { recursive: true });

  // Create fixture Node.js project whose `dev` script emits a unique stdout marker
  fs.writeFileSync(
    path.join(fixtureDir, "package.json"),
    JSON.stringify(
      {
        name: "devdock-smoke-fixture",
        version: "1.0.0",
        scripts: {
          dev: `node -e "console.log(['RUNTIME_OK', '${markerToken}'].join(':')); setInterval(() => {}, 1000);"`,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(fixtureDir, "package-lock.json"), "{}\n");

  console.log("[e2e] Building frontend dist + devdock desktop binary…");
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(pnpmCmd, ["build"], { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });
  execFileSync("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  const binName = process.platform === "win32" ? "devdock.exe" : "devdock";
  const binPath = path.join(repoRoot, "target", "debug", binName);
  if (!fs.existsSync(binPath)) {
    throw new Error(`Expected built binary at ${binPath}`);
  }

  console.log("[e2e] Launching DevDock smoke test…");
  const child = spawn(binPath, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DEVDOCK_DATA_DIR: dataDir,
      DEVDOCK_SMOKE_TEST_FIXTURE: fixtureDir,
      DEVDOCK_SMOKE_TEST_MARKER: expectedOutput,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const s = chunk.toString();
    stdout += s;
    process.stdout.write(s);
  });
  child.stderr.on("data", (chunk) => {
    const s = chunk.toString();
    stderr += s;
    process.stderr.write(s);
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("E2E smoke test timed out after 30s"));
    }, 30_000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`DevDock smoke test exited with code ${exitCode}.\nstderr:\n${stderr}`);
  }
  if (!stdout.includes("[E2E_SMOKE_OK]") || !stdout.includes(expectedOutput)) {
    throw new Error(
      `Expected [E2E_SMOKE_OK] and marker '${expectedOutput}' in stdout.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  console.log("[e2e] Smoke test passed cleanly.");
} finally {
  cleanup();
}
