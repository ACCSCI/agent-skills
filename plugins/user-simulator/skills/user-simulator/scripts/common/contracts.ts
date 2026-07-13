/**
 * Shared TypeScript contracts for user-simulator.
 *
 * These are the in-memory shapes that flow through the CLI between phases.
 * They mirror (but do not duplicate) the JSON Schemas under ./schemas/.
 * Validation against the JSON Schemas is done at trust boundaries
 * (loading YAML from disk, emitting reports to disk).
 */

export type Severity = "S0" | "S1" | "S2" | "S3";
export type Confidence = "high" | "medium" | "low";
export type BugType = "functional" | "visual" | "ux" | "performance";
export type Platform = "web" | "electron";
export type Mode = "task" | "explore";
export type CheckpointPolicy = "each_step" | "key_nodes" | "failures_only";
export type DetectorKind =
  | "assertion_failure"
  | "console_error"
  | "page_error"
  | "request_failure"
  | "crash"
  | "vision_visual"
  | "vision_ux"
  | "performance_threshold"
  | "novelty_loop"
  | "exit_unexpected";

export type InfraFailureKind =
  | "playwright_not_installed"
  | "browser_missing"
  | "port_conflict"
  | "electron_launch_failed"
  | "target_unreachable"
  | "timeout_no_evidence"
  | "harness_exception";

export interface Persona {
  schema_version: "1.0";
  kind: "persona";
  id: string;
  name: string;
  role: string;
  experience_level: "first_time" | "beginner" | "intermediate" | "expert";
  attention_to_detail: 1 | 2 | 3 | 4 | 5;
  patience: 1 | 2 | 3 | 4 | 5;
  language: string;
  domain_knowledge?: string[];
  accessibility_needs?: ("keyboard-only" | "low-vision" | "screen-reader" | "color-blind" | "motor-impaired")[];
  behavior_notes?: string;
}

export interface StorySafety {
  allow_destructive_actions?: boolean;
  allow_external_navigation?: boolean;
  allowed_origins?: string[];
  redact_text_patterns?: string[];
}

export interface StoryMonitoring {
  checkpoint_policy?: CheckpointPolicy;
  capture_dom_summary?: boolean;
  capture_network_failures?: boolean;
  capture_performance?: boolean;
  screenshot_mode?: "viewport" | "full_page";
}

export type AssertionKind =
  | "visible"
  | "hidden"
  | "text"
  | "url"
  | "state"
  | "no_console_error"
  | "no_page_error"
  | "performance"
  | "visual";

export type AssertionOperator =
  | "exists"
  | "not_exists"
  | "equals"
  | "contains"
  | "matches"
  | "lte"
  | "gte"
  | "changed";

export type Locator = "role" | "label" | "text" | "test_id" | "css";

export interface Assertion {
  id: string;
  kind: AssertionKind;
  target?: string;
  locator?: Locator;
  operator: AssertionOperator;
  expected?: string | number | boolean;
  timeout_ms?: number;
  severity_on_fail: Severity;
  evidence?: ("screenshot" | "snapshot" | "log")[];
}

export interface TaskStep {
  id: string;
  instruction: string;
  key_node?: boolean;
  max_actions?: number;
  assertions?: Assertion[];
  on_failure?: "continue" | "stop";
}

export interface TaskStory {
  schema_version: "1.0";
  kind: "story";
  id: string;
  name: string;
  mode: "task";
  persona_ref?: string;
  preconditions?: string[];
  start_path?: string;
  seed?: number;
  safety?: StorySafety;
  monitoring?: StoryMonitoring;
  task: string;
  steps: TaskStep[];
  success_criteria?: Assertion[];
  max_total_actions?: number;
}

export interface ExploreGoal {
  id: string;
  intent: string;
  priority: 1 | 2 | 3 | 4 | 5;
  success_signal?: string;
}

export interface CoverageTarget {
  area: string;
  minimum_interactions: number;
  success_signal?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
}

export interface ExploreStory {
  schema_version: "1.0";
  kind: "story";
  id: string;
  name: string;
  mode: "explore";
  persona_ref?: string;
  preconditions?: string[];
  start_path?: string;
  seed?: number;
  safety?: StorySafety;
  monitoring?: StoryMonitoring;
  goals: ExploreGoal[];
  coverage_targets: CoverageTarget[];
  max_steps: number;
  novelty_threshold: number;
  stagnation_limit?: number;
  excluded_areas?: string[];
  stop_when_goals_met?: boolean;
}

export type Story = TaskStory | ExploreStory;

export interface TargetSpec {
  /** Raw value from --target. */
  raw: string;
  /** Resolved by target-launcher. */
  platform: Platform;
  /** For web: full URL. For electron: executable path OR entry script path. */
  resolved: string;
  /** dev command (if user provided one) */
  dev_command?: string;
  /** ready URL to wait for (web only) */
  ready_url?: string;
}

export interface TargetSession {
  run_id: string;
  platform: Platform;
  pid: number;
  started_at: string;
  artifact_root: string;
  ready_url?: string;
  /** Electron userDataDir (only present when platform === "electron"). */
  user_data_dir?: string;
  /** Window/BrowserContext metadata captured at launch. */
  handle: Record<string, unknown>;
}

