---
name: user-simulator
description: "AI 驱动的产品级 QA：生成具有人设的模拟用户，在 Electron 与 Web 应用中执行给定任务或自由探索，记录关键节点日志/截图，发现功能、视觉、UX 与性能问题，并在修复后进行 Round 2 对比验证。Use this when the user asks to 模拟用户、用户测试、探索式测试、找 UI bug、评估 UX、验证修复，or asks to have AI agents operate an Electron or web app like real users, run task-based or exploratory product QA, capture evidence, or compare before/after fixes."
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Agent, Skill, mcp__MiniMax__understand_image
argument-hint: --target <url|path> --platform <auto|web|electron> --mode <task|explore> [--persona <yaml>] [--story <yaml>] [--task "<text>"] [--max-steps <n>] [--round <1|2>] [--baseline <run-id>] [--fix <none|suggest|apply>]
---

# User Simulator

AI 驱动的产品级 QA。生成具有人设（Persona）的模拟用户子代理，让它们像真实用户一样操作 Electron / Web 应用、记录关键节点日志与截图、发现功能 / 视觉 / UX / 性能问题，并在修复后进行 Round 2 对比验证。

> **定位**：本 skill 是**产品级 QA**——AI 决策循环、Persona 与 Story、产品级 bug 分类、闭环修复验证。它**不**生成 E2E 脚手架（Playwright fixture、pipeline runner、infra-level 失败分类）；那类工作由你使用的其他 skill 或手动脚手架负责。

---

## 定位与边界

### v1 支持矩阵

| 平台 | v1 状态 | 说明 |
|---|---|---|
| Web | ✅ 支持 | URL 或本地 dev server |
| Electron | ✅ 支持 | entry / 可执行文件 / 已有 scaffold |
| Native desktop | ❌ Roadmap | WinAppDriver / XCUITest 等需另立 skill |
| Mobile | ❌ Roadmap | Appium 路径不混入 |

### 默认安全边界

- ❌ 默认禁止破坏性操作（删除数据、清空工作区、卸载）
- ❌ 默认禁止外部导航（点链接跳到外站）
- ❌ 默认禁止生产环境；显式 `--env=production` 才允许
- ✅ Story 的 `safety` 字段可单独放宽，但每次都会要求确认

---

## 参数说明

### 必需参数

| 参数 | 含义 |
|---|---|
| `--target <url\|path>` | URL（web）或 entry/executable 路径（electron） |
| `--platform <auto\|web\|electron>` | 默认 auto；按 target 形态自动判定 |
| `--mode <task\|explore>` | task 模式按 Story 跑断言；explore 模式自主探索 |

### 可选参数

| 参数 | 默认 | 含义 |
|---|---|---|
| `--persona <yaml>` | — | Persona 文件路径；与 Story 内 `persona_ref` 二选一 |
| `--story <yaml>` | — | Story 文件路径（task 或 explore） |
| `--task "<text>"` | — | 简短 task 描述；缺省时从 Story 读 |
| `--max-steps <n>` | story.max_steps 或 20 | 自由探索的动作上限 |
| `--round <1\|2>` | 1 | 1 = 首次发现；2 = 修复后对比 |
| `--baseline <run-id>` | — | Round 2 必需；Round 1 的 run id |
| `--fix <none\|suggest\|apply>` | none | 修复模式：none 仅报告；suggest 给建议；apply 自动改（需显式确认） |
| `--dev-command <cmd>` | — | web 启动 dev server 的命令 |
| `--ready-url <url>` | — | dev server 就绪后访问的 URL |
| `--artifact-root <dir>` | `.user-simulator/runs/<run-id>` | 产物根目录 |
| `--viewport <WxH>` | 1280x800 | Playwright 视口 |

### 参数优先级与冲突

- `--persona` 与 Story 中 `persona_ref` 同时存在时，必须解析到同一文件，否则失败
- `--round=2` 必须配合 `--baseline`
- `--fix=apply` 必须配合显式用户确认（SKILL 会在执行前 ask）

---

## 模式

### Task Mode：给定任务

按 Story 中的 `task` + `steps[]` 顺序执行；每个 step 内可有多个断言；step 失败时按 `on_failure`（默认 `stop`）决定是否继续。

适合：替代手工 E2E、回归已知任务、固定业务路径回归。

### Free Exploration Mode：自由探索

AI 代理按 `goals` 和 `coverage_targets` 自主决定下一步动作；以 `novelty_threshold` 衡量"是否到了新状态"；连续 `stagnation_limit` 次低 novelty 后停止。

