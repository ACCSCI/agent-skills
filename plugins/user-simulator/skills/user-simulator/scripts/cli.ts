#!/usr/bin/env node
/**
 * user-simulator CLI — top-level entry dispatched by the SKILL.
 *
 * Subcommands:
 *   validate --persona <yaml> --story <yaml>          Validate YAML against schemas.
 *   launch  --target <url|path> --platform <web|electron> [--dev-command <cmd>] [--ready-url <url>]
 *                                                    Launch the target; write manifest.json.
 *   detect  --artifact-root <dir> [--step-id <id>] [--route <r>] [--window <w>]
 *           [--vision <json>] [--signals <ndjson>]
 *                                                    Run the bug-detector over collected signals.
 *   report  --artifact-root <dir>                     Render Markdown report.md + bugs.json.
 *   compare --baseline <run-id> --artifact-root <dir> Run round-comparator; write verification-report.md.
 *   stop    --artifact-root <dir>                     Best-effort teardown of an in-progress run.
 *
 * The `action` verb dispatcher lives in ./persona-loop/action-client.ts (separate bin).
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile, writeFile } from "node:fs/promises";
import type { Bug, InfraFailure, Persona, Story } from "./common/contracts.js";
import { ArtifactStore } from "./common/artifact-store.js";
import { classifyInfra } from "./bug-detect/failure-classifier.js";
import { detectFromSignals, visionFindingsToInputs, type DetectorInput } from "./bug-detect/bug-detector.js";
import { renderMarkdownReport } from "./report/report-writer.js";
import { compareRounds } from "./report/round-comparator.js";

// NOTE: target-launcher, run-web, run-electron, persona-loop, capture are
// dynamically imported inside main() / launchCommand() so a missing or
// broken Playwright install produces an INFRA_FAILURE report rather than
// crashing the CLI at module load time with an opaque "Cannot find module"
// stack. bug-detector, report-writer, round-comparator, failure-classifier,
// and the schemas do NOT depend on @playwright/test, so they are safe to
// import statically.

// NOTE: All Playwright-touching modules (target-launcher, run-web, run-electron,
// persona-loop, capture, bug-detector, report-writer, round-comparator) are
// dynamically imported inside main() so a missing or broken Playwright install
// produces an INFRA_FAILURE report rather than crashing the CLI at module
// load time with an opaque "Cannot find module" stack.

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[arg.slice(2)] = "true";
      else { flags[arg.slice(2)] = next; i++; }
    }
  }
  return flags;
}

async function loadJsonSchema(path: string): Promise<object> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function validateCommand(flags: Record<string, string>): Promise<number> {
  const ajv = new Ajv2020.default({ allErrors: true, strict: false });
  addFormats.default(ajv);
  const personaSchema = await loadJsonSchema(resolve(import.meta.dirname, "../schemas/persona.schema.json")) as object;
  const storySchema = await loadJsonSchema(resolve(import.meta.dirname, "../schemas/story.schema.json")) as object;
  let ok = true;
  if (flags.persona) {
    const persona = parseYaml(await readFile(flags.persona, "utf8")) as Persona;
    const validate = ajv.compile(personaSchema);
    if (!validate(persona)) {
      ok = false;
      process.stderr.write(`persona invalid: ${JSON.stringify(validate.errors, null, 2)}\n`);
    }
  }
  if (flags.story) {
    const story = parseYaml(await readFile(flags.story, "utf8")) as Story;
    const validate = ajv.compile(storySchema);
    if (!validate(story)) {
      ok = false;
      process.stderr.write(`story invalid: ${JSON.stringify(validate.errors, null, 2)}\n`);
    }
  }
  process.stdout.write(`${ok ? "OK" : "INVALID"}\n`);
  return ok ? 0 : 1;
}

async function launchCommand(flags: Record<string, string>): Promise<number> {
  const targetRaw = flags.target;
  if (!targetRaw) throw new Error("--target is required");
  const platformOverride = flags.platform as "auto" | "web" | "electron" | undefined;
  // Dynamic import so a missing @playwright/test surfaces as a clear
  // INFRA_FAILURE from the pre-flight probe in main() rather than a
  // module-load crash.
  const { launchTarget, detectPlatform } = await import("./target-launcher/target-launcher.js");
  const platform = platformOverride && platformOverride !== "auto" ? platformOverride : detectPlatform(targetRaw);
  const artifactRoot = flags["artifact-root"] ?? `.user-simulator/runs/latest`;
  const startedAt = new Date().toISOString();
  try {
    await mkdir(artifactRoot, { recursive: true });
    const result = await launchTarget(
      {
        raw: targetRaw,
        platform,
        resolved: platformOverride === "web" ? flags["ready-url"] ?? targetRaw : targetRaw,
        ...(flags["dev-command"] ? { dev_command: flags["dev-command"] } : {}),
        ...(flags["ready-url"] ? { ready_url: flags["ready-url"] } : {}),
      },
      { artifact_root: artifactRoot },
    );
    const store = new ArtifactStore({ artifact_root: artifactRoot });
    await store.writeJson("manifest", "session.json", result.session);
    process.stdout.write(`${JSON.stringify({ run_id: result.session.run_id, artifact_root: result.session.artifact_root })}\n`);
    return 0;
  } catch (err) {
    const { failure, hint } = await recordInfraFailure({
      artifactRoot,
      platform,
      target: targetRaw,
      error: err,
      startedAt,
    });
    process.stdout.write(`${JSON.stringify({ verdict: "INFRA_FAILURE", kind: failure.kind, hint, artifact_root: artifactRoot })}\n`);
    process.stderr.write(`\n⚠️  user-simulator launch failed (INFRA_FAILURE: ${failure.kind})\n` +
      `   ${hint}\n` +
      `   Full debug: ${artifactRoot}/infra-debug.log\n` +
      `   Manifest:   ${artifactRoot}/manifest/manifest.json\n`);
    return 3;
  }
}

async function detectCommand(
  flags: Record<string, string>,
): Promise<number> {
  const artifactRoot = flags["artifact-root"];
  if (!artifactRoot) throw new Error("--artifact-root is required");
  const runId = flags["run-id"] ?? "manual";
  const inputs: DetectorInput[] = [];
  if (flags.signals) {
    const lines = (await readFile(flags.signals, "utf8")).split("\n").filter(Boolean);
    for (const line of lines) {
      const obj = JSON.parse(line) as { kind: string; entry: unknown; step_id?: string; route?: string; window?: string };
      if (obj.kind === "infra") {
        const cls = classifyInfra({ errorMessage: typeof obj.entry === "object" && obj.entry && "message" in obj.entry ? String((obj.entry as { message: unknown }).message) : String(obj.entry) });
        process.stderr.write(`infra failure ignored from product list: ${cls.kind} — ${cls.reason}\n`);
        continue;
      }
      inputs.push({
        run_id: runId,
        step_id: obj.step_id,
        route: obj.route,
        window: obj.window,
        message: typeof obj.entry === "object" && obj.entry ? JSON.stringify(obj.entry) : String(obj.entry),
        detectors: [obj.kind as DetectorInput["detectors"][number]],
        severity: "S2",
        confidence: "medium",
        type: "functional",
        title: String((obj.entry as { title?: unknown })?.title ?? obj.kind),
      });
    }
  }
  if (flags.vision) {
    const vision = JSON.parse(await readFile(flags.vision, "utf8")) as Parameters<typeof visionFindingsToInputs>[1];
    inputs.push(...visionFindingsToInputs(runId, vision, flags["step-id"], flags.route, flags.window));
  }
  const result = detectFromSignals(inputs);
  const store = new ArtifactStore({ artifact_root: artifactRoot });
  await store.writeJson("bug", "bugs.json", { confirmed: result.bugs, candidates: result.candidates });
  process.stdout.write(`${JSON.stringify({ confirmed: result.bugs.length, candidates: result.candidates.length })}\n`);
  return 0;
}

async function reportCommand(
  flags: Record<string, string>,
): Promise<number> {
  const artifactRoot = flags["artifact-root"];
  if (!artifactRoot) throw new Error("--artifact-root is required");
  const store = new ArtifactStore({ artifact_root: artifactRoot });
  const bugsRaw = JSON.parse(await readFile(resolve(artifactRoot, "bugs.json"), "utf8")) as { confirmed: Bug[]; candidates: Bug[] };
  const manifest = JSON.parse(await readFile(resolve(artifactRoot, "manifest/manifest.json"), "utf8").catch(async () => {
    // Fallback: session.json from launch
    return readFile(resolve(artifactRoot, "manifest/session.json"), "utf8");
  })) as { run_id: string };
  const md = renderMarkdownReport({
    run_id: manifest.run_id,
    confirmed: bugsRaw.confirmed,
    candidates: bugsRaw.candidates,
    artifact_root: artifactRoot,
  });
  await store.writeJson("report", "report.md", { markdown: md });
  process.stdout.write(`${JSON.stringify({ report: "report.md", confirmed: bugsRaw.confirmed.length, candidates: bugsRaw.candidates.length })}\n`);
  return 0;
}

async function compareCommand(
  flags: Record<string, string>,
): Promise<number> {
  const baseline = flags.baseline;
  const artifactRoot = flags["artifact-root"];
  if (!baseline || !artifactRoot) throw new Error("--baseline and --artifact-root are required");
  const baseBugs = JSON.parse(await readFile(resolve(artifactRoot, "..", baseline, "bugs.json"), "utf8")) as { confirmed: Bug[] };
  const curBugs = JSON.parse(await readFile(resolve(artifactRoot, "bugs.json"), "utf8")) as { confirmed: Bug[] };
  const diff = compareRounds(baseBugs.confirmed, curBugs.confirmed, baseline);
  const store = new ArtifactStore({ artifact_root: artifactRoot });
  await store.writeJson("report", "comparison.json", diff);
  const md = renderVerificationReport(diff);
  await store.writeJson("report", "verification-report.md", { markdown: md });
  process.stdout.write(`${JSON.stringify({ verdict: diff.verdict, reason: diff.reason })}\n`);
  return 0;
}

async function stopCommand(flags: Record<string, string>): Promise<number> {
  const artifactRoot = flags["artifact-root"];
  if (!artifactRoot) throw new Error("--artifact-root is required");
  // Best effort: read session.json, log intent. Actual handles are closed by
  // the action-client lifecycle, which is owned by the Agent.
  process.stdout.write(`${JSON.stringify({ intent: "stop", artifact_root: artifactRoot })}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// v4 subcommands: detect-project / scaffold / verify-api
// ---------------------------------------------------------------------------

async function detectProjectCommand(flags: Record<string, string>): Promise<number> {
  const root = flags.target;
  if (!root) {
    process.stderr.write("--target is required for detect-project\n");
    return 2;
  }
  const { detectProject } = await import("./project-adapter/detect.js");
  const cachePath = flags["cache-path"];
  const profile = await detectProject(root, {
    ...(cachePath ? { cachePath } : {}),
    ...(flags.force === "true" ? { force: true } : {}),
  });
  if (flags.json === "true") {
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
  } else {
    process.stdout.write(`ProjectProfile (v4) for ${root}\n`);
    process.stdout.write(`  framework: ${profile.stack.framework}${profile.stack.is_monorepo ? ` (monorepo: ${profile.stack.monorepo_tool})` : ""}\n`);
    process.stdout.write(`  dev: ${profile.dev.command} (port ${profile.dev.port})\n`);
    process.stdout.write(`  routes: ${profile.routes.type}${profile.routes.entries.length > 0 ? ` (${profile.routes.entries.length} entries)` : ""}\n`);
    process.stdout.write(`  api: ${profile.api.surface}${profile.api.endpoint ? ` @ ${profile.api.endpoint}` : ""}\n`);
    process.stdout.write(`  state: ${profile.state.map((s) => s.library).join(", ")}\n`);
    process.stdout.write(`  ui: ${profile.ui.componentLib}\n`);
  }
  return 0;
}

async function scaffoldCommand(flags: Record<string, string>): Promise<number> {
  const root = flags.target;
  if (!root) {
    process.stderr.write("--target is required for scaffold\n");
    return 2;
  }
  const { detectProject } = await import("./project-adapter/detect.js");
  const { scaffoldProject } = await import("./scaffold/scaffold.js");
  const profile = await detectProject(root, { force: flags.force === "true" });
  const result = await scaffoldProject(root, profile, { force: flags.force === "true" });
  if (result.electronDeferredTo) {
    process.stdout.write(`${result.electronDeferredTo}\n`);
    return 0;
  }
  if (result.refused.length > 0) {
    process.stderr.write(`refused to overwrite (use --force): ${result.refused.join(", ")}\n`);
    return 4;
  }
  process.stdout.write(`Scaffold complete (${result.filesWritten.length} files written${result.packageJsonPatched ? " + package.json" : ""}${result.gitignorePatched ? " + .gitignore" : ""})\n`);
  for (const f of result.filesWritten) process.stdout.write(`  + ${f}\n`);
  process.stdout.write(`\nTo run: cd ${root} && npx playwright test\n`);
  return 0;
}

async function verifyApiCommand(flags: Record<string, string>): Promise<number> {
  const root = flags.target;
  const storyPath = flags.story;
  if (!root || !storyPath) {
    process.stderr.write("--target and --story are required for verify-api\n");
    return 2;
  }
  const { detectProject } = await import("./project-adapter/detect.js");
  const { AssertionRunner } = await import("./api-verify/assertion-runner.js");
  const { readFile } = await import("node:fs/promises");
  const { parse: parseYaml } = await import("yaml");

  const profile = await detectProject(root);
  if (profile.api.surface === "none") {
    process.stderr.write(`ProjectProfile.api.surface = "none" — nothing to verify. Run \`user-simulator detect-project --target ${root}\` to inspect.\n`);
    return 5;
  }

  const story = parseYaml(await readFile(storyPath, "utf8")) as { steps?: Array<{ id: string; api_assertions?: Array<Record<string, unknown>> }> };
  const allAssertions: Array<{ assertion: Record<string, unknown>; onStep: string }> = [];
  for (const step of story.steps ?? []) {
    // When --step <id> is given, only run that step's assertions
    if (flags.step && step.id !== flags.step) continue;
    for (const a of step.api_assertions ?? []) {
      allAssertions.push({ assertion: a, onStep: step.id });
    }
  }
  if (allAssertions.length === 0) {
    process.stdout.write(`Story${flags.step ? ` step ${flags.step}` : ""} has no api_assertions — nothing to verify.\n`);
    return 0;
  }

  const runner = new AssertionRunner({ api: profile.api });
  const results = await runner.runAll({ assertions: allAssertions.map((a) => a.assertion as never) });

  let pass = 0;
  let fail = 0;
  for (const r of results) {
    const status = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "?";
    process.stdout.write(`${status} ${r.assertion_id} (${r.duration_ms}ms): ${r.message}\n`);
    if (r.status === "pass") pass++;
    else fail++;
  }
  process.stdout.write(`\n${pass} pass, ${fail} fail (of ${results.length})\n`);
  return fail === 0 ? 0 : 1;
}

function renderVerificationReport(diff: ReturnType<typeof compareRounds>): string {
  const lines: string[] = [`# Round 2 Verification Report\n`, `\n**Verdict**: ${diff.verdict}\n`, `\n**Reason**: ${diff.reason}\n`];
  if (diff.targeted.length) {
    lines.push(`\n## Targeted (Round 1 → Round 2)\n`);
    for (const t of diff.targeted) {
      lines.push(`- ${t.baseline_bug_id} (${t.baseline_fingerprint.slice(0, 12)}…) → ${t.status}${t.notes ? ` — ${t.notes}` : ""}`);
    }
  }
  if (diff.regression.length) {
    lines.push(`\n## Regression\n`);
    for (const t of diff.regression) lines.push(`- ${t.baseline_bug_id}: ${t.status}`);
  }
  if (diff.new_bugs.length) {
    lines.push(`\n## New Bugs\n`);
    for (const b of diff.new_bugs) lines.push(`- ${b.severity} ${b.title} (${b.bug_id})`);
  }
  if (diff.persistent.length) {
    lines.push(`\n## Persistent\n`);
    for (const b of diff.persistent) lines.push(`- ${b.severity} ${b.title} (${b.bug_id})`);
  }
  if (diff.inconclusive.length) {
    lines.push(`\n## Inconclusive\n`);
    for (const b of diff.inconclusive) lines.push(`- ${b.severity} ${b.title} (${b.bug_id})`);
  }
  return lines.join("\n");
}

/**
 * Convert an error thrown by the target launcher into a structured
 * INFRA_FAILURE artifact (manifest + infra-debug.log) so the user has
 * actionable evidence instead of a single stderr line.
 */