export type ActionVerb =
  | "observe"
  | "click"
  | "fill"
  | "type"
  | "press"
  | "select"
  | "hover"
  | "wait"
  | "checkpoint"
  | "assert"
  | "finish";

export interface ActionRequest {
  verb: ActionVerb;
  /** Semantic locator hints (preferred) or escape-hatch CSS. */
  target?: string;
  locator?: Locator;
  value?: string;
  timeout_ms?: number;
  /** Optional assertion override attached to this action. */
  assertion?: Assertion;
  /** Free-form metadata from the calling agent (free-text rationale, etc.). */
  rationale?: string;
}

export interface ActionResult {
  action_id: string;
  verb: ActionVerb;
  started_at: string;
  duration_ms: number;
  status: "ok" | "timeout" | "failed" | "blocked";
  /** State fingerprint before the action. */
  before_fingerprint: string;
  /** State fingerprint after the action (may equal before if no state change). */
  after_fingerprint: string;
  /** DOM/AX summary captured at end of action. */
  snapshot_path?: string;
  /** Screenshot path if checkpoint_policy captured one. */
  screenshot_path?: string;
  /** Console/pageerror/request failure deltas during the action. */
  signal_deltas?: SignalDeltas;
  error?: string;
}

export interface SignalDeltas {
  console_errors: ConsoleEntry[];
  page_errors: PageErrorEntry[];
  request_failures: RequestFailureEntry[];
}

export interface ConsoleEntry {
  type: "error" | "warning";
  text: string;
  location?: { url: string; line?: number; column?: number };
  at: string;
}

export interface PageErrorEntry {
  message: string;
  stack?: string;
  at: string;
}

export interface RequestFailureEntry {
  url: string;
  method: string;
  failure: string;
  at: string;
}

export interface StateSnapshot {
  fingerprint: string;
  captured_at: string;
  route?: string;
  window?: string;
  title?: string;
  url?: string;
  headings: string[];
  landmarks: { role: string; label?: string }[];
  dialogs: { role: string; label?: string }[];
  visible_controls: number;
  active_element?: string;
  focus_visible: boolean;
  page_errors: number;
  console_errors: number;
}

export interface MetricsSample {
  captured_at: string;
  navigation_timing?: {
    dom_content_loaded_ms?: number;
    load_ms?: number;
    first_contentful_paint_ms?: number;
  };
  lcp_ms?: number;
  cls?: number;
  long_tasks_ms?: number;
  action_latency_ms?: number;
}

export interface VisionObservation {
  screenshot_path: string;
  captured_at: string;
  findings: VisionFinding[];
  model?: string;
  prompt_version: string;
}

export interface VisionFinding {
  type: "visual" | "ux";
  severity: Severity;
  confidence: number;
  title: string;
  location?: string;
  visible_evidence: string;
  user_impact: string;
  suggested_verification?: string;
}

export interface Bug {
  bug_id: string;
  fingerprint: string;
  type: BugType;
  severity: Severity;
  confidence: Confidence;
  title: string;
  location?: { route?: string; window?: string; element?: string };
  expected?: string;
  actual?: string;
  reproduction_steps?: string[];
  evidence?: { screenshots?: string[]; snapshots?: string[]; logs?: string[] };
  detectors?: DetectorKind[];
  first_seen_run: string;
  candidate?: boolean;
}

export interface InfraFailure {
  kind: InfraFailureKind;
  message: string;
  evidence?: Record<string, unknown>;
  at: string;
}

export interface RunManifest {
  run_id: string;
  round: 1 | 2;
  baseline_run_id?: string;
  platform: Platform;
  target: TargetSpec;
  persona: Persona;
  story_id: string;
  story_kind: Mode;
  seed?: number;
  viewport: { width: number; height: number };
  locale: string;
  timezone: string;
  started_at: string;
  finished_at?: string;
  git_head?: string;
  dirty_diff_hash?: string;
  node_version: string;
  playwright_version: string;
  verdict?: "VERIFIED_FIXED" | "PARTIALLY_FIXED" | "NOT_FIXED" | "REGRESSION" | "INCONCLUSIVE" | "PASSED" | "INFRA_FAILURE";
  infra_failure?: InfraFailure;
}

export interface RoundDiff {
  baseline_run_id: string;
  baseline_git_head?: string;
  baseline_dirty_diff_hash?: string;
  current_git_head?: string;
  current_dirty_diff_hash?: string;
  targeted: BugDiffEntry[];
  regression: BugDiffEntry[];
  new_bugs: Bug[];
  persistent: Bug[];
  inconclusive: Bug[];
  verdict: "VERIFIED_FIXED" | "PARTIALLY_FIXED" | "NOT_FIXED" | "REGRESSION" | "INCONCLUSIVE";
  reason: string;
}

export interface BugDiffEntry {
  baseline_bug_id: string;
  current_bug_id?: string;
  baseline_fingerprint: string;
  current_fingerprint?: string;
  status: "fixed" | "persistent" | "regressed" | "inconclusive";
  notes?: string;
}