/**
 * Product-level bug detector.
 *
 * Inputs: raw signals from capture.ts (assertion failures, console errors,
 * page errors, request failures, crashes, vision observations, perf samples,
 * novelty loops).
 *
 * Outputs: deduplicated, severity-ranked Bug list with stable fingerprints
 * suitable for Round 1 → Round 2 matching.
 *
 * Invariants:
 *   - Vision-only findings default to `candidate: true` and confidence "low".
 *   - Same fingerprint never produces two confirmed bugs in one run.
 *   - Infra failures NEVER enter this list — those are handled upstream by
 *     failure-classifier.ts and abort the run as INCONCLUSIVE.
 *   - Fingerprint is built from detector+step+route+element+normalized message,
 *     NOT from title text or screenshot bytes.
 */
import { createHash } from "node:crypto";
import { shortHash } from "../common/artifact-store.js";
export function detectFromSignals(inputs) {
    const confirmed = new Map();
    const candidates = [];
    for (const input of inputs) {
        const fp = computeFingerprint(input);
        const bug = {
            bug_id: makeBugId(input.run_id, fp),
            fingerprint: fp,
            type: input.type,
            severity: input.severity,
            confidence: input.confidence,
            title: input.title,
            location: {
                ...(input.route !== undefined ? { route: input.route } : {}),
                ...(input.window !== undefined ? { window: input.window } : {}),
                ...(input.element !== undefined ? { element: input.element } : {}),
            },
            expected: input.expected,
            actual: input.actual,
            reproduction_steps: input.reproduction_steps,
            evidence: input.evidence,
            detectors: input.detectors,
            first_seen_run: input.run_id,
        };
        // Vision-only candidate path
        if (input.detectors.every((d) => d === "vision_visual" || d === "vision_ux") && input.confidence !== "high") {
            bug.candidate = true;
            candidates.push(bug);
            continue;
        }
        const existing = confirmed.get(fp);
        if (existing) {
            // Merge evidence (preserve highest confidence, accumulate paths)
            mergeBug(existing, bug);
        }
        else {
            confirmed.set(fp, bug);
        }
    }
    return { bugs: [...confirmed.values()], candidates };
}
/**
 * Promote vision findings to DetectorInputs. Pure function — no I/O.
 * Severities outside S0-S3 are clamped. Confidence is bounded to 0-1.
 */
