/**
 * ProjectProfile — in-memory shape produced by project-adapter.
 *
 * Mirrors `schemas/project-profile.schema.json`. Validation against the
 * JSON Schema is done at trust boundaries (loading cached profile, emitting
 * fresh profile). Internal use is typed.
 */

export type Framework =
  | "next-app-router"
  | "next-pages"
  | "nuxt"
  | "sveltekit"
  | "vite-react"
  | "electron-vite"
  | "electron-vite-plugin"
  | "electron-esbuild"
  | "cloudflare-workers"
  | "remix"
  | "angular"
  | "flask"
  | "tauri"
  | "unknown";

export type RouteType = "app-router" | "pages" | "src-routes" | "electron-main" | "config-based" | "none";

export type ApiSurface = "openapi" | "graphql" | "trpc-openapi" | "rest" | "none";

export type IpcStyle = "typed" | "generic-bridge" | "hono-daemon" | "none";

export type StateLibrary =
  | "zustand"
  | "redux"
  | "pinia"
  | "vuex"
  | "mobx"
  | "jotai"
  | "valtio"
  | "tanstack-query"
  | "none";

export type ComponentLib =
  | "shadcn"
  | "heroui"
  | "mui"
  | "chakra"
  | "antd"
  | "mantine"
  | "base-ui"
  | "tailwind-only"
  | "none";

export type E2EFramework = "playwright" | "vitest" | "cypress" | "jest" | "none";

export type MonorepoTool = "pnpm" | "turborepo" | "lerna" | "nx";

export interface StackInfo {
  framework: Framework;
  version?: string;
  is_monorepo: boolean;
  monorepo_tool?: MonorepoTool;
  workspace_members?: string[];
}

export interface DevInfo {
  command: string;
  port: number;
  readyTimeoutMs: number;
  env: Record<string, string>;
}

export interface RoutesInfo {
  type: RouteType;
  entries: string[];
  main_entry?: string;
}

export interface ApiRoute {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";
  path: string;
  handler: string;
}

export interface ApiInfo {
  surface: ApiSurface;
  specUrl?: string;
  endpoint?: string;
  routeTable?: ApiRoute[];
  ipc_style?: IpcStyle;
}

export interface StateInfo {
  library: StateLibrary;
  stores: string[];
}

export interface UiInfo {
  componentLib: ComponentLib;
  theme?: string;
}

export interface SmokeInfo {
  url: string;
  selector?: string;
}

export interface ExistingE2E {
  framework: E2EFramework;
  configPath?: string;
  testDir?: string;
}

export interface ProjectProfile {
  schema_version: "4.0";
  stack: StackInfo;
  dev: DevInfo;
  routes: RoutesInfo;
  api: ApiInfo;
  state: StateInfo[];
  ui: UiInfo;
  smoke: SmokeInfo;
  existing_e2e?: ExistingE2E;
}

/** Probe result: a partial profile contribution. Probes never overwrite each other;
 *  detect.ts merges with last-write-wins on each key. */
export type ProbeContribution = Partial<ProjectProfile>;
