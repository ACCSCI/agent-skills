/**
 * Profile cache — read/write ProjectProfile JSON to `<artifact_root>/profile.json`
 * or to a user-supplied path. Validates against the JSON Schema.
 *
 * Three modes:
 *   - load(path) → ProjectProfile | null (silently returns null on missing)
 *   - save(profile, path) → writes atomically + validates
 *   - saveToArtifactRoot(profile, artifact_root) → convenience for the
 *     user-simulator artifact convention (.user-simulator/profile.json)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ProjectProfile } from "./types.js";
import { ArtifactStore } from "../common/artifact-store.js";

let ajvInstance: Ajv2020.default | undefined;
async function getAjv(): Promise<Ajv2020.default> {
  if (ajvInstance) return ajvInstance;
  const AjvCtor = (Ajv2020 as unknown as { default: new (opts: object) => Ajv2020.default }).default;
  ajvInstance = new AjvCtor({ allErrors: true, strict: false });
  return ajvInstance;
}

let schemaCache: object | undefined;
async function loadSchema(): Promise<object> {
  if (schemaCache) return schemaCache;
  const { readFile: rf } = await import("node:fs/promises");
  const path = resolve(import.meta.dirname, "../../schemas/project-profile.schema.json");
  schemaCache = JSON.parse(await rf(path, "utf8")) as object;
  return schemaCache;
}

export async function loadProfile(path: string): Promise<ProjectProfile | null> {
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as ProjectProfile;
    return data;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: ProjectProfile, path: string): Promise<void> {
  const ajv = await getAjv();
  const schema = await loadSchema();
  const validate = ajv.compile(schema);
  if (!validate(profile)) {
    throw new Error(`ProjectProfile failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`);
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(profile, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
}

/** Default cache path: `<artifact_root>/profile.json` */
export function defaultProfilePath(artifactRoot: string): string {
  return join(artifactRoot, "profile.json");
}

/** Convenience: save into an ArtifactStore-managed dir. */
export async function saveProfileToStore(
  profile: ProjectProfile,
  artifactRoot: string,
): Promise<string> {
  const path = defaultProfilePath(artifactRoot);
  await saveProfile(profile, path);
  return path;
}

/** Re-export ArtifactStore for callers that want to colocate other artifacts. */
export { ArtifactStore };