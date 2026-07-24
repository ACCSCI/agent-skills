/**
 * Probe: package.json
 *
 * Reads `<root>/package.json` (if present) and returns framework hints,
 * scripts, dev dependencies. Skips silently when no package.json.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const ELECTRON_DEPS = ["electron", "electron-builder", "electron-vite", "vite-plugin-electron", "electronmon"];
const NEXT_DEPS = ["next"];
const NUXT_DEPS = ["nuxt"];
const SVELTEKIT_DEPS = ["@sveltejs/kit"];
const TYPING_REACT = ["react", "react-dom"];
const VITE_DEPS = ["vite"];
const CLOUDFLARE_DEPS = ["wrangler", "@cloudflare/workers-types"];
const TAILWIND_DEPS = ["tailwindcss"];
const COMPONENT_LIBS = [
    { lib: "shadcn", keys: ["class-variance-authority", "tailwind-merge", "lucide-react"] },
    { lib: "heroui", keys: ["@heroui/react", "@nextui-org/react"] },
    { lib: "mui", keys: ["@mui/material"] },
    { lib: "chakra", keys: ["@chakra-ui/react"] },
    { lib: "antd", keys: ["antd"] },
    { lib: "mantine", keys: ["@mantine/core"] },
    { lib: "base-ui", keys: ["@base-ui/react"] },
];
const STATE_LIBS = [
    { lib: "zustand", keys: ["zustand"] },
    { lib: "redux", keys: ["@reduxjs/toolkit", "redux"] },
    { lib: "pinia", keys: ["pinia"] },
    { lib: "vuex", keys: ["vuex"] },
    { lib: "mobx", keys: ["mobx"] },
    { lib: "jotai", keys: ["jotai"] },
    { lib: "valtio", keys: ["valtio"] },
    { lib: "tanstack-query", keys: ["@tanstack/react-query", "@tanstack/vue-query"] },
];
const ANY_DEPS = (...deps) => (pkg) => [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].some((d) => deps.includes(d));
const hasAny = (keys) => (pkg) => [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].some((d) => keys.includes(d));
export async function probePackage(root) {
    const out = {};
    let pkg;
    try {
        const raw = await readFile(join(root, "package.json"), "utf8");
        pkg = JSON.parse(raw);
    }
    catch {
        return out; // no package.json → caller will fall back to other probes
    }
    out.stack = {
        framework: "unknown",
        is_monorepo: false,
        ...(pkg.version !== undefined ? { version: pkg.version } : {}),
    };
    if (ANY_DEPS(...NEXT_DEPS)(pkg)) {
        out.stack.framework = "next-app-router"; // refined by configs probe
    }
    else if (ANY_DEPS(...NUXT_DEPS)(pkg)) {
        out.stack.framework = "nuxt";
    }
    else if (ANY_DEPS(...SVELTEKIT_DEPS)(pkg)) {
        out.stack.framework = "sveltekit";
    }
    else if (hasAny(ELECTRON_DEPS)(pkg)) {
        // Refined by configs probe: electron-vite vs vite-plugin-electron vs esbuild
        if (ANY_DEPS("electron-vite")(pkg))
            out.stack.framework = "electron-vite";
        else if (ANY_DEPS("vite-plugin-electron")(pkg))
            out.stack.framework = "electron-vite-plugin";
        else if (ANY_DEPS("electronmon", "esbuild")(pkg))
            out.stack.framework = "electron-esbuild";
        else
            out.stack.framework = "electron-vite";
    }
    else if (ANY_DEPS(...CLOUDFLARE_DEPS)(pkg) && !ANY_DEPS(...TYPING_REACT)(pkg)) {
        out.stack.framework = "cloudflare-workers";
    }
    else if (hasAny(VITE_DEPS)(pkg) && hasAny(TYPING_REACT)(pkg)) {
        out.stack.framework = "vite-react";
    }
    // Monorepo detection
    if (pkg.workspaces) {
        out.stack.is_monorepo = true;
        out.stack.monorepo_tool = "pnpm"; // refined by configs probe
        out.stack.workspace_members = Array.isArray(pkg.workspaces)
            ? pkg.workspaces
            : (pkg.workspaces.packages ?? []);
    }
    // Dev command + port from scripts
    const scripts = pkg.scripts ?? {};
    const devScript = scripts.dev ?? scripts.start ?? scripts["dev:web"] ?? scripts["dev:frontend"];
    if (devScript && !out.dev) {
        out.dev = {
            command: devScript,
            port: extractPort(devScript) ?? 3000,
            readyTimeoutMs: 60000,
            env: {},
        };
    }
    // UI library
    for (const { lib, keys } of COMPONENT_LIBS) {
        if (hasAny(keys)(pkg)) {
            out.ui = { componentLib: lib };
            break;
        }
    }
    if (!out.ui && hasAny(TAILWIND_DEPS)(pkg)) {
        out.ui = { componentLib: "tailwind-only" };
    }
    if (!out.ui) {
        out.ui = { componentLib: "none" };
    }
    // State management
    out.state = [];
    for (const { lib, keys } of STATE_LIBS) {
        if (hasAny(keys)(pkg)) {
            out.state.push({ library: lib, stores: [] });
        }
    }
    if (out.state.length === 0) {
        out.state = [{ library: "none", stores: [] }];
    }
    return out;
}
const PORT_PATTERN = /(?:-p|--port[=\s ])(\d{2,5})/g;
export function extractPort(command) {
    const matches = [...command.matchAll(PORT_PATTERN)];
    const last = matches.at(-1);
    if (!last || last[1] === undefined)
        return undefined;
    return Number.parseInt(last[1], 10);
}
//# sourceMappingURL=package.js.map