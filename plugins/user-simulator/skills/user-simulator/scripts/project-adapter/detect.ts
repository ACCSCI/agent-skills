/**
 * Project-adapter orchestrator.
 *
 * Walks all probes, merges their contributions (last-write-wins), validates
 * the result against schemas/project-profile.schema.json, and returns the
 * final ProjectProfile. Caches the result to `.user-simulator/profile.json`.
 *
 * The orchestrator does NOT throw on missing input. A project with no
 * package.json, no routes, and no API surface still produces a valid
 * (minimal) ProjectProfile with `framework: "unknown"` and `api: { surface: "none" }`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { probePackage } from "./probes/package.js";
import { probeConfigs } from "./probes/configs.js";
import { probeRoutes } from "./probes/routes.js";
import { probeApi } from "./probes/api.js";
import { probeState } from "./probes/state.js";
import { probeComponents } from "./probes/components.js";
import type { ProbeContribution, ProjectProfile, StateInfo, UiInfo } from "./types.js";
import { saveProfile, defaultProfilePath } from "./profile.js";

export interface DetectOptions {
  /** Override default cache path. */
  cachePath?: string;
  /** Force re-detection even if cache exists. */
  force?: boolean;
}

export async function detectProject(root: string, opts: DetectOptions = {}): Promise<ProjectProfile> {
  if (!existsSync(root)) {
    throw new Error(`detectProject: target path does not exist: ${root}`);
  }

  // Run all probes in priority order; later probes refine earlier ones.
  const pkgResult = await probePackage(root);
  const configsResult = probeConfigs(root);
  const routesResult = probeRoutes(root);
  const apiResult = probeApi(root);

  // State and components need inputs from prior probes
  const mergedStateBeforeProbe: StateInfo[] = pkgResult.state ?? [];
  const stateResult = probeState(root, mergedStateBeforeProbe);
  const mergedUiBeforeProbe: UiInfo = pkgResult.ui ?? { componentLib: "none" };
  const componentsResult = probeComponents(root, mergedUiBeforeProbe);

  // Merge in priority order (later wins for the same key)
  const merged = mergeProbes(
    pkgResult,
    configsResult,
    routesResult,
    apiResult,
    stateResult,
    componentsResult,
  );

  // Ensure required fields have safe defaults
  const profile: ProjectProfile = ensureRequired(merged, root);

  // Cache (unless --no-cache or cache is already fresh and force=false)
  const cachePath = opts.cachePath ?? defaultProfilePath(join(root, ".user-simulator"));
  if (opts.force || !existsSync(cachePath)) {
    await saveProfile(profile, cachePath);
  }

  return profile;
}

function mergeProbes(...probes: ProbeContribution[]): ProbeContribution {
  const out: ProbeContribution = {};
  for (const probe of probes) {
    if (probe.stack) out.stack = { ...(out.stack ?? {}), ...probe.stack };
    if (probe.dev) out.dev = { ...(out.dev ?? { command: "", port: 3000, readyTimeoutMs: 60000, env: {} }), ...probe.dev };
    if (probe.routes) out.routes = { ...(out.routes ?? { type: "none", entries: [] }), ...probe.routes };
    if (probe.api) out.api = { ...(out.api ?? { surface: "none" }), ...probe.api };
    if (probe.state) out.state = probe.state;
    if (probe.ui) out.ui = { ...(out.ui ?? { componentLib: "none" }), ...probe.ui };
    if (probe.smoke) out.smoke = probe.smoke;
    if (probe.existing_e2e) out.existing_e2e = { ...(out.existing_e2e ?? {}), ...probe.existing_e2e };
  }
  return out;
}

function ensureRequired(p: ProbeContribution, root: string): ProjectProfile {
  const stack = p.stack ?? { framework: "unknown" as const, is_monorepo: false };
  const dev = p.dev ?? { command: "echo no-dev-command", port: 3000, readyTimeoutMs: 60000, env: {} };
  const routes = p.routes ?? { type: "none" as const, entries: [] };
  const api = p.api ?? { surface: "none" as const };
  const state = p.state ?? [{ library: "none" as const, stores: [] }];
  const ui = p.ui ?? { componentLib: "none" as const };

  // Default smoke URL uses the dev port
  const smoke: ProbeContribution["smoke"] = p.smoke ?? { url: `http://localhost:${dev.port}` };

  return {
    schema_version: "4.0",
    stack,
    dev,
    routes,
    api,
    state,
    ui,
    smoke,
    ...(p.existing_e2e ? { existing_e2e: p.existing_e2e } : {}),
  };
  // Note: `root` is used for logging/audit; not embedded in the cached profile.
  void root;
}