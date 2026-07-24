/**
 * Electron target launcher — resolve executable/entry, hand off to the
 * programmatic Electron fixture, persist session descriptor.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { launchElectron, teardownElectron } from "./electron-fixture.js";
export async function launchElectronWrapper(spec, opts) {
    const { entry, executablePath } = await resolveEntry(spec);
    const userDataDir = join(opts.artifact_root, "userdata");
    const handle = await launchElectron({
        executablePath,
        entryScript: entry,
        cwd: process.cwd(),
        userDataDir,
        timeoutMs: 30_000,
    });
    const session = {
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
async function resolveEntry(spec) {
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
//# sourceMappingURL=run-electron.js.map