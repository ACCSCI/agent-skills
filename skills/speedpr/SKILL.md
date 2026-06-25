---
name: speedpr
description: "Automate the current working branch to 'Ready To Merge' status. Auto-detects phase (A:uncommitted → B:unpushed → C:no PR → D:PR exists), handles review/CI/conflicts. Action-first, interrupt only on disputes. Supports /loop for continuous monitoring. Pass 'auto' to enable automatic merging (disabled by default)."
argument-hint: "[auto]"
---

# ⚡ speedpr — 自动 PR 推进

## 核心原则

**优先执行，非必要不询问。** 仅在以下情况**必须**打断用户：
- Reviewer 意见存在争议（建议 vs 要求）
- 不确定正确的实现方案
- 涉及重大架构修改
- 存在多个合理方案且无法判断

确定正确的 → 直接修改并继续。不确定的 → 汇总给用户讨论后继续。

---

## 参数

- **无参数**（默认）：PR 就绪后仅通知用户，**不执行合并**
- **传入 `auto`**：PR 就绪后自动合并（`gh pr merge --squash`）

通过 `/speedpr auto` 启用自动合并。

---

## 自动阶段检测

执行入口：判断当前仓库状态，按 A→B→C→D 优先级进入对应阶段。

### 阶段 A：存在未提交变更

```bash
git status --short
git diff --stat
```

1. 分析变更内容（新增/修改/删除的文件）
2. 按逻辑分组生成合理的中文 commit message
3. 执行 commit
4. 回到入口继续检测

**规则：** 不要问"这样可以吗"，直接 commit。除非变更明显不完整或有语法错误。

### 阶段 B：有 ahead commits 未推送

```bash
git status -b
```

1. `git push`
2. 回到入口继续检测

### 阶段 C：远程分支无关联 PR

```bash
git branch --show-current
gh pr list --head <branch> --state open --json number
```

1. 分析 commits 或变更生成中文 title 和 description
2. `gh pr create --title "<中文标题>" --body "<中文描述>" --fill`
3. 回到入口继续检测

### 阶段 D：PR 已存在（核心循环）

执行以下三项检查：

#### ① Review Comments

先用 GraphQL 查询获取所有 review thread（见「工具使用 → Review Thread 操作 → Step 1」）：

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          comments(first:10) {
            nodes {
              id author { login } body createdAt path line
            }
          }
        }
      }
    }
  }
}' -f owner='{owner}' -f repo='{repo}' -F number=<pr_number>
```

逐条分析每个 **未 resolve** 的 review thread（跳过 `isResolved: true` 的）：

- **明确正确且可修复** → 直接修复代码 → commit → push → **GraphQL reply** thread → **GraphQL resolve** thread
- **纯技术性修改**（重构/测试/lint/类型修正）→ 直接修改 → commit → push → **GraphQL reply** → **GraphQL resolve**
- **明确正确但不可直接改**（如 CI 配置变更请求） → reply 说明已做的修改 → **GraphQL resolve**（只 resolve 已解决的）
- **不明确/争议** → **停止**，汇总所有争议问题给用户

> ⚠️ Reply 和 resolve 必须使用 GraphQL mutation（见「工具使用 → Review Thread 操作 Step 2 & 3」）。
> REST API 无法 reply 到 review thread 也无法 resolve thread，用错端点会导致操作静默失败。

判断标准：是否需要人类判断？涉及业务逻辑含义/产品决策/架构取舍 → 停止。其它明确的技术性意见 → 直接改 + resolve。

处理 thread 的顺序：按时间从旧到新，每条处理后标记，避免重复处理。

#### ② CI Status

```bash
gh pr view <number> --json statusCheckRollup,reviews
```

检查所有 CI check：
- ❌ 失败 → 分析日志，修复确定问题（不引入无关重构或重写代码），commit，push
- ⏳ 运行中 → 等待或标记
- ✅ 通过 → 继续

**规则：** CI 修复只做最小必要改动。不要"顺便重构"。

#### ③ Merge Conflicts

```bash
gh pr view <number> --json mergeStateStatus,baseRefName,headRefName
```

如果存在冲突：
1. `gh repo sync <base>` 或 `git fetch origin <base>`
2. `git merge <base>` 或 `git rebase <base>`
3. 解决冲突（手动编辑冲突文件）
4. 验证构建
5. push

---

## 循环模式（/loop Nmin）

当用户以 `/loop 2min` 等间隔启动时：

### 每轮循环

1. 进入阶段 D 检查
2. 依次检查：review comments → CI status → merge conflicts
3. 处理所有发现的问题

### 退出条件（全部满足视为 Ready To Merge）

- [ ] 无未处理的 review comment（所有已 resolve 或 awaited）
- [ ] 所有 CI check 通过
- [ ] 无 merge conflict

### 循环间隔建议

| 场景 | 间隔 | 理由 |
|------|------|------|
| CI 运行中 | 2-3min | CI 通常几分钟完成 |
| 无活跃 review | 5min | 空闲轮询降低频率 |
| 有未处理 comment | 1-2min | 需要及时跟进 |

每轮结束后输出状态摘要：

```
🔄 Round #N  [interval]
  ✓ Review: 3/3 resolved, 0 pending
  ✗ CI: 1 failing (test-auth)
  ✓ Conflict: none
  → Next check in 2min
