import { describe, expect, it } from "vitest";
import { compareRounds } from "../report/round-comparator.js";
import type { Bug } from "../common/contracts.js";

function bug(overrides: Partial<Bug>): Bug {
  return {
    bug_id: "bug-deadbeef",
    fingerprint: "fp",
    type: "functional",
    severity: "S2",
    confidence: "high",
    title: "title",
    first_seen_run: "20260101-000000-abcd",
    ...overrides,
  };
}

describe("round-comparator", () => {
  it("missing baseline bug is inconclusive (verdict needs coverage proof)", () => {
    // By design, when a baseline bug is not seen in current run, the
    // comparator cannot prove Round 2 reached the same step/route, so it
    // marks the targeted entry inconclusive. The Agent calling compare is
    // responsible for surfacing coverage; if it can prove coverage it
    // should drop the baseline bug from the list before calling.
    const base = [bug({ fingerprint: "a" })];
    const cur: Bug[] = [];
    const d = compareRounds(base, cur, "baseline");
    expect(d.targeted[0]?.status).toBe("inconclusive");
    expect(d.verdict).toBe("INCONCLUSIVE");
  });

  it("persistent S0 → NOT_FIXED", () => {
    const fp = "fpx";
    const base = [bug({ fingerprint: fp, severity: "S0" })];
    const cur = [bug({ fingerprint: fp, severity: "S0" })];
    const d = compareRounds(base, cur, "baseline");
    expect(d.verdict).toBe("NOT_FIXED");
  });

  it("new S0 introduced → REGRESSION", () => {
    const d = compareRounds([], [bug({ fingerprint: "new", severity: "S0" })], "baseline");
    expect(d.verdict).toBe("REGRESSION");
  });

  it("partial fix + new S2 → PARTIALLY_FIXED", () => {
    const base = [bug({ fingerprint: "a", severity: "S1" })];
    const cur = [bug({ fingerprint: "new", severity: "S2" })];
    const d = compareRounds(base, cur, "baseline");
    expect(d.verdict).toBe("PARTIALLY_FIXED");
  });

  it("fingerprint equality is exact (no fuzzy title match)", () => {
    const base = [bug({ fingerprint: "fp1", title: "old title" })];
    const cur = [bug({ fingerprint: "fp2", title: "old title" })];
    const d = compareRounds(base, cur, "baseline");
    // Same title but different fingerprint → current is "new", baseline is "inconclusive"
    expect(d.targeted).toHaveLength(1);
    expect(d.targeted[0]?.status).toBe("inconclusive");
    expect(d.new_bugs).toHaveLength(1);
  });
});