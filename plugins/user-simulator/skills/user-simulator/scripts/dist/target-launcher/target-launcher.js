/**
 * Target launcher — uniform lifecycle for Web and Electron.
 *
 * - For web: returns a TargetSession with `ready_url` and a handle that the
 *   action-client uses to reconstruct the BrowserContext on resume.
 * - For electron: returns a TargetSession with `user_data_dir`, the process
 *   info, and a handle that lets action-client reconnect via _electron.launch.
 *
 * The launcher does NOT own long-lived state itself; it returns descriptors
 * that callers (action-client, report-writer) persist to the artifact root.
 */
import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchWeb } from "../run-web/run-web.js";
import { launchElectronWrapper as launchElectron } from "../run-electron/run-electron.js";
export async function launchTarget(spec, opts) {
    await mkdir(opts.artifact_root, { recursive: true });
    const run_id = makeRunId();
    if (spec.platform === "web") {
        const session = await launchWeb(spec, { run_id, artifact_root: opts.artifact_root });
        return { session };
    }
    const result = await launchElectron(spec, { run_id, artifact_root: opts.artifact_root });
    return { session: result.session, electron: result.handle };
}
export async function stopSession(session) {
    // Concrete teardown is performed inside action-client (which holds the
    // live handles). For v1 we simply record the intent in the manifest.
    // Hooks for browser.close() / app.close() are in the runner process.
}
export function detectPlatform(target) {
    // Heuristic: anything starting with http(s):// is web; absolute paths or
    // file:// URLs are treated as Electron entries. The launcher also accepts
    // --platform override from CLI args.
    if (/^https?:\/\//i.test(target))
        return "web";
    return "electron";
}
function makeRunId() {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${stamp}-${randomBytes(4).toString("hex")}`;
}
/** Build an isolated userDataDir for an Electron run (used by run-electron). */
export async function makeUserDataDir(artifact_root) {
    const dir = join(artifact_root, "userdata");
    await mkdir(dir, { recursive: true });
    return dir;
}
/** Standard place to keep dev-server logs so they don't pollute the run dir. */
export function devServerLogPath(artifact_root) {
    return join(artifact_root, "dev-server.log");
}
/** Convenience: tmpdir subdir for short-lived scripts (e.g. user-data seeding). */
export function tmpSubdir(prefix) {
    return join(tmpdir(), `${prefix}-${randomBytes(4).toString("hex")}`);
}
//# sourceMappingURL=target-launcher.js.map