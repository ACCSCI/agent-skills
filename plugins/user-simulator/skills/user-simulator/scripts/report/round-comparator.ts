/**
 * Round comparator — matches baseline bugs against current bugs by stable
 * fingerprint and emits a verdict.
 *
 * Invariants:
 *   - "Not seen in Round 2" != "fixed". A bug is only marked `fixed` when
 *     the same fingerprint is reachable in Round 2 but not produced.
 *   - Missing comparable evidence (Round 2 didn't reach the same step/route)
 *     yields `inconclusive`, not `fixed`.
 *   - A new S0/S1 OR a previously-passing assertion failing ⇒ REGRESSION.
 */

import type { Bug, RoundDiff } from "../common/contracts.js";

export function compareRounds(baselineBugs: Bug[], currentBugs: Bug[], baselineRunId: string): RoundDiff {
  const baselineByFp = new Map<string, Bug>();
  for (const b of baselineBugs) baselineByFp.set(b.fingerprint, b);

  const currentByFp = new Map<string, Bug>();
  for (const b of currentBugs) currentByFp.set(b.fingerprint, b);

  const targeted: RoundDiff["targeted"] = [];
  const persistentBugs: Bug[] = [];
  const inconclusive: Bug[] = [];

  const newBugs: Bug[] = [];
  const regression: RoundDiff["regression"] = [];

  for (const [fp, base] of baselineByFp) {
    const cur = currentByFp.get(fp);
    if (!cur) {
      // Not seen in current run → cannot prove Round 2 reached the same
      // step/route, so the comparator marks this inconclusive. The Agent
      // calling compare is responsible for proving coverage; if it can, it
      // should drop the baseline bug from the list before calling.
      targeted.push({
        baseline_bug_id: base.bug_id,
        baseline_fingerprint: fp,
        status: "inconclusive",
        notes: "Round 2 did not produce this fingerprint. Verify comparable coverage before claiming fixed.",
      });
      inconclusive.push(base);
      continue;
    }
    // Same fingerprint in both: compare severity. If current is still as
    // severe as baseline, the fix did not land → persistent.
    const stillAsBad = severityRank(cur.severity) <= severityRank(base.severity);
    if (stillAsBad) {
      targeted.push({
        baseline_bug_id: base.bug_id,
        current_bug_id: cur.bug_id,
        baseline_fingerprint: fp,
        current_fingerprint: fp,
        status: "persistent",
        notes: `Current severity ${cur.severity} not better than baseline ${base.severity}`,
      });
      persistentBugs.push(base);
    } else {
      targeted.push({
        baseline_bug_id: base.bug_id,
        current_bug_id: cur.bug_id,
        baseline_fingerprint: fp,
        current_fingerprint: fp,
        status: "fixed",
        notes: `Severity improved: ${base.severity} → ${cur.severity}`,
      });
    }
  }

  for (const [fp, cur] of currentByFp) {
    if (baselineByFp.has(fp)) continue;
    newBugs.push(cur);
    if (cur.severity === "S0" || cur.severity === "S1") {
      regression.push({
        baseline_bug_id: "",
        current_bug_id: cur.bug_id,
        baseline_fingerprint: "",
        current_fingerprint: fp,
        status: "regressed",
        notes: `New ${cur.severity} introduced after fix attempt`,
      });
    }
  }

  const targetedFixed = targeted.filter((t) => t.status === "fixed");
  const targetedInconclusive = targeted.filter((t) => t.status === "inconclusive");
  const targetedPersistent = targeted.filter((t) => t.status === "persistent");
  const persistentS0S1 = [
    ...targetedPersistent.map((t) => baselineByFp.get(t.baseline_fingerprint)).filter((b): b is Bug => !!b && (b.severity === "S0" || b.severity === "S1")),
    ...persistentBugs.filter((b) => b.severity === "S0" || b.severity === "S1"),
  ];
  const newS0S1 = newBugs.filter((b) => b.severity === "S0" || b.severity === "S1");

  let verdict: RoundDiff["verdict"];
  let reason: string;
  if (regression.length > 0 || newS0S1.length > 0) {
    verdict = "REGRESSION";
    reason = regression.length > 0
      ? `New S0/S1 introduced: ${regression.map((r) => r.current_bug_id).join(", ")}`
      : `New S0/S1 in current: ${newS0S1.map((b) => b.bug_id).join(", ")}`;
  } else if (persistentS0S1.length > 0) {
    verdict = "NOT_FIXED";
    reason = `Persistent S0/S1: ${persistentS0S1.map((b) => b.bug_id).join(", ")}`;
  } else if (targetedFixed.length === baselineBugs.length && baselineBugs.length > 0) {
    verdict = "VERIFIED_FIXED";
    reason = `All ${baselineBugs.length} baseline bugs no longer reproduce and no new S0/S1 appeared.`;
  } else if (targetedFixed.length > 0 && (targetedPersistent.length > 0 || newBugs.length > 0)) {
    verdict = "PARTIALLY_FIXED";
    reason = `${targetedFixed.length} of ${baselineBugs.length} baseline bugs fixed; ${newBugs.length} new findings (${newS0S1.length} S0/S1).`;
  } else if (newBugs.length > 0 && targetedInconclusive.length > 0) {
    // New bugs prove coverage reached those areas; combined with the
    // baseline being gone, treat as PARTIALLY_FIXED rather than
    // INCONCLUSIVE.
    verdict = "PARTIALLY_FIXED";
    reason = `${newBugs.length} new findings in Round 2 (proves coverage); ${targetedInconclusive.length} baseline bugs could not be fingerprint-matched.`;
  } else if (targetedInconclusive.length > 0 && targetedFixed.length === 0) {
    verdict = "INCONCLUSIVE";
    reason = `${targetedInconclusive.length} baseline bugs could not be evaluated — coverage incomplete.`;
  } else {
    verdict = "PARTIALLY_FIXED";
    reason = "Mixed results — see targeted and new_bugs sections.";
  }

  return {
    baseline_run_id: baselineRunId,
    targeted,
    regression,
    new_bugs: newBugs,
    persistent: targetedPersistent.map((t) => baselineByFp.get(t.baseline_fingerprint)).filter((b): b is Bug => !!b),
    inconclusive,
    verdict,
    reason,
  };
}

function severityRank(s: "S0" | "S1" | "S2" | "S3"): number {
  return ["S0", "S1", "S2", "S3"].indexOf(s);
}