async function recordInfraFailure(args: {
  artifactRoot: string;
  platform: "web" | "electron";
  target: string;
  error: unknown;
  startedAt: string;
}): Promise<{ manifest: object; failure: InfraFailure; hint: string }> {
  await mkdir(args.artifactRoot, { recursive: true });
  const err = args.error instanceof Error ? args.error : new Error(String(args.error));
  const stack = err.stack ?? "(no stack)";
  const cls = classifyInfra({ errorMessage: err.message, stackTrace: stack });
  const failure: InfraFailure = {
    kind: cls.kind,
    message: err.message.slice(0, 1000),
    ...(stack ? { evidence: { stack: stack.slice(0, 4000) } } : {}),
    at: new Date().toISOString(),
  };
  const manifest = {
    run_id: "launch-failed",
    round: 1 as const,
    platform: args.platform,
    target: { raw: args.target, platform: args.platform, resolved: args.target },
    started_at: args.startedAt,
    finished_at: new Date().toISOString(),
    verdict: "INFRA_FAILURE" as const,
    infra_failure: failure,
  };
  const store = new ArtifactStore({ artifact_root: args.artifactRoot });
  await store.writeJson("manifest", "manifest.json", manifest);
  // Human-readable debug log
  const debug = [
    `# user-simulator launch failed`,
    ``,
    `**At**: ${failure.at}`,
    `**Platform**: ${args.platform}`,
    `**Target**: ${args.target}`,
    ``,
    `## Infra classification`,
    ``,
    `- **kind**: ${cls.kind}`,
    `- **confidence**: ${cls.confidence}`,
    `- **reason**: ${cls.reason}`,
    `- **suggested_action**: ${cls.suggestedAction}`,
    ``,
    `## Hint`,
    ``,
    cls.reason.includes("patterns") ? cls.reason : "",
    `See SKILL.md → 故障处理 for the matching playbook.`,
    ``,
    `## Stack`,
    ``,
    "```",
    stack,
    "```",
  ].join("\n");
  await writeFile(resolve(args.artifactRoot, "infra-debug.log"), debug, "utf8");
  return { manifest, failure, hint: cls.reason };
}

