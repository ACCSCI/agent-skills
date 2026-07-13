/**
 * Electron target launcher — resolve executable/entry, hand off to the
 * programmatic Electron fixture, persist session descriptor.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { TargetSession, TargetSpec } from "../common/contracts.js";
import { launchElectron, teardownElectron, type ElectronHandle } from "./electron-fixture.js";

export interface LaunchElectronOpts {
  run_id: string;
  artifact_root: string;
}

export interface ElectronLaunchResult {
  session: TargetSession;
  handle: ElectronHandle;
}

export async function launchElectronWrapper(spec: TargetSpec, opts: LaunchElectronOpts): Promise<ElectronLaunchResult> {
  const { entry, executablePath } = await resolveEntry(spec);
  const userDataDir = join(opts.artifact_root, "userdata");
  const handle = await launchElectron({
    executablePath,
    entryScript: entry,
    cwd: process.cwd(),
    userDataDir,
    timeoutMs: 30_000,
  });
  const session: TargetSession = {
    run_id: opts.run_id,
    platform: "electron",
    pid: handle.app.process().pid ?? process.pid,
    started_at: new Date().toISOString(),
    artifact_root: opts.artifact_root,
    user_data_dir: userDataDir,
    handle: { kind: "electron", pid: handle.app.process().pid, entry, executablePath },
  };
  return { session, handle };
}

async function resolveEntry(spec: TargetSpec): Promise<{ entry?: string; executablePath?: string }> {
  const target = spec.resolved;
  if (/\.exe$/i.test(target)) {
    await stat(target);
    return { executablePath: target };
  }
  if (/\.(ts|js|mjs|cjs)$/.test(target)) {
    await stat(target);
    return { entry: target };
  }
  // Fallback: treat as a directory's main entry.
  await stat(target);
  return { entry: target };
}

export { teardownElectron };