import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../project-adapter/detect.js";
import { loadProfile, saveProfile } from "../project-adapter/profile.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "us-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePkg(pkg: Record<string, unknown>) {
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
}

describe("detectProject", () => {
  it("returns unknown framework for an empty directory", async () => {
    const profile = await detectProject(root);
    expect(profile.stack.framework).toBe("unknown");
    expect(profile.api.surface).toBe("none");
    expect(profile.state[0]?.library).toBe("none");
  });

  it("detects Next.js App Router", async () => {
    writePkg({ dependencies: { next: "^15.0.0" } });
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(join(root, "app", "layout.tsx"), "export default function() {}");
    writeFileSync(join(root, "app", "page.tsx"), "export default function() {}");
    const profile = await detectProject(root);
    expect(profile.stack.framework).toBe("next-app-router");
    expect(profile.routes.type).toBe("app-router");
  });

  it("detects Next.js Pages Router", async () => {
    writePkg({ dependencies: { next: "^15.0.0" } });
    mkdirSync(join(root, "pages"), { recursive: true });
    writeFileSync(join(root, "pages", "index.tsx"), "export default function() {}");
    const profile = await detectProject(root);
    expect(profile.stack.framework).toBe("next-pages");
  });

  it("detects Vite + React (no Electron)", async () => {
    writePkg({
      devDependencies: { vite: "^5.0.0", react: "^18.0.0" },
      scripts: { dev: "vite --port 5173" },
    });
    const profile = await detectProject(root);
    expect(profile.stack.framework).toBe("vite-react");
    expect(profile.dev.port).toBe(5173);
  });

  it("detects electron-vite", async () => {
    writePkg({
      devDependencies: { electron: "^30", "electron-vite": "^2" },
      scripts: { dev: "electron-vite dev" },
    });
    writeFileSync(join(root, "electron.vite.config.ts"), "export default {};");
    mkdirSync(join(root, "electron"), { recursive: true });
    writeFileSync(join(root, "electron", "main.ts"), "console.log('main')");
    const profile = await detectProject(root);
    expect(profile.stack.framework).toBe("electron-vite");
    expect(profile.routes.type).toBe("electron-main");
    expect(profile.routes.main_entry).toBe("electron/main.ts");
  });

  it("detects vite-plugin-electron flavor", async () => {
    writePkg({
      devDependencies: { electron: "^30", "vite-plugin-electron": "^0.28" },
    });
    const profile = await detectProject(root);
    expect(profile.stack.framework).toBe("electron-vite-plugin");
  });

  it("detects OpenAPI surface via /openapi.json convention", async () => {
    writePkg({ dependencies: { next: "^15" } });
    mkdirSync(join(root, "app/api"), { recursive: true });
    writeFileSync(join(root, "openapi.json"), JSON.stringify({ openapi: "3.0.0", paths: {} }));
    const profile = await detectProject(root);
    expect(profile.api.surface).toBe("openapi");
    expect(profile.api.specUrl).toBe("/openapi.json");
  });

  it("detects GraphQL via schema.graphql file", async () => {
    writePkg({});
    writeFileSync(join(root, "schema.graphql"), "type Query { hello: String }");
    const profile = await detectProject(root);
    expect(profile.api.surface).toBe("graphql");
    expect(profile.api.endpoint).toBe("/graphql");
  });

  it("detects tRPC-via-openapi when @trpc/openapi is in deps", async () => {
    writePkg({ dependencies: { "@trpc/openapi": "^1" } });
    const profile = await detectProject(root);
    expect(profile.api.surface).toBe("trpc-openapi");
  });

  it("detects Next.js API routes", async () => {
    writePkg({ dependencies: { next: "^15" } });
    mkdirSync(join(root, "app/api/posts"), { recursive: true });
    writeFileSync(join(root, "app/api/posts/route.ts"), "export async function GET() {}");
    const profile = await detectProject(root);
    expect(profile.api.surface).toBe("rest");
    expect(profile.api.endpoint).toBe("/api");
  });

  it("detects shadcn via components.json", async () => {
    writePkg({});
    writeFileSync(join(root, "components.json"), JSON.stringify({ style: "new-york" }));
    const profile = await detectProject(root);
    expect(profile.ui.componentLib).toBe("shadcn");
  });

  it("detects zustand state", async () => {
    writePkg({ dependencies: { zustand: "^4" } });
    const profile = await detectProject(root);
    expect(profile.state.map((s) => s.library)).toContain("zustand");
  });
});

describe("profile cache", () => {
  it("save and load round-trip", async () => {
    writePkg({ dependencies: { next: "^15" } });
    const profile = await detectProject(root);
    const cachePath = join(root, "profile.json");
    await saveProfile(profile, cachePath);
    const loaded = await loadProfile(cachePath);
    expect(loaded?.stack.framework).toBe(profile.stack.framework);
  });

  it("load returns null for missing file", async () => {
    const loaded = await loadProfile(join(root, "does-not-exist.json"));
    expect(loaded).toBeNull();
  });
});