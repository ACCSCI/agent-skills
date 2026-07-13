/**
 * Web target launcher.
 *
 * - If the target is an http(s) URL, it is used directly. We wait for it to
 *   respond (HEAD or fetch) before declaring ready.
 * - If --dev-command was provided, spawn it, capture its stdout/stderr to
 *   dev-server.log, and wait for ready_url to respond.
 *
 * Returns a TargetSession; the live BrowserContext is created lazily inside
 * action-client when the first action runs. We don't open it here to avoid
 * tying the launcher's lifetime to action-client's.
 */

import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import type { TargetSession, TargetSpec } from "../common/contracts.js";
import { devServerLogPath } from "../target-launcher/target-launcher.js";

export interface LaunchWebOpts {
  run_id: string;
  artifact_root: string;
}

export async function launchWeb(spec: TargetSpec, opts: LaunchWebOpts): Promise<TargetSession> {
  const readyUrl = spec.ready_url ?? spec.resolved;
  if (spec.dev_command) {
    await startDevCommand(spec.dev_command, opts.artifact_root);
  }
  await waitForReady(readyUrl, 60_000);
  return {
    run_id: opts.run_id,
    platform: "web",
    pid: process.pid,
    started_at: new Date().toISOString(),
    artifact_root: opts.artifact_root,
    ready_url: readyUrl,
    handle: { kind: "web", url: readyUrl },
  };
}

async function startDevCommand(cmd: string, artifact_root: string): Promise<void> {
  const log = devServerLogPath(artifact_root);
  await appendFile(log, `\n$ ${cmd}\n`);
  const child = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout?.on("data", (d) => appendFile(log, d));
  child.stderr?.on("data", (d) => appendFile(log, d));
  child.unref();
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Use raw fetch — avoids needing a Playwright browser before launch.
  // The action-client will own the actual browser context.
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Web target never became ready: ${url}`);
}