```

当所有条件满足时，输出：

**无参数模式（默认）：**
```
✅ Ready To Merge!
  ✓ All reviews resolved
  ✓ CI passing
  ✓ No conflicts
  Branch: feature/xxx → main
  ── PR 已就绪，请手动合并 ──
```

**auto 模式：**
```
✅ Ready To Merge!
  ✓ All reviews resolved
  ✓ CI passing
  ✓ No conflicts
  Branch: feature/xxx → main
  → Auto-merging...
```
执行 `gh pr merge <number> --squash`，输出合并结果。

---

## 工具使用

### 优先使用 gh CLI

| 操作 | 命令 |
|------|------|
| PR 详情 | `gh pr view <number> --json <fields>` |
| PR 列表 | `gh pr list --head <branch> --state open --json number` |
| 创建 PR | `gh pr create --title "..." --body "..."` |
| 合并检查 | `gh pr merge <number> --dry-run` |

### Review Thread 操作（必须用 GraphQL）

> ⚠️ GitHub REST API 不支持 resolve review thread，必须用 GraphQL。
> REST 的 `dismissals` 端点是驳回整个 review，不是 resolve thread。

**Step 1：获取所有 review thread 及其状态**

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          comments(first:10) {
            nodes {
              id
              author { login }
              body
              createdAt
              path
              line
            }
          }
        }
      }
    }
  }
}' -f owner='{owner}' -f repo='{repo}' -F number=<pr_number>
```

返回结构说明：
- `nodes[].id` — thread ID（用于 resolve）
- `nodes[].isResolved` — 是否已 resolve
- `nodes[].comments.nodes` — 该 thread 下的所有评论（第一条是 reviewer 原始 comment，后续是 reply）
- `comments.nodes[].id` — 单条评论 ID（用于 reply）

**Step 2：Reply 到 review thread**

> ⚠️ 注意:`addPullRequestReviewThreadReply` 的 input field 是 **`pullRequestReviewThreadId`**(不是 `threadId`),返回字段是 **`comment`**(不是 `reply`,且只有 `id`)。

```bash
gh api graphql -f query='
mutation($id:ID!, $body:String!) {
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id, body:$body}) {
    comment { id }
  }
}' -f id='<thread_id>' -f body='✅ Fixed in <commit-sha>'
```

**Step 3：Resolve thread**

```bash
gh api graphql -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}' -f threadId='<thread_id>'
```

### JSON 字段速查

```bash
# 完整 PR 信息（不含 review thread ID，仅用于 CI/冲突等）
gh pr view <number> --json number,title,state,mergeStateStatus,baseRefName,headRefName,statusCheckRollup,comments,reviews,files

# 冲突检测
gh pr view <number> --json mergeStateStatus,mergeable

# CI 状态
gh pr view <number> --json statusCheckRollup

# Top-level PR comments（非 review thread，如 issue comment）
gh api "repos/{owner}/{repo}/issues/{number}/comments" --jq '.[].body'
```

---

## 常见场景处理

### 场景 1：首次运行（全流程）

```
未提交变更 → commit → push → 创建 PR → 等待 CI
```

直接一条龙完成，不需要中途确认。

### 场景 2：PR 有 review 请求修改

```
分析 comment → 确定修复方案 → 修改 → commit → push → reply → resolve
```

如果 comment 要求修改且明确 → 直接做。如果 comment 是问题或建议 → 判断是否需要用户决策。

### 场景 3：CI flaky test

```
重试：gh pr checks <number> --rerun-failed
```

如果多次重试同一 test 仍失败 → 分析是否真正 flaky → 是则标记，否则修复。

### 场景 4：冲突

```
git fetch origin <base>
git merge <base>
解决冲突后构建验证
```

### 场景 5：多个 PR

如果当前分支关联多个 PR → 抛出错误让用户指定操作哪个 PR。

---

## 输出风格

- 简洁、行动优先
- 每步输出一行状态，不要大段解释
- 错误发生时输出关键错误信息，不要 panic
- 阶段性汇总用 emoji 标记（✓ 完成 / ✗ 失败 / ⏳ 等待 / 🔄 处理中）

**好例子：**
```
✓ Committed: feat: 添加用户认证接口
✓ Pushed to origin/feat-auth
✓ PR #42 created: feat: 添加用户认证接口
⏳ CI running: 3/5 checks passed
```

**坏例子：**
```
现在让我先检查一下当前状态...看起来我们有一些文件变更，让我分析一下这些变更的内容...
```

---

## 错误处理

| 错误 | 处理方式 |
|------|---------|
| `gh` 未认证 | 提示用户 `gh auth login` |
| 不在 git 仓库 | 提示用户先进入项目目录 |
| push 被拒绝 | 检查是否有新 commit，pull --rebase 后重试 |
| PR 创建失败 | 检查是否有同名 PR |
| API rate limit | 等待后重试 |
| 非预期错误 | 输出错误信息，继续处理已知部分 |

---

## 安全注意事项

- 不要 force push 到共享分支
- 不要修改他人未 review 的代码区域除非 reviewer 要求
- CI 修复保持最小改动，不引入重构
- 不要关闭他人打开的 PR
- 默认不自动合并 PR；仅在明确传入 `auto` 参数时才执行合并