适合：发现未知问题、生成候选 bug 列表、覆盖产品功能边界。

### 如何选择模式

- **有明确步骤** → Task Mode
- **想覆盖未知区域** → Free Exploration
- **两者都要** → 先 Task Mode 完成关键路径，再 Free Exploration 探索边缘

---

## 前置检查

在 launch 之前，SKILL 必须确认：

1. **目标可达**：URL HEAD 200，或 electron entry 文件存在
2. **Playwright 已安装**：`scripts/node_modules/@playwright/test` 存在
3. **Chromium 可用**：`%LOCALAPPDATA%\ms-playwright\` 下有 chromium-*
4. **认证/数据**：Story `preconditions` 中描述的初始状态满足
5. **生产环境警告**：URL 含 prod / production 字样时强制 ask 确认

任何一项失败 → INFRA_FAILURE，运行 verdict = INCONCLUSIVE，绝不进入产品 bug 列表。

---

## Persona 与 Story 文件格式

### Persona Schema 摘要

完整定义见 `schemas/persona.schema.json`。必需字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| `schema_version` | string | 固定 `"1.0"` |
| `id` | kebab-case | 2–64 字符 |
| `experience_level` | enum | first_time / beginner / intermediate / expert |
| `attention_to_detail` | 1-5 | 1=只关注主任务；5=注意微小不一致 |
| `patience` | 1-5 | 1=易放弃；5=愿意等待和尝试替代路径 |
| `language` | BCP-47 | 例如 `zh-CN`、`en-US` |
| `accessibility_needs` | array | 仅作模拟约束；非真实 a11y 测试 |

`additionalProperties: false` —— 未知字段报错而非静默忽略。

### Task Story Schema 摘要

完整定义见 `schemas/story.schema.json`。task mode 必填：

- `task` (string) — 用户希望完成的最终任务
- `steps[]` (array) — 有序语义步骤，不使用录制式坐标
- `success_criteria[]` (可选) — 全局断言
- `max_total_actions` (可选，默认 60) — 防止代理失控

每个 `step` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `instruction` | string | 用户意图，例如"创建一个名为 Chapter 2 的章节" |
| `key_node` | bool | 默认 true；是否强制前后截图 |
| `max_actions` | int | 该步骤允许的最多底层动作 |
| `assertions[]` | array | step 结束后的断言 |
| `on_failure` | continue \| stop | 默认 stop |

每个 `assertion` 字段：

| 字段 | 说明 |
|---|---|
| `kind` | visible / hidden / text / url / state / no_console_error / no_page_error / performance / visual |
| `locator` | role / label / text / test_id / css（**前四种优先**，css 仅作逃生口） |
| `operator` | exists / not_exists / equals / contains / matches / lte / gte / changed |
| `severity_on_fail` | S0 / S1 / S2 / S3 |
| `timeout_ms` | 默认 5000，最大 30000 |

### Free Exploration Story Schema 摘要

explore mode 必填：

- `goals[]` — 至少 1 项；含 `id / intent / priority / success_signal`
- `coverage_targets[]` — 至少 1 项；含 `area / minimum_interactions`
- `max_steps` (1-100) — AI 决策循环上限
- `novelty_threshold` (0.0-1.0) — 新状态与历史状态的最低差异
- `stagnation_limit` (默认 3) — 连续低 novelty 后停止
- `excluded_areas[]` (可选) — 禁区

### 校验与冲突规则

- `mode=task` 出现 `goals` / `coverage_targets` / `novelty_threshold` → 失败
- `mode=explore` 出现 `steps` → 失败
- 任何不识别的 assertion kind / operator / severity → 失败
- Round 2 必须复用 Round 1 冻结后的 Persona + Story 副本，不允许重新读取可能已被修改的原始 YAML
- Schema 版本未知时停止，不做宽松降级

---

## 工作流程

### 阶段 1：解析与预检

1. 解析 CLI flags
2. 加载并校验 Persona + Story（用 `ajv`）
3. 解析 target + 判定 platform
4. 解析 `safety` 与 `monitoring` 字段
5. 准备 artifact root（`<project>/.user-simulator/runs/<run-id>/`）

### 阶段 2：启动与隔离

1. Web：`launchWeb` —— 必要时启动 dev_command，等待 ready_url
2. Electron：`launchElectronWrapper` —— 使用隔离的 userDataDir
3. 写 `manifest.json`（platform / target / persona / story / seed / Git HEAD / dirty diff hash）
4. **不**在这一阶段打开 Playwright BrowserContext（避免与 action-client 生命周期耦合）

### 阶段 3：生成模拟用户代理

通过 `Agent` 工具生成 1 个或多个 Persona 子代理。每个子代理被告知：

- 自己的 Persona（性格、经验、语言）
- Story 模式 + 任务 / 探索目标
- 必须通过 `action-client` CLI 调用 `observe / click / fill / type / press / select / hover / wait / checkpoint / assert / finish`
- 每次决策前先 `observe` 拿到当前状态，决策后调用语义动作
- **不允许**任意 `page.evaluate` / 任意 shell / 未批准的外部导航

### 阶段 4：执行、观察与关键节点记录

每个动作：

1. `ensureInit()` — 启动或复用 Playwright session
2. 记录 `before_fingerprint`
3. 执行动作
4. `captureSnapshot` —— 截图 + DOM 摘要 + 控制台 / pageerror / 失败请求 + 性能采样
5. 写 `events.ndjson`（append-only）
6. 必要时（key_node / failures_only / each_step）写 `snapshots/<id>.json` + `screenshots/<id>.png`
7. 返回 `ActionResult` JSON 给子代理

### 阶段 5：检测、分类与去重

1. 调用 `detect` 子命令，传入 signals.ndjson + vision.json
2. `classifyInfra` 先过滤（端口冲突、Playwright 缺失、Electron 启动失败、超时无证据）→ INFRA_FAILURE
3. `detectFromSignals` 合并断言失败、控制台 / pageerror / 失败请求、视觉观察、性能超标、novelty 循环
4. 按 fingerprint 去重，merge 证据
5. 视觉 only 的发现 confidence < 0.7 → `candidate: true`，不进入 confirmed bug 列表
6. 写 `bugs.json`（schema 校验后）

### 阶段 6：报告、清理与退出

1. `report` 子命令渲染 `report.md`（severity table + confirmed + candidates + 限制声明）
2. Round 2：`compare` 子命令调 `compareRounds` 写 `comparison.json` + `verification-report.md`
3. `action-client finish` 关闭 BrowserContext、Electron app、清理 userDataDir

---

## 目标启动

### Web

- `--target https://example.com` 直接使用
- `--target ./my-app --dev-command "pnpm dev" --ready-url http://localhost:5173` 启动 dev server
- ready 检查用裸 `fetch`，避免先开 Playwright

