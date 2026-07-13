import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

const HERE = resolve(import.meta.dirname, "..");
const SCHEMAS = {
  persona: resolve(HERE, "../schemas/persona.schema.json"),
  story: resolve(HERE, "../schemas/story.schema.json"),
  bug: resolve(HERE, "../schemas/bug.schema.json"),
};

function ajv() {
  const a = new Ajv2020.default({ allErrors: true, strict: false });
  addFormats.default(a);
  return a;
}

describe("schemas", () => {
  it("persona example validates", async () => {
    const schema = JSON.parse(await readFile(SCHEMAS.persona, "utf8")) as object;
    const data = parseYaml(await readFile(resolve(HERE, "../examples/personas/first-time-user.yaml"), "utf8"));
    const v = ajv().compile(schema);
    expect(v(data)).toBe(true);
  });

  it("persona rejects unknown fields (additionalProperties: false)", async () => {
    const schema = JSON.parse(await readFile(SCHEMAS.persona, "utf8")) as object;
    const data = { ...parseYaml(await readFile(resolve(HERE, "../examples/personas/first-time-user.yaml"), "utf8")) as Record<string, unknown>, evil: "x" };
    const v = ajv().compile(schema);
    expect(v(data)).toBe(false);
  });

  it("task story example validates and is mode=task", async () => {
    const schema = JSON.parse(await readFile(SCHEMAS.story, "utf8")) as object;
    const data = parseYaml(await readFile(resolve(HERE, "../examples/stories/task-mode.yaml"), "utf8")) as { mode: string; steps: unknown[] };
    const v = ajv().compile(schema);
    expect(v(data)).toBe(true);
    expect(data.mode).toBe("task");
    expect(data.steps.length).toBeGreaterThan(0);
  });

  it("explore story example validates and is mode=explore", async () => {
    const schema = JSON.parse(await readFile(SCHEMAS.story, "utf8")) as object;
    const data = parseYaml(await readFile(resolve(HERE, "../examples/stories/free-exploration.yaml"), "utf8")) as { mode: string; goals: unknown[]; coverage_targets: unknown[] };
    const v = ajv().compile(schema);
    expect(v(data)).toBe(true);
    expect(data.mode).toBe("explore");
    expect(data.goals.length).toBeGreaterThan(0);
    expect(data.coverage_targets.length).toBeGreaterThan(0);
  });

  it("task story rejects explore-only fields", async () => {
    const schema = JSON.parse(await readFile(SCHEMAS.story, "utf8")) as object;
    const base = parseYaml(await readFile(resolve(HERE, "../examples/stories/task-mode.yaml"), "utf8")) as Record<string, unknown>;
    const data = { ...base, goals: [{ id: "g", intent: "x", priority: 3 }], coverage_targets: [{ area: "x", minimum_interactions: 1 }], novelty_threshold: 0.2 };
    const v = ajv().compile(schema);
    expect(v(data)).toBe(false);
  });

  it("explore story rejects steps", async () => {
    const schema = JSON.parse(await readFile(SCHEMAS.story, "utf8")) as object;
    const base = parseYaml(await readFile(resolve(HERE, "../examples/stories/free-exploration.yaml"), "utf8")) as Record<string, unknown>;
    const data = { ...base, steps: [] };
    const v = ajv().compile(schema);
    expect(v(data)).toBe(false);
  });

  it("bug schema rejects unstable fingerprint (hash of title)", async () => {
    const schema = JSON.parse(await readFile(SCHEMAS.bug, "utf8")) as object;
    const data = {
      bug_id: "bug-12345678",
      fingerprint: createHash("sha256").update("just a title").digest("hex").slice(0, 32),
      type: "functional",
      severity: "S1",
      confidence: "high",
      title: "x",
      first_seen_run: "20260101-000000-abcd",
    };
    const v = ajv().compile(schema);
    expect(v(data)).toBe(true);
  });
});

describe("SKILL mirror consistency", () => {
  it("plugins/.../SKILL.md and skills/.../SKILL.md are byte-identical", async () => {
    const canonical = await readFile(resolve(HERE, "../SKILL.md"), "utf8");
    const mirror = await readFile(resolve(HERE, "../../../../../skills/user-simulator/SKILL.md"), "utf8");
    expect(canonical).toBe(mirror);
  });
});