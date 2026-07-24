/**
 * Probe: state management
 *
 * Most state libs are already detected by probes/package.ts. This probe
 * locates the actual store files (e.g. `src/stores/auth.ts`) so generated
 * Stories can target real data flows rather than guessing.
 *
 * Best-effort: returns store paths only when they're easy to find by glob.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const MAX_STORES = 20;
export function probeState(root, fromPkg) {
    // If the package probe already detected "none", skip file scanning
    if (fromPkg.length === 0 || (fromPkg.length === 1 && fromPkg[0]?.library === "none")) {
        return {};
    }
    const storeDirs = [
        "src/stores",
        "src/state",
        "src/renderer/stores",
        "src/renderer/state",
        "app/stores",
        "stores",
    ];
    for (const rel of storeDirs) {
        const dir = join(root, rel);
        if (!existsSync(dir))
            continue;
        const stat = statSync(dir);
        if (!stat.isDirectory())
            continue;
        const stores = listStoreFiles(dir).slice(0, MAX_STORES);
        if (stores.length === 0)
            continue;
        // Replace existing entries with same library
        const updated = fromPkg.map((s) => (s.library === "none" ? s : { ...s, stores }));
        return { state: updated };
    }
    return {};
}
function listStoreFiles(dir) {
    const out = [];
    try {
        for (const entry of readdirSync(dir)) {
            if (!/\.(ts|js|tsx|jsx)$/.test(entry))
                continue;
            if (/store|slice|reducer|atom/i.test(entry)) {
                out.push(entry);
            }
        }
    }
    catch {
        return out;
    }
    return out;
}
//# sourceMappingURL=state.js.map