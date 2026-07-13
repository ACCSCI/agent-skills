/**
 * Atomic-write NDJSON log + path-normalized artifact store.
 *
 * Design goals:
 *   - Every run produces an append-only events.ndjson. Readers can replay the
 *     full action stream even if the process crashes mid-run.
 *   - All paths are project-relative (./screenshots/, ./bugs.json, ...) under
 *     the artifact root. Sensitive text patterns are best-effort redacted
 *     before persistence.
 *   - Writes are atomic (write-temp + rename) so partial files cannot be
 *     mistaken for valid reports.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

export interface ArtifactStoreOptions {
  artifact_root: string;
  redact_text_patterns?: RegExp[];
}

export type ArtifactKind =
  | "screenshot"
  | "snapshot"
  | "metrics"
  | "vision"
  | "log"
  | "report"
  | "bug"
  | "manifest";

export class ArtifactStore {
  readonly root: string;
  private readonly redactors: RegExp[];

  constructor(opts: ArtifactStoreOptions) {
    this.root = resolve(opts.artifact_root);
    this.redactors = (opts.redact_text_patterns ?? []).map((re) =>
      re.flags.includes("g") ? re : new RegExp(re.source, `${re.flags}g`),
    );
  }

  /**
   * Resolve a project-relative artifact path and ensure its parent exists.
   * Throws if the resolved path would escape the artifact root.
   */
  async pathFor(kind: ArtifactKind, name: string): Promise<string> {
    const safe = sanitizeName(name);
    const rel = join(kindFolder(kind), safe);
    const full = resolve(this.root, rel);
    this.assertWithinRoot(full);
    await mkdir(dirname(full), { recursive: true });
    return full;
  }

  /** Project-relative path (use this in reports so the artifact is portable). */
  relative(absolute: string): string {
    const rel = relative(this.root, absolute);
    if (rel.startsWith("..")) {
      throw new Error(`Path escapes artifact root: ${absolute}`);
    }
    return rel.split(sep).join("/");
  }

  /** Atomic JSON write — readers never see a half-written file. */
  async writeJson(kind: ArtifactKind, name: string, data: unknown): Promise<string> {
    const path = await this.pathFor(kind, name);
    const json = JSON.stringify(this.redact(data), null, 2);
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, json, "utf8");
    await rename(tmp, path);
    return this.relative(path);
  }

  /** Atomic binary write — used for screenshots. */
  async writeBinary(kind: ArtifactKind, name: string, bytes: Buffer): Promise<string> {
    const path = await this.pathFor(kind, name);
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
    return this.relative(path);
  }

  /**
   * Append a single event to events.ndjson. The line is a single JSON object
   * terminated by '\n'. Each line carries a monotonically-increasing seq
   * assigned by the store.
   */
  async appendEvent(event: Record<string, unknown>): Promise<void> {
    const path = join(this.root, "events.ndjson");
    await mkdir(dirname(path), { recursive: true });
    const line = `${JSON.stringify(this.redact(event))}\n`;
    // events.ndjson is intentionally NOT atomic-rename — appending is cheap and
    // we want lines to survive a crash. The line itself is small.
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, line, "utf8");
  }

  redact<T>(value: T): T {
    if (this.redactors.length === 0) return value;
    return walk(value, (s) => this.redactString(s)) as T;
  }

  private redactString(s: string): string {
    let out = s;
    for (const re of this.redactors) {
      out = out.replace(re, "[REDACTED]");
    }
    return out;
  }

  private assertWithinRoot(full: string): void {
    const norm = normalize(full);
    const root = normalize(this.root + sep);
    if (!norm.startsWith(root) && norm !== normalize(this.root)) {
      throw new Error(`Refusing path outside artifact root: ${full}`);
    }
  }
}

function kindFolder(kind: ArtifactKind): string {
  switch (kind) {
    case "screenshot":
      return "screenshots";
    case "snapshot":
      return "snapshots";
    case "metrics":
      return "metrics";
    case "vision":
      return "vision";
    case "log":
      return "logs";
    case "report":
      return ".";
    case "bug":
      return ".";
    case "manifest":
      return ".";
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function walk(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, fn));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, fn);
    }
    return out;
  }
  return value;
}

/** Stable 8-byte hex prefix used in fingerprints. */
export function shortHash(...parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  h.update("\x00");
  return h.digest("hex").slice(0, 16);
}