/**
 * Electron fixture (programmatic) — launches an Electron app via Playwright's
 * `_electron` API, wires capture hooks, and exposes lifecycle helpers.
 *
 * Adapted from electron-e2e-scaffold/templates/electron-fixture.ts.hbs but
 * stripped of the Playwright Test framework bindings — this is invoked
 * directly from action-client / run-electron, NOT from a `test()` block.
 *
 * Key choices:
 *   - We launch the entry script (or built executable) once per run.
 *   - userDataDir is provided by run-electron (isolated per-run).
 *   - We install crash + early-exit listeners BEFORE firstWindow to avoid
 *     races. A crash before firstWindow becomes an INFRA_FAILURE upstream.
 */
import { existsSync } from "node:fs";
import { _electron as electron, } from "@playwright/test";
import { bind } from "../capture/capture.js";
export async function launchElectron(args) {
    const launchOpts = {
        args: args.entryScript ? [args.entryScript] : undefined,
        cwd: args.cwd,
        timeout: args.timeoutMs ?? 30_000,
        env: { ...(args.env ?? process.env), USER_DATA_DIR: args.userDataDir, ELECTRON_USER_DATA_DIR: args.userDataDir },
        ...(args.executablePath ? { executablePath: args.executablePath } : {}),
    };
    if (args.executablePath && !existsSync(args.executablePath)) {
        throw new Error(`executablePath does not exist: ${args.executablePath}`);
    }
    if (args.entryScript && !existsSync(args.entryScript)) {
        throw new Error(`entryScript does not exist: ${args.entryScript}`);
    }
    let crashed = false;
    const app = await electron.launch(launchOpts);
    app.process().on("exit", (code, signal) => {
        if (code !== 0 && signal !== "SIGTERM") {
            crashed = true;
        }
    });
    try {
        const window = await app.firstWindow({ timeout: args.timeoutMs ?? 30_000 });
        const bound = bind(window);
        return { app, window, bound, crashedBeforeWindow: crashed };
    }
    catch (err) {
        await app.close().catch(() => undefined);
        throw err;
    }
}
export async function teardownElectron(handle) {
    try {
        await handle.app.close();
    }
    catch {
        // best effort
    }
}
/** Whether the app process crashed or exited unexpectedly during the run. */
export function isCrashed(handle) {
    return handle.crashedBeforeWindow || !handle.app.process().connected;
}
//# sourceMappingURL=electron-fixture.js.map