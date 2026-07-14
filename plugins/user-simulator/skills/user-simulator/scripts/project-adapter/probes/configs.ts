/**
 * Probe: framework config files
 *
 * Detects framework-specific config files (next.config.*, nuxt.config.*,
 * electron.vite.config.*, vite.config.*) and refines the framework + port
 * declared by the package.json probe.
 *
 * Runs cheaply with fs.existsSync — no file reads beyond the smallest needed.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProbeContribution } from "../types.js";
import { extractPort } from "./package.js";

export function probeConfigs(root: string): ProbeContribution {
  const out: ProbeContribution = {};
  const has = (rel: string[]) => rel.some((r) => existsSync(join(root, r)));

  // Next.js: refine App Router vs Pages Router. Works whether or not
  // next.config.* exists — we use the `next` dep + filesystem layout as
  // the signal, both of which the package probe and configs probe can
  // see. Package probe sets framework="next-app-router" by default when
  // `next` is in deps; we override to "next-pages" if a `pages/` dir
  // exists with content and no `app/layout.*` at the same level.
  {
    const hasApp = has(["src/app/layout.tsx", "src/app/layout.jsx", "app/layout.tsx", "app/layout.jsx"]);
    const hasPagesDir = ["pages", "src/pages"].some((d) => {
      const full = join(root, d);
      try {
        const entries = readdirSync(full);
        return entries.some((e) => /\.(tsx|jsx|ts|js)$/.test(e));
      } catch { return false; }
    });
    if (hasPagesDir && !hasApp) {
      out.stack = { ...(out.stack ?? { framework: "next-pages", is_monorepo: false }), framework: "next-pages" };
    } else if (hasApp) {
      out.stack = { ...(out.stack ?? { framework: "next-app-router", is_monorepo: false }), framework: "next-app-router" };
    }
  }

  // Nuxt
  if (has(["nuxt.config.ts", "nuxt.config.js"])) {
    out.stack = { ...(out.stack ?? { framework: "nuxt", is_monorepo: false }), framework: "nuxt" };
  }

  // SvelteKit
  if (has(["svelte.config.js", "svelte.config.ts"])) {
    out.stack = { ...(out.stack ?? { framework: "sveltekit", is_monorepo: false }), framework: "sveltekit" };
  }

  // Electron-vite config
  if (has(["electron.vite.config.ts", "electron.vite.config.js"])) {
    out.stack = { ...(out.stack ?? { framework: "electron-vite", is_monorepo: false }), framework: "electron-vite" };
    const mainEntry = guessElectronMain(root);
    if (mainEntry) {
      out.routes = { type: "electron-main", entries: [], main_entry: mainEntry };
    }
  }

  // Vite config — read port from server.port
  const viteConfigPath = ["vite.config.ts", "vite.config.js", "vite.config.mjs"].find((p) => existsSync(join(root, p)));
  if (viteConfigPath) {
    const port = extractVitePort(join(root, viteConfigPath));
    if (port) {
      out.dev = { command: out.dev?.command ?? "vite", port, readyTimeoutMs: out.dev?.readyTimeoutMs ?? 60000, env: out.dev?.env ?? {} };
    }
  }

  // Cloudflare Workers
  if (has(["wrangler.toml", "wrangler.jsonc", "wrangler.json"])) {
    if (out.stack?.framework === "unknown" || !out.stack?.framework) {
      out.stack = { ...(out.stack ?? { framework: "cloudflare-workers", is_monorepo: false }), framework: "cloudflare-workers" };
    }
  }

  return out;
}

function extractVitePort(filePath: string): number | undefined {
  try {
    const text = readFileSync(filePath, "utf8");
    const m = text.match(/port\s*[:=]\s*(\d{2,5})/);
    return m?.[1] ? Number.parseInt(m[1], 10) : undefined;
  } catch {
    return undefined;
  }
}

function guessElectronMain(root: string): string | undefined {
  const candidates = [
    "electron/main.ts",
    "electron/main/index.ts",
    "src/main.ts",
    "src/main/index.ts",
    "electron/main.js",
    "electron/main/index.js",
  ];
  for (const c of candidates) {
    if (existsSync(join(root, c))) return c;
  }
  return undefined;
}