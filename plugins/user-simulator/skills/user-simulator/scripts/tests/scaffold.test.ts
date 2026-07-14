import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldProject } from "../scaffold/scaffold.js";
import type { ProjectProfile } from "../project-adapter/types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "us-scaffold-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    schema_version: "4.0",
    stack: { framework: "vite-react", is_monorepo: false },
    dev: { command: "vite", port: 5173, readyTimeoutMs: 60000, env: {} },
    routes: { type: "none", entries: [] },
    api: { surface: "none" },
    state: [{ library: "none", stores: [] }],
    ui: { componentLib: "none" },
    smoke: { url: "http://localhost:5173" },
    ...overrides,
  };
}

describe("scaffoldProject", () => {
  it("writes 5 files for a non-Electron project", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", version: "0.0.0" }));
    const result = await scaffoldProject(root, makeProfile());
    expect(result.electronDeferredTo).toBeNull();
    expect(result.filesWritten).toContain("playwright.config.ts");
    expect(result.filesWritten).toContain("e2e/smoke.spec.ts");
    expect(result.filesWritten).toContain("e2e/README.md");
    expect(result.packageJsonPatched).toBe(true);
    expect(result.gitignorePatched).toBe(true);
    expect(existsSync(join(root, "playwright.config.ts"))).toBe(true);
    expect(existsSync(join(root, "e2e/smoke.spec.ts"))).toBe(true);
    expect(existsSync(join(root, "e2e/README.md"))).toBe(true);
  });

  it("refuses to overwrite an existing playwright.config.ts without --force", async () => {
    writeFileSync(join(root, "playwright.config.ts"), "// user content");
    const result = await scaffoldProject(root, makeProfile());
    expect(result.refused).toContain("playwright.config.ts");
    expect(result.filesWritten).not.toContain("playwright.config.ts");
    expect(readFileSync(join(root, "playwright.config.ts"), "utf8")).toBe("// user content");
  });

  it("overwrites with force=true", async () => {
    writeFileSync(join(root, "playwright.config.ts"), "// user content");
    const result = await scaffoldProject(root, makeProfile(), { force: true });
    expect(result.refused).toEqual([]);
    expect(result.filesWritten).toContain("playwright.config.ts");
  });

  it("defers to electron-e2e-scaffold for Electron projects", async () => {
    const result = await scaffoldProject(
      root,
      makeProfile({ stack: { framework: "electron-vite", is_monorepo: false } }),
    );
    expect(result.filesWritten).toEqual([]);
    expect(result.electronDeferredTo).toContain("electron-e2e-scaffold");
  });

  it("inlines the detected dev port into playwright.config.ts", async () => {
    const result = await scaffoldProject(
      root,
      makeProfile({ dev: { command: "next dev", port: 4000, readyTimeoutMs: 60000, env: {} } }),
    );
    const config = readFileSync(join(root, "playwright.config.ts"), "utf8");
    expect(config).toContain("http://localhost:4000");
  });

  it("adds playwright-report/, test-results/, playwright/.cache/ to .gitignore", async () => {
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    const result = await scaffoldProject(root, makeProfile());
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gi).toContain("playwright-report/");
    expect(gi).toContain("test-results/");
    expect(gi).toContain("playwright/.cache/");
    expect(gi).toContain("node_modules/");
  });

  it("creates .gitignore if missing", async () => {
    const result = await scaffoldProject(root, makeProfile());
    expect(existsSync(join(root, ".gitignore"))).toBe(true);
    expect(result.gitignorePatched).toBe(true);
  });

  it("adds test:e2e script and @playwright/test devDep to package.json", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: "0.0.0", scripts: { build: "tsc" } }));
    await scaffoldProject(root, makeProfile());
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["test:e2e"]).toBe("playwright test");
    expect(pkg.scripts["build"]).toBe("tsc"); // preserved
    expect(pkg.devDependencies["@playwright/test"]).toMatch(/\^1\./);
  });
});