export function visionFindingsToInputs(run_id, vision, step_id, route, window) {
    return vision.findings.flatMap((f) => {
        const sev = clampSeverity(f.severity);
        const conf = clampConfidence(f.confidence);
        const detector = f.type === "visual" ? "vision_visual" : "vision_ux";
        return [{
                run_id,
                step_id,
                route,
                window,
                message: `${f.title} :: ${f.visible_evidence}`,
                detectors: [detector],
                severity: sev,
                confidence: conf >= 0.7 ? "high" : conf >= 0.4 ? "medium" : "low",
                type: f.type === "visual" ? "visual" : "ux",
                title: f.title.slice(0, 200),
                element: f.location,
                expected: undefined,
                actual: f.user_impact,
                reproduction_steps: f.suggested_verification ? [f.suggested_verification] : undefined,
                evidence: { screenshots: [vision.screenshot_path] },
            }];
    });
}
/** Normalize a console / pageerror / request failure into a DetectorInput. */
export function signalToInput(args) {
    const { source, entry, step_id, route, window, evidence_paths, run_id } = args;
    const detectors = source === "console" ? ["console_error"] :
        source === "pageerror" ? ["page_error"] :
            source === "request" ? ["request_failure"] :
                source === "crash" ? ["crash"] :
                    ["exit_unexpected"];
    const text = "message" in entry ? entry.message :
        "text" in entry ? entry.text :
            "failure" in entry ? `${entry.method} ${entry.url}: ${entry.failure}` :
                JSON.stringify(entry);
    return {
        run_id,
        step_id,
        route,
        window,
        message: normalizeMessage(text),
        detectors,
        severity: severityFor(source),
        confidence: "high",
        type: source === "request" ? "performance" : "functional",
        title: titleFor(source, text),
        evidence: evidence_paths ? { logs: evidence_paths } : undefined,
        actual: text.slice(0, 500),
    };
}
/** Build DetectorInput from a failed assertion. */
export function assertionToInput(args) {
    return {
        run_id: args.run_id,
        step_id: args.step_id,
        route: args.route,
        window: args.window,
        message: normalizeMessage(`assertion ${args.assertion.id} (${args.assertion.operator}) on ${args.assertion.target ?? args.assertion.kind}`),
        detectors: ["assertion_failure"],
        severity: args.assertion.severity_on_fail,
        confidence: "high",
        type: args.assertion.kind === "performance" ? "performance"
            : args.assertion.kind === "visual" ? "visual"
                : "functional",
        title: `断言失败：${args.assertion.id}`,
        expected: args.assertion.expected !== undefined ? String(args.assertion.expected) : undefined,
        actual: args.observed_actual,
        evidence: args.evidence_paths,
    };
}
// ---- internals ----
function computeFingerprint(input) {
    const detectorKey = [...input.detectors].sort().join("+");
    const messageKey = normalizeMessage(input.message);
    return shortHash(detectorKey, input.step_id ?? "", input.route ?? "", input.window ?? "", input.element ?? "", messageKey);
}
function normalizeMessage(s) {
    return s.toLowerCase().replace(/\s+/g, " ").replace(/0x[0-9a-f]+/g, "0xADDR").slice(0, 500);
}
function severityFor(source) {
    switch (source) {
        case "crash":
        case "exit":
            return "S0";
        case "pageerror":
            return "S1";
        case "console":
            return "S2";
        case "request":
            return "S3";
    }
}
function titleFor(source, text) {
    const head = text.split("\n")[0] ?? text;
    switch (source) {
        case "console": return `Console error: ${head.slice(0, 80)}`;
        case "pageerror": return `Uncaught: ${head.slice(0, 80)}`;
        case "request": return `Request failed: ${head.slice(0, 80)}`;
        case "crash": return `Process crashed: ${head.slice(0, 80)}`;
        case "exit": return `Unexpected exit: ${head.slice(0, 80)}`;
    }
}
function clampSeverity(s) {
    return ["S0", "S1", "S2", "S3"].includes(s) ? s : "S3";
}
function clampConfidence(c) {
    if (!Number.isFinite(c))
        return 0;
    if (c < 0)
        return 0;
    if (c > 1)
        return 1;
    return c;
}
function makeBugId(run_id, fingerprint) {
    const h = createHash("sha256");
    h.update(run_id);
    h.update("\x00");
    h.update(fingerprint);
    return `bug-${h.digest("hex").slice(0, 12)}`;
}
function mergeBug(existing, incoming) {
    if (severityRank(incoming.severity) < severityRank(existing.severity)) {
        existing.severity = incoming.severity;
    }
    if (confidenceRank(incoming.confidence) < confidenceRank(existing.confidence)) {
        existing.confidence = incoming.confidence;
    }
    const det = new Set([...(existing.detectors ?? []), ...(incoming.detectors ?? [])]);
    existing.detectors = [...det];
    existing.evidence = mergeEvidence(existing.evidence, incoming.evidence);
}
function severityRank(s) {
    return ["S0", "S1", "S2", "S3"].indexOf(s);
}
function confidenceRank(c) {
    return ["high", "medium", "low"].indexOf(c);
}
function mergeEvidence(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    return {
        screenshots: dedupePush(a.screenshots, b.screenshots),
        snapshots: dedupePush(a.snapshots, b.snapshots),
        logs: dedupePush(a.logs, b.logs),
    };
}
function dedupePush(a, b) {
    if (!a && !b)
        return undefined;
    const set = new Set([...(a ?? []), ...(b ?? [])]);
    return [...set];
}
//# sourceMappingURL=bug-detector.js.map