### Electron

- `--target D:/path/to/built.exe` 使用可执行文件
- `--target D:/path/to/main.ts` 使用 entry 脚本
- 隔离的 userDataDir 自动放在 artifact root 下 `userdata/`
- 监听 `app.process().exit` 与 `crash`，crash → INFRA_FAILURE

### 多窗口与弹窗

v1 不并发多窗口——选择 `firstWindow()`。多窗口场景在 Round 2 修复后再考虑。

---

## Agent 编排

### Persona 隔离

每个 Persona 子代理独占自己的 `action-client` 进程。**v1 串行执行**（不支持并发 Persona），避免 BrowserContext / Electron app 共享的复杂性。

### 动作循环

```
1. observe   ← 拿当前 fingerprint + snapshot + signals
2. decide    ← AI 推理：下一步做什么
3. act       ← click / fill / type / press / select / hover / wait / assert
4. checkpoint（仅 key_node / failures_only / each_step）
5. repeat
```

### 停止条件

- Task Mode：所有 step 通过 → finish；step on_failure=stop 且失败 → finish with verdict
- Free Exploration：
  - 所有 goals met（`stop_when_goals_met=true`）
  - `max_steps` 用尽
  - 连续 `stagnation_limit` 次 novelty < `novelty_threshold`
  - 进入 excluded_areas → 立即 finish with INCONCLUSIVE
  - 用户主动中断（`finish`）

---

## 监控机制

### 关键节点定义

- Task Mode：每个 step 的开始与结束（key_node=true 时强制）
- Free Exploration：state fingerprint novelty > 0.5 的 transition；每次 coverage_target 触发时

### 日志与运行错误

- `events.ndjson` — append-only 事件流（每个动作、检查点、信号 delta）
- `dev-server.log` — web dev_command 的 stdout/stderr（若使用）
- `main.log` — Electron main process 的 stdout/stderr（若使用）

### 截图与页面摘要

- `screenshots/<checkpoint-id>.png` — 关键节点截图
- `snapshots/<checkpoint-id>.json` — DOM/AX/URL/window/focus 摘要

### 性能采样