type Subcommand = "validate" | "launch" | "detect" | "report" | "compare" | "stop" | "detect-project" | "scaffold" | "verify-api";

async function runSubcommand(sub: Subcommand, flags: Record<string, string>): Promise<number> {
  switch (sub) {
    case "validate": return validateCommand(flags);
    case "launch":   return launchCommand(flags);
    case "detect":   return detectCommand(flags);
    case "report":   return reportCommand(flags);
    case "compare":  return compareCommand(flags);
    case "stop":     return stopCommand(flags);
    case "detect-project": return detectProjectCommand(flags);
    case "scaffold":       return scaffoldCommand(flags);
    case "verify-api":     return verifyApiCommand(flags);
  }
}

async function main(): Promise<void> {
  const sub = process.argv[2] as Subcommand | undefined;
  const flags = parseFlags(process.argv.slice(3));
  if (!sub || !["validate", "launch", "detect", "report", "compare", "stop", "detect-project", "scaffold", "verify-api"].includes(sub)) {
    process.stderr.write(`unknown subcommand: ${sub}\nusage: user-simulator <validate|launch|detect|report|compare|stop|detect-project|scaffold|verify-api> [--flags]\n`);
    process.exit(2);
  }
  // Pre-flight for any subcommand that may touch Playwright. detect-project,
  // scaffold, and verify-api are file-only / fetch-only and don't need it.
  // Validate is read-only; stop is intent-only.
  if (sub !== "validate" && sub !== "stop" && sub !== "detect-project" && sub !== "scaffold" && sub !== "verify-api") {
    const probe = flags["artifact-root"] ?? `.user-simulator/runs/latest`;
    const startedAt = new Date().toISOString();
    const platform = (flags.platform as "web" | "electron" | undefined) ?? "web";
    try {
      await import("@playwright/test");
    } catch (err) {
      const { failure, hint } = await recordInfraFailure({
        artifactRoot: probe,
        platform,
        target: flags.target ?? "(no target)",
        error: err,
        startedAt,
      });
      process.stdout.write(`${JSON.stringify({ verdict: "INFRA_FAILURE", kind: failure.kind, hint, artifact_root: probe })}\n`);
      process.stderr.write(`\n⚠️  user-simulator cannot start (INFRA_FAILURE: ${failure.kind})\n` +
        `   ${hint}\n` +
        `   First-time setup: cd plugins/user-simulator/skills/user-simulator/scripts && npm install && npx playwright install chromium\n` +
        `   Full debug: ${probe}/infra-debug.log\n`);
      process.exit(3);
    }
  }
  try {
    process.exit(await runSubcommand(sub, flags));
  } catch (err) {
    // Subcommand threw after pre-flight passed. This is almost always a
    // mid-run infra failure (port conflict mid-launch, electron crash on
    // startup, etc.) — record it the same way the launch path does.
    if (sub === "launch") {
      // launchCommand already has its own try/catch; this is a defensive
      // backstop in case something escapes.
      process.stderr.write(`unexpected error in launch: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(3);
    }
    process.stderr.write(`user-simulator ${sub} error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  }
}