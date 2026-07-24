/**
 * Probe: routing convention
 *
 * Detects route directory pattern (Next App Router, Next Pages, TanStack
 * Router, SvelteKit, electron main) and returns entry paths.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const MAX_ENTRIES = 200;
export function probeRoutes(root) {
    const out = {};
    // Next App Router
    if (existsSync(join(root, "src/app"))) {
        const entries = listRouteFiles(join(root, "src/app"));
        if (entries.length > 0 || existsSync(join(root, "src/app/layout.tsx"))) {
            out.routes = { type: "app-router", entries };
            return out;
        }
    }
    if (existsSync(join(root, "app"))) {
        const entries = listRouteFiles(join(root, "app"));
        if (entries.length > 0) {
            out.routes = { type: "app-router", entries };
            return out;
        }
    }
    // Next Pages
    if (existsSync(join(root, "src/pages")) || existsSync(join(root, "pages"))) {
        out.routes = { type: "pages", entries: listRouteFiles(existsSync(join(root, "src/pages")) ? join(root, "src/pages") : join(root, "pages")) };
        return out;
    }
    // TanStack Router (file-based)
    if (existsSync(join(root, "src/routes")) || existsSync(join(root, "src/renderer/routes"))) {
        const dir = existsSync(join(root, "src/routes")) ? join(root, "src/routes") : join(root, "src/renderer/routes");
        const entries = listRouteFiles(dir);
        if (entries.length > 0) {
            out.routes = { type: "src-routes", entries };
            return out;
        }
    }
    // SvelteKit
    if (existsSync(join(root, "src/routes")) && existsSync(join(root, "svelte.config.js") || join(root, "svelte.config.ts"))) {
        out.routes = { type: "src-routes", entries: listRouteFiles(join(root, "src/routes")) };
        return out;
    }
    // Electron main
    if (existsSync(join(root, "electron/main.ts")) || existsSync(join(root, "electron/main/index.ts")) || existsSync(join(root, "src/main/index.ts"))) {
        const mainEntry = existsSync(join(root, "electron/main/index.ts")) ? "electron/main/index.ts"
            : existsSync(join(root, "electron/main.ts")) ? "electron/main.ts"
                : "src/main/index.ts";
        out.routes = { type: "electron-main", entries: [], main_entry: mainEntry };
        return out;
    }
    out.routes = { type: "none", entries: [] };
    return out;
}
function listRouteFiles(dir) {
    const out = [];
    try {
        walk(dir, "", out, 0);
    }
    catch {
        return out;
    }
    return out.slice(0, MAX_ENTRIES);
}
function walk(dir, rel, out, depth) {
    if (depth > 4 || out.length >= MAX_ENTRIES)
        return;
    const stat = statSync(dir);
    if (!stat.isDirectory())
        return;
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith("."))
            continue;
        if (entry === "node_modules")
            continue;
        const child = join(dir, entry);
        const childStat = statSync(child);
        const childRel = rel ? `${rel}/${entry}` : entry;
        if (childStat.isDirectory()) {
            walk(child, childRel, out, depth + 1);
        }
        else if (/\.(tsx|ts|jsx|js|vue|svelte)$/.test(entry)) {
            out.push(childRel);
        }
    }
}
//# sourceMappingURL=routes.js.map