- `metrics/<checkpoint-id>.json` — navigation_timing / FCP / long_tasks / lcp_ms / cls
- 单次采样不等于"性能回归"——需要 ≥3 样本或显式 Story budget 才定 performance bug

### Artifact 目录

```
<artifact_root>/
├── manifest.json
├── events.ndjson
├── session.json                  # target-launcher 写的 session descriptor
├── bugs.json                     # Round 1 / 2 通用
├── report.md
├── comparison.json               # Round 2 only
├── verification-report.md        # Round 2 only
├── screenshots/
├── snapshots/
├── metrics/
├── vision/                       # 由视觉工具规范化后
├── dev-server.log                # web dev command 输出
├── main.log                      # electron main 输出
└── userdata/                     # electron 隔离 user-data-dir
```

---

## Bug 检测分类与严重度

### S0–S3 严重度定义

| 级别 | 定义 | 示例 |
|---|---|---|
| S0 | 阻断、崩溃、数据破坏或核心数据不可恢复 | 应用退出、保存后内容丢失、错误操作覆盖用户数据 |
| S1 | 核心用户任务无法完成，且无合理 workaround | 无法登录、无法创建文档、提交按钮无效 |
| S2 | 重要但局部的问题，有 workaround 或影响次要流程 | inspector 不更新、明显的操作反馈缺失 |
| S3 | 轻微视觉、文案、对齐或低影响摩擦 | 文本截断但不影响理解、轻微错位 |

严重度由**用户影响**决定，而不是由 detector 类型决定。视觉 bug 也可能是 S1（例如关键按钮被完全遮挡）。

### Bug 类型与检测机制

| 类型 | 主要检测机制 | 证据要求 |
|---|---|---|
| Functional | Story assertions、pageerror、console.error、失败请求、崩溃/断连 | 至少 1 个确定性信号；最好有复现步骤与前后截图 |
| Visual | 截图视觉分析、overflow / 截断启发式 | 截图必需；模型观察必须带 confidence |
| UX | Persona 受阻、反复回退、无反馈、命名不清、焦点丢失 | 动作日志 + 关键节点截图；纯主观项标 candidate |
| Performance | action latency、navigation timing、LCP/CLS、long tasks | ≥3 样本或显式 Story budget |

### Confidence 与证据门槛

- `high`：确定性断言失败且至少复现两次，或明确 crash/pageerror 与动作直接相关
- `medium`：视觉/UX 证据清晰，但主要依赖模型判断
- `low`：可能问题、单次异常或缺少完整状态上下文

报告分成 **Confirmed bugs** 和 **Candidates/observations**。低 confidence 问题不能自动阻止 Round 2 通过，除非用户将其列为 targeted bug。

### 基础设施失败不是产品 bug

`failure-classifier.ts` 把以下情况归为 INFRA_FAILURE（运行 verdict = INCONCLUSIVE）：

- Playwright 安装或浏览器缺失
- 端口冲突
- Electron 无法启动或因环境依赖崩溃
- 目标 URL 不可达
- 超时但没有产品状态证据
- harness 自身异常

这些结果绝**不**进入 `bugs.json`。

---

## 视觉与 UX 评估

### Screenshot Vision Prompt 模板

调用 `mcp__MiniMax__understand_image` 时使用以下固定模板：

```
你是产品 QA 观察员，不是视觉风格设计师。分析这张真实应用截图。
Persona：[name / role / experience / attention / patience / language]
当前目标：[story/task goal]
当前步骤：[step/action]
预期状态：[expected state, if known]
URL/窗口：[route or Electron window]
已有运行信号：[assertion、console、focus、latency 摘要]

只报告截图中**直接可观察**、会影响理解/操作/可访问性/任务完成的问题：
遮挡、重叠、裁切、文本截断、异常空白、层级混乱、错误对齐、对比度不可辨认、
缺少状态反馈、焦点不可见、加载状态不明确、可点击性不清、关键流程摩擦。

不要：把个人配色/风格偏好当 bug / 推断截图外功能 / 从静态截图断言 race condition / 内存泄漏 / 后端错误。
若无可见问题返回空数组。

返回 JSON 数组：[{type, severity (S0-S3), confidence (0-1), title, location, visible_evidence, user_impact, suggested_verification}]
```

返回结果由 `bug-detector.ts` 校验字段、丢弃越界值、绑定 screenshot path。视觉模型**不能**单独决定最终 verdict。

---

## 性能评估

### Playwright 基础指标

