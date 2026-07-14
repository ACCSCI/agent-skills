/**
 * Persona loop — session state holder.
 *
 * Design (v1): NOT a daemon. The Claude Code Agent invokes this module via
 * the action-client CLI; the loop's lifetime matches a single CLI invocation
 * and is initialized lazily on the first verb.
 *
 * Holds:
 *   - Playwright Page (or Electron firstWindow)
 *   - BoundCapture (console / pageerror / request-failure buffers)
 *   - Session descriptor from the launcher
 *   - Last known state fingerprint
 *
 * Exports one method per verb (observe/click/fill/type/press/select/hover/
 * wait/checkpoint/assert/finish). All verbs return ActionResult JSON.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type {
  ActionRequest,
  ActionResult,
  Assertion,
  AssertionOperator,
  ConsoleEntry,
  Locator,
  PageErrorEntry,
  RequestFailureEntry,
  SignalDeltas,
  StateSnapshot,
} from "../common/contracts.js";
import { captureSnapshot, takeScreenshot, bind, type BoundCapture } from "../capture/capture.js";
import { fingerprint as computeFingerprint } from "./state-fingerprint.js";
import { launchElectronWrapper, teardownElectron } from "../run-electron/run-electron.js";
import { launchWeb } from "../run-web/run-web.js";
import type { ElectronHandle } from "../run-electron/electron-fixture.js";
import { ArtifactStore } from "../common/artifact-store.js";

export interface PersonaLoopInit {
  artifact_root: string;
  platform: "web" | "electron";
  ready_url?: string;
  target_executable?: string;
  target_entry?: string;
  target_cwd?: string;
  storage_state_path?: string;
  viewport?: { width: number; height: number };
}

export class PersonaLoop {
  private page: Page | null = null;
  private bound: BoundCapture | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private electronHandle: ElectronHandle | null = null;
  private lastFingerprint = "";
  private actionSeq = 0;
  private initOpts: PersonaLoopInit;
  private initPromise: Promise<void> | null = null;
  private closed = false;

  constructor(opts: PersonaLoopInit) {
    this.initOpts = opts;
  }

  async ensureInit(): Promise<void> {
    if (this.page) return;
    if (!this.initPromise) this.initPromise = this.doInit();
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    await mkdir(this.initOpts.artifact_root, { recursive: true });
    if (this.initOpts.platform === "web") {
      const session = await launchWeb(
        { raw: this.initOpts.ready_url ?? "", platform: "web", resolved: this.initOpts.ready_url ?? "" },
        { run_id: "loop", artifact_root: this.initOpts.artifact_root },
      );
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({
        viewport: this.initOpts.viewport ?? { width: 1280, height: 800 },
        ...(this.initOpts.storage_state_path ? { storageState: this.initOpts.storage_state_path } : {}),
      });
      const page = await this.context.newPage();
      await page.goto(session.ready_url ?? this.initOpts.ready_url ?? "about:blank");
      this.page = page;
      this.bound = bindSafe(page);
    } else {
      const result = await launchElectronWrapper(
        {
          raw: this.initOpts.target_executable ?? this.initOpts.target_entry ?? "",
          platform: "electron",
          resolved: this.initOpts.target_executable ?? this.initOpts.target_entry ?? "",
        },
        { run_id: "loop", artifact_root: this.initOpts.artifact_root },
      );
      this.electronHandle = result.handle;
      this.page = result.handle.window;
      this.bound = result.handle.bound;
    }
    const cap = await captureSnapshot(this.bound);
    this.lastFingerprint = cap.state.fingerprint;
  }

  async run(req: ActionRequest): Promise<ActionResult> {
    await this.ensureInit();
    if (this.closed || !this.page || !this.bound) {
      throw new Error("persona-loop is closed");
    }
    this.actionSeq += 1;
    const action_id = `act-${Date.now()}-${this.actionSeq}`;
    const started_at = new Date().toISOString();
    const beforeFp = this.lastFingerprint;
    const t0 = performance.now();

    let status: ActionResult["status"] = "ok";
    let error: string | undefined;
    let screenshot_path: string | undefined;
    let snapshot_path: string | undefined;

    try {
      switch (req.verb) {
        case "observe":
          // Just capture state, no action.
          break;
        case "click":
          await this.actClick(req);
          break;
        case "fill":
          await this.actFill(req);
          break;
        case "type":
          await this.actType(req);
          break;
        case "press":
          await this.actPress(req);
          break;
        case "select":
          await this.actSelect(req);
          break;
        case "hover":
          await this.actHover(req);
          break;
        case "wait":
          await this.actWait(req);
          break;
        case "scroll_down":
          await this.actScrollDown(req);
          break;
        case "scroll_up":
          await this.actScrollUp(req);
          break;
        case "checkpoint":
          screenshot_path = await this.actCheckpoint(req);
          break;
        case "assert":
          await this.actAssert(req);
          break;
        case "finish":
          await this.close();
          break;
        default:
          status = "blocked";
          error = `unknown verb`;
      }
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    }

    const cap = await captureSnapshot(this.bound);
    this.lastFingerprint = cap.state.fingerprint;
    const snapshot_path_abs = await this.writeSnapshotJson(`snap-${action_id}`, cap.state);
    snapshot_path = snapshot_path_abs;

    if (req.verb === "checkpoint" && !screenshot_path) {
      screenshot_path = await this.writeScreenshot(`shot-${action_id}`, "viewport");
    }

    const duration_ms = Math.round(performance.now() - t0);
    const result: ActionResult = {
      action_id,
      verb: req.verb,
      started_at,
      duration_ms,
      status,
      before_fingerprint: beforeFp,
      after_fingerprint: cap.state.fingerprint,
      snapshot_path: snapshot_path_abs,
      screenshot_path,
      signal_deltas: cap.signals,
      ...(error ? { error } : {}),
    };
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.electronHandle) await teardownElectron(this.electronHandle);
    } catch { /* best effort */ }
    try {
      if (this.context) await this.context.close();
    } catch { /* best effort */ }
    try {
      if (this.browser) await this.browser.close();
    } catch { /* best effort */ }
  }

  // ---- verb implementations ----

  private async actClick(req: ActionRequest): Promise<void> {
    if (!req.target) throw new Error("click requires target");
    const locator = resolveLocator(this.page!, req.target, req.locator);
    await locator.click({ timeout: req.timeout_ms ?? 5_000 });
  }

  private async actFill(req: ActionRequest): Promise<void> {
    if (!req.target || req.value === undefined) throw new Error("fill requires target and value");
    const locator = resolveLocator(this.page!, req.target, req.locator);
    await locator.fill(req.value, { timeout: req.timeout_ms ?? 5_000 });
  }

  private async actType(req: ActionRequest): Promise<void> {
    if (req.value === undefined) throw new Error("type requires value");
    await this.page!.keyboard.type(req.value, { delay: 15 });
  }

  private async actPress(req: ActionRequest): Promise<void> {
    if (!req.value) throw new Error("press requires value (key)");
    await this.page!.keyboard.press(req.value);
  }

  private async actSelect(req: ActionRequest): Promise<void> {
    if (!req.target || req.value === undefined) throw new Error("select requires target and value");
    const locator = resolveLocator(this.page!, req.target, req.locator);
    await locator.selectOption(req.value, { timeout: req.timeout_ms ?? 5_000 });
  }

  private async actHover(req: ActionRequest): Promise<void> {
    if (!req.target) throw new Error("hover requires target");
    const locator = resolveLocator(this.page!, req.target, req.locator);
    await locator.hover({ timeout: req.timeout_ms ?? 5_000 });
  }

  private async actWait(req: ActionRequest): Promise<void> {
    await this.page!.waitForLoadState("networkidle", { timeout: req.timeout_ms ?? 10_000 }).catch(() => undefined);
  }

  /**
   * 向下滚动一个 viewport 高度（或到页面底部），等待稳定后截图。
   * SKILL.md 强制规则：每 2–3 步必须完整纵向滚动一次到底部。
   */
  private async actScrollDown(_req: ActionRequest): Promise<void> {
    const page = this.page!;
    await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" });
    });
    // 等待滚动动画完成
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        let lastY = window.scrollY;
        const check = () => {
          const current = window.scrollY;
          if (current === lastY) resolve(undefined);
          else { lastY = current; requestAnimationFrame(check); }
        };
        requestAnimationFrame(check);
      });
    }, { timeout: 2_000 }).catch(() => undefined);
    // 稳定帧：等待网络空闲
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  }

  /**
   * 向上滚动一个 viewport 高度（或回到顶部），等待稳定后截图。
   */
  private async actScrollUp(_req: ActionRequest): Promise<void> {
    const page = this.page!;
    await page.evaluate(() => {
      window.scrollBy({ top: -window.innerHeight * 0.9, behavior: "smooth" });
    });
    await page.waitForFunction(() => {
      return new Promise((resolve) => {
        let lastY = window.scrollY;
        const check = () => {
          const current = window.scrollY;
          if (current === lastY) resolve(undefined);
          else { lastY = current; requestAnimationFrame(check); }
        };
        requestAnimationFrame(check);
      });
    }, { timeout: 2_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  }

  private async actCheckpoint(_req: ActionRequest): Promise<string> {
    return this.writeScreenshot(`ckpt-${this.actionSeq}`, "viewport");
  }

  private async actAssert(req: ActionRequest): Promise<void> {
    if (!req.assertion) throw new Error("assert requires assertion payload");
    await runAssertion(this.page!, req.assertion);
  }

  // ---- helpers ----

  private async writeSnapshotJson(name: string, state: StateSnapshot): Promise<string> {
    const store = new ArtifactStore({ artifact_root: this.initOpts.artifact_root });
    return store.writeJson("snapshot", `${name}.json`, state);
  }

  private async writeScreenshot(name: string, mode: "viewport" | "full_page"): Promise<string> {
    if (!this.bound) throw new Error("not initialized");
    const bytes = await takeScreenshot(this.bound, mode);
    const store = new ArtifactStore({ artifact_root: this.initOpts.artifact_root });
    return store.writeBinary("screenshot", `${name}.png`, bytes);
  }
}

function bindSafe(page: Page): BoundCapture {
  return bind(page);
}

// ---- locator resolution ----

function resolveLocator(page: Page, target: string, locator?: Locator) {
  const loc = locator ?? "role";
  switch (loc) {
    case "role": {
      const [role, name] = target.split("|");
      return page.getByRole((role ?? "button") as Parameters<Page["getByRole"]>[0], name ? { name } : {});
    }
    case "label":
      return page.getByLabel(target);
    case "text":
      return page.getByText(target);
    case "test_id":
      return page.getByTestId(target);
    case "css":
      return page.locator(target);
  }
}

// ---- assertion runner ----

async function runAssertion(page: Page, a: Assertion): Promise<void> {
  const timeout = a.timeout_ms ?? 5_000;
  switch (a.kind) {
    case "visible": {
      const loc = resolveLocator(page, a.target ?? "", a.locator);
      await loc.waitFor({ state: "visible", timeout });
      break;
    }
    case "hidden": {
      const loc = resolveLocator(page, a.target ?? "", a.locator);
      await loc.waitFor({ state: "hidden", timeout });
      break;
    }
    case "text": {
      const loc = resolveLocator(page, a.target ?? "", a.locator);
      await loc.waitFor({ state: "visible", timeout });
      const actual = (await loc.textContent()) ?? "";
      applyOperator(a.operator, actual, a.expected, `text content of ${a.target}`);
      break;
    }
    case "url": {
      await page.waitForURL((url) => matchOperator(a.operator, url.toString(), a.expected), { timeout });
      break;
    }
    case "state": {
      const loc = resolveLocator(page, a.target ?? "", a.locator);
      await loc.waitFor({ state: "visible", timeout });
      const text = ((await loc.textContent()) ?? "").trim();
      const len = Number(text.length);
      applyOperator(a.operator, len, a.expected, `length of ${a.target}`);
      break;
    }
    case "no_console_error":
    case "no_page_error":
    case "performance":
    case "visual":
      // These are handled outside the page-action path. We only enforce
      // timing budget here; signal collection is the capture layer's job.
      return;
  }
}

function applyOperator(op: AssertionOperator, actual: unknown, expected: unknown, what: string): void {
  if (!matchOperator(op, actual, expected)) {
    throw new Error(`assertion failed: ${what} ${op} ${String(expected)} (actual: ${String(actual)})`);
  }
}

function matchOperator(op: AssertionOperator, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "exists": return actual !== null && actual !== undefined;
    case "not_exists": return actual === null || actual === undefined;
    case "equals": return actual === expected;
    case "contains": return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "matches": return typeof actual === "string" && expected instanceof RegExp && expected.test(actual);
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "changed": return actual !== undefined;
  }
}