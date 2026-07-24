#!/usr/bin/env node
/**
 * action-client — verb-based CLI for the persona loop.
 *
 * Invocation (from a Claude Code Agent via Bash):
 *   user-simulator action observe
 *   user-simulator action click   --target "button|Submit"
 *   user-simulator action fill    --target "input|Email" --value "x@y"
 *   user-simulator action type    --value "Hello world"
 *   user-simulator action press   --value "Enter"
 *   user-simulator action select  --target "select|Theme" --value "dark"
 *   user-simulator action hover   --target "a|Settings"
 *   user-simulator action wait    --timeout_ms 2000
 *   user-simulator action checkpoint
 *   user-simulator action assert  --assertion '{"id":"x","kind":"visible","target":"h1","operator":"exists","severity_on_fail":"S1"}'
 *   user-simulator action finish
 *
 * Reads session descriptor from env vars:
 *   USER_SIM_ARTIFACT_ROOT   (required)
 *   USER_SIM_PLATFORM        web|electron
 *   USER_SIM_READY_URL       (web)
 *   USER_SIM_TARGET_EXECUTABLE   (electron)
 *   USER_SIM_TARGET_ENTRY    (electron)
 *   USER_SIM_STORAGE_STATE_PATH  (round 2 reuse)
 *
 * Output: a single JSON object on stdout, ActionResult-shaped.
 */
import { PersonaLoop } from "./persona-loop.js";
function parseArgs(argv) {
    const verb = argv[0];
    if (!verb)
        throw new Error("missing verb");
    const flags = {};
    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--"))
            throw new Error(`unexpected positional: ${arg}`);
        const eq = arg.indexOf("=");
        if (eq >= 0) {
            flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        }
        else {
            const next = argv[i + 1];
            if (next === undefined || next.startsWith("--")) {
                flags[arg.slice(2)] = "true";
            }
            else {
                flags[arg.slice(2)] = next;
                i++;
            }
        }
    }
    return { verb, flags };
}
function envOrThrow(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`missing required env var: ${name}`);
    return v;
}
function buildLoop() {
    const artifact_root = envOrThrow("USER_SIM_ARTIFACT_ROOT");
    const platform = envOrThrow("USER_SIM_PLATFORM");
    const opts = {
        artifact_root,
        platform,
        ...(process.env.USER_SIM_READY_URL ? { ready_url: process.env.USER_SIM_READY_URL } : {}),
        ...(process.env.USER_SIM_TARGET_EXECUTABLE ? { target_executable: process.env.USER_SIM_TARGET_EXECUTABLE } : {}),
        ...(process.env.USER_SIM_TARGET_ENTRY ? { target_entry: process.env.USER_SIM_TARGET_ENTRY } : {}),
        ...(process.env.USER_SIM_STORAGE_STATE_PATH ? { storage_state_path: process.env.USER_SIM_STORAGE_STATE_PATH } : {}),
    };
    return new PersonaLoop(opts);
}
async function main() {
    const subcommand = process.argv[2];
    if (subcommand !== "action") {
        throw new Error("expected: user-simulator action <verb> [--flags]");
    }
    const argv = process.argv.slice(3);
    const { verb, flags } = parseArgs(argv);
    const loop = buildLoop();
    const req = {
        verb: verb,
        ...(flags.target ? { target: flags.target } : {}),
        ...(flags.locator ? { locator: flags.locator } : {}),
        ...(flags.value !== undefined ? { value: flags.value } : {}),
        ...(flags.timeout_ms ? { timeout_ms: Number(flags.timeout_ms) } : {}),
        ...(flags.rationale ? { rationale: flags.rationale } : {}),
        ...(flags.assertion ? { assertion: JSON.parse(flags.assertion) } : {}),
    };
    try {
        const result = await loop.run(req);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.status === "failed" || result.status === "blocked") {
            process.exitCode = 2;
        }
    }
    finally {
        if (verb === "finish") {
            // loop.close() already happened inside run()
        }
        else {
            await loop.close().catch(() => undefined);
        }
    }
}
main().catch((err) => {
    process.stderr.write(`action-client error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=action-client.js.map