- `navigation_timing.{dom_content_loaded_ms, load_ms, first_contentful_paint_ms}`
- `lcp_ms` / `cls`（如 PerformanceObserver 可用）
- `long_tasks_ms`
- 每动作 `action_latency_ms`

### 可选 web-perf 与 Chrome DevTools MCP

若 `web-perf` skill 可用且 Chrome DevTools MCP 已配置，可在每 5–10 个关键节点调用一次以获取更详细的 trace。否则降级为基础采样。

### 性能结论门槛

- 单次本地慢不直接定为 bug
- 必须有 ≥3 样本或 Story 中显式 budget（`max_total_actions` 或 step 的 `max_actions`）
- 性能 bug 默认 S2，除非阻断主任务（→ S1）

---

## 闭环验证

### Round 1：发现问题

1. 冻结并持久化 Persona + Story + seed + viewport + locale + timezone + 初始 state
2. 记录 Git HEAD、working-tree diff hash、应用版本
3. 完整执行 Story，每个关键节点生成 evidence
4. 写 `bugs.json` + `report.md`
5. **不**自动改源码

### 修复建议与修改授权

- 默认 `--fix=none`：停在报告
- 用户修复（手动）或 `--fix=suggest`：调 LLM 给修复建议（基于 evidence + 代码上下文）
- `--fix=apply`：**必须**用户显式 ask 确认；改后立刻 git add + 记录新 HEAD

### Round 2：复现与回归

1. 读取 Round 1 冻结的 Persona / Story / bug list / seed / 环境参数
2. 使用相同 Web storage state 或 Electron userDataDir seed
3. 先逐个运行 targeted bug 的最短复现路径
4. 再运行完整 Story，检查修复是否引入回归

### Bug Diff 与 Verdict

| Verdict | 条件 |
|---|---|
| `VERIFIED_FIXED` | 所有 targeted bugs 均为 fixed；无新 S0/S1；关键任务断言全部通过 |
| `PARTIALLY_FIXED` | 至少 1 个 targeted bug fixed，但仍有 persistent target 或新的 S2/S3 |
| `NOT_FIXED` | 任一 targeted S0/S1 persistent，或核心断言仍失败 |
| `REGRESSION` | 出现新的 S0/S1，或之前通过的关键断言失败 |
| `INCONCLUSIVE` | 环境/启动/认证/harness 故障使同条件对比无法完成 |

> **关键不变量**："Round 2 中没出现" **不**自动等于 fixed——必须到达相同步骤、相关断言通过且证据可比；未到达路径时标 `inconclusive`。

---

## 输出与报告格式

### Bug JSON Contract

完整 schema 见 `schemas/bug.schema.json`。关键约束：

- `fingerprint` 基于 detector code + story step + route/window + 语义元素标识 + normalized failure
- **不**依赖标题文本或 screenshot hash
- 视觉 only + confidence < 0.7 → `candidate: true`

### Markdown 报告

`report.md` 包含：

1. Summary 表（S0/S1/S2/S3 × Confirmed/Candidates）
2. Confirmed bugs 详细列表（severity、fingerprint、detectors、screenshots、reproduction）
3. Candidates 列表（带 `candidate: true` 标记）
4. Limits of this run（已知限制）

### Round Comparison

`verification-report.md` 包含：

- Verdict + reason
- Targeted（baseline_bug_id → status）
- Regression（新增 S0/S1）
- New bugs
- Persistent
- Inconclusive

---

## 已知限制

诚实声明 v1 不能做什么：

1. **视觉 / UX 的 LLM false positives**：模型可能把设计选择误判为问题；反之亦然。confidence 标注 + candidate 分离只缓解，不解决。
2. **不能可靠发现 race condition / 内存泄漏 / 细微性能回归**：UI 探索不能证明 race / leak / 长期退化。
3. **性能数据受环境噪声影响**：dev server、首次构建、浏览器缓存都会影响结果；无 ≥3 样本只输出 observation。
4. **成本较高**：自由探索每步可能包含 DOM 摘要 + 截图 + 视觉调用 + 子代理推理；多 Persona / 20 步 / Round 2 会消耗大量 token、时间和磁盘。
5. **自由探索不可完全复现**：seed + Persona + viewport + novelty algorithm 能减少差异，但 LLM 路径仍可能在不同运行中变化。Task Mode 更适合严格回归。
6. **认证 / 验证码 / 系统权限能力有限**：CAPTCHA、SSO、硬件权限、OS 原生文件选择器、支付、生产数据删除通常需要人工介入。
7. **并非完整可访问性测试**：可检查焦点、语义角色、键盘路径和部分对比度，但**不能替代**真实 screen reader、switch control、WCAG 审计。
8. **复杂渲染界面识别较弱**：Canvas、WebGL、视频、远程桌面、快速动画、透明 overlay、多窗口 native menu 缺少可靠 DOM/AX 信号。
9. **Electron 与平台差异**：Windows / macOS / Linux 的菜单、字体、窗口装饰、权限、packaged build 行为不同。
10. **v1 不支持 Native/Mobile**：原生桌面自动化与移动设备需要不同 driver / 设备生命周期 / 手势 / 权限模型。

---

## 示例调用

### Task Mode（Web）

```bash
/user-simulator \
  --target https://staging.example.com \
  --platform web \
  --mode task \
  --persona examples/personas/first-time-user.yaml \
  --story examples/stories/task-mode.yaml
```

### Task Mode（Electron）

```bash
/user-simulator \
  --target <path-to-your-electron-app-or-entry> \
  --platform electron \
  --mode task \
  --story examples/stories/task-mode.yaml
```

`<path-to-your-electron-app-or-entry>` is either a packaged executable
(`.exe` / packaged build output) or the main entry script (`.ts` / `.js`)
that Playwright will hand to `_electron.launch()`.

### Free Exploration（Web + dev server）

```bash
/user-simulator \
  --target ./frontend \
  --platform web \
  --mode explore \
  --dev-command "pnpm dev" \
  --ready-url http://localhost:5173 \
  --persona examples/personas/first-time-user.yaml \
  --story examples/stories/free-exploration.yaml \
  --max-steps 20
```

### Round 2 验证

```bash
# Round 1（首次发现）
/user-simulator --target ... --mode task --story ... --round 1

# 用户修复后
/user-simulator --target ... --mode task --story ... --round 2 --baseline 20260113-103045-ab12cd34
```

---

## 故障处理

| 症状 | 处理 |
|---|---|
| `Playwright not installed` | `cd plugins/user-simulator/skills/user-simulator/scripts && npm install` |
| `chromium not found` | `npx playwright install chromium` |
| `port already in use` | 释放目标端口（web）或 userDataDir（electron） |
| `target_unreachable` | 手动验证 dev server / Electron entry 可启动 |
| `harness_exception` | 检查 stack；通常是 CLI 自身 bug |
| Round 2 verdict=INCONCLUSIVE | 检查 Round 2 是否实际跑到了原 step/route；若否，补充 Story 或重新设计 |

---

## 安全与隐私

- Story 的 `safety.redact_text_patterns` 在写 artifact 前做 best-effort 文本过滤（写入 `ArtifactStore.redact`）
- 默认 redact 不启用——用户必须显式声明
- 截图、DOM、events 全部保留在 `<project>/.user-simulator/` 下，不上传外部
- 视觉调用通过 `mcp__MiniMax__understand_image`——遵循该 MCP 的隐私边界
- 生产环境必须显式 `--env=production`，SKILL 会 ask 二次确认

---

## 反模式

**严禁**：

- ❌ 把视觉偏好（颜色 / 字体 / 间距审美）当成确定 bug
- ❌ Round 1 未经请求修改源码
- ❌ 将端口占用、Playwright 安装失败、应用未启动记为产品 bug
- ❌ 自由探索中执行购买、删除数据、发送消息等不可逆动作
- ❌ 用 CSS selector 堆砌替代语义用户行为（除非真的没有 role/label/text/test_id）
- ❌ Round 2 使用不同 Persona / seed / viewport / 初始数据后仍宣称"已修复"
- ❌ 因一次干净运行就宣称 race condition / flake / 性能回归已修复
- ❌ 对 Native / Mobile 声称 v1 支持
- ❌ 把 model-only 的低 confidence finding 自动升级为 confirmed bug
- ❌ 在 README 中夸大 bug 检出率；只承诺 Recall ≠ 100%、False Positives > 0%

---

## 相关 Skill

- **app-factory**：快速搭建新的待测项目。
- **sync-skills**：本 skill 安装后建议运行 `/sync-skills` 同步 `~/.claude/skills/` 与 `~/.agents/skills/`。
- **speedpr**：若 user-simulator 在 CI 中发现 bug → 提 PR → speedpr 推进 PR；非必需，但链路顺畅。

> 一些用户还会把 user-simulator 与第三方 Electron E2E 脚手架（Playwright fixture 生成、pipeline runner）配合使用。本 skill 假设目标应用已可启动；不替你生成 fixture。