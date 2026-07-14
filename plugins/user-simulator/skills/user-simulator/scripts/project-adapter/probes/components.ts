/**
 * Probe: component library
 *
 * Most component libs are detected by probes/package.ts. This probe does
 * the final resolution:
 *   1. `components.json` at root → shadcn (overrides package guess)
 *   2. `src/components/ui/` directory → shadcn (if no override)
 *   3. Otherwise return what package probe said.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProbeContribution, ComponentLib, UiInfo } from "../types.js";

export function probeComponents(root: string, fromPkg: UiInfo): ProbeContribution {
  // components.json at root is the canonical shadcn signal — override everything
  if (existsSync(join(root, "components.json"))) {
    return { ui: { ...fromPkg, componentLib: "shadcn" } };
  }
  // src/components/ui/ directory is a strong shadcn hint
  if (existsSync(join(root, "src/components/ui")) || existsSync(join(root, "components/ui"))) {
    return { ui: { ...fromPkg, componentLib: "shadcn" } };
  }
  return {};
}

// Helper for upstream probes to make sure the result is always defined.
export function ensureUi(info: ProbeContribution | undefined): UiInfo {
  const u = info?.ui;
  if (u) return u;
  return { componentLib: "none" };
}

// Re-exported for tests
export const __testing = { ensureUi: ensureUi };
const _noop: ComponentLib = "none";
void _noop;