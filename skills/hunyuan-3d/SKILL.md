---
name: hunyuan-3d
description: >
  腾讯混元生3D (Tencent HY-3D) 文本/图片生成3D模型的云端API。支持文生3D、图生3D、
  多视图生3D、白模、草图生3D、智能拓扑、纹理生成、UV展开、绑骨蒙皮、文生动作、
  3D人物生成、格式转换等19个接口。当用户需要生成3D模型、转换3D格式、生成3D纹理、
  给3D模型绑骨骼、生成3D动画动作、从照片生成3D人物时使用此skill。
  Triggers on: 3D生成、生成3D、混元3D、HY-3D、文生3D、图生3D、3D模型、
  text-to-3d、image-to-3d、纹理生成、绑骨、蒙皮、rigging、UV展开、格式转换、
  智能拓扑、lowpoly、白模、3D人物生成、3D动作、hunyuan3d。
---

# 腾讯混元生3D (HY-3D)

> **权威文档**: https://cloud.tencent.com/document/api/1804
>
> **API 参数以官方文档为准。** 如果调用出错或参数不确定，必须第一时间
> `WebFetch` 官方文档验证，不要依赖本地文档或记忆中过时的信息。

## 能力与边界

### ✅ Skill 能做什么

| 能力 | API | 产出 |
|------|-----|------|
| 文生3D | Pro / Rapid | 文字描述 → 3D 模型 (GLB/OBJ/FBX/STL/USDZ) |
| 图生3D | Pro / Rapid | 单张图片 → 3D 模型 |
| 多视图生3D | Pro 3.0/3.1 | 6~8 张多角度图 → 高精度 3D 模型 |
| 草图生3D | Pro 3.0 | 手绘草图/线稿 → 3D 模型 |
| 白模 | Pro(Geometry) / Rapid(EnableGeometry) | 无纹理纯几何模型 |
| 智能拓扑 | Pro 3.0(LowPoly) | 高模 → 低模 (保持外形, 减面数) |
| 纹理生成 | Texture API | 白模 + 参考图/描述 → 贴纹理 |
| UV 展开 | UV API | 模型 → 自动 UV 映射 |
| 组件生成 | Part API | 生成 3D 零件/部件 |
| 绑骨蒙皮 | Rigging API | 人形模型 → 自动骨骼绑定+蒙皮 |
| 文生动作 | Motion API | 文字 → FBX 骨骼动画 (1-12秒) |
| 3D 人物 | Profile API | 真人照片 → 3D 角色 (预设模板) |
| 格式转换 | Convert API | OBJ/GLB/FBX ↔ STL/USDZ/MP4/GIF |

**后处理链** (hunyuan3d.py 提供):
- `--glb`: FBX 自动转 GLB (保留骨骼动画, 给 Three.js 用)
- `--opt`: gltf-transform draco+webp 压缩 (网页优化, 通常 -90%+)
- `pipeline`: 一键角色管线 (模型→绑骨→4动画→GLB)

### ❌ Skill 不能做什么

**引擎侧工作 (这是 Agent/开发者的事):**
- 关卡设计 / 场景搭建 — 只生成单个资产, 不摆放位置
- 碰撞体 — 生成的模型不带 collision mesh
- LOD 级联 — 需手动调用多次生成不同面数的版本
- 动画状态机 — motion API 给的是独立 clip, 需要引擎里自己搭 Animator/BlendTree
- 动画重定向 — 不同骨骼间的 retarget 需 Blender/Unity 处理
- Shader/Material — 输出的是标准 PBR, 引擎里的 Shader Graph 要自己连

**实时/运行时:**
- 不支持实时生成 — 所有任务异步离线, 1-5 分钟/个
- 不支持程序化生成 (无法生成无限变化的变体)
- 不支持生成时直接编辑 (不能"把剑变弯一点"或"眼睛大一点")

**质量边界:**
- AI 生成, 不是人工建模 — 拓扑偶有不完美, 细节可能模糊
- 纹理是 AI 合成的, 不是照片级扫描 — 接近但不如 Substance Painter 手绘
- 绑骨质量取决于输入模型 — 非人形/非 A-pose/T-pose 效果差
- 生成了不能微调 — 不满意只能重来, 不能局部修改

**竞争/互补 Skill:**
| 需求 | 用哪个 |
|------|--------|
| 3D 模型/动画 | 本 skill (HY-3D) |
| 游戏音效 (枪声/爆炸/UI) | `game-soundfx` skill |
| 游戏逻辑/引擎代码 | Agent 直接写 |
| 网页游戏性能优化 | Agent + gltf-transform |

### 🎯 决策表: 这个需求能不能接?

```
用户请求 → 判断:
  ├─ "生成一个XXX的3D模型"          → ✅ 直接做
  ├─ "给这个角色做走路动画"          → ✅ Motion API
  ├─ "帮我搭一个关卡"                → ❌ 只生成资产, 摆放靠 Agent
  ├─ "优化这个模型的面数"            → ✅ LowPoly API
  ├─ "帮我导入 Unity 并设置 LOD"     → ⚠️ 给模型, 引擎设置靠 Agent
  ├─ "批量生产 20 把不同的枪"        → ✅ 并发提交
  ├─ "把剑变长一点"                  → ❌ 不能改, 重新生成
  ├─ "生成一个3D角色的爆炸音效"      → → 交给 game-soundfx skill
  └─ "在游戏里实时生成3D"            → ❌ 异步离线, 不支持实时
```

## 前置条件

```bash
pip install tccli
tccli configure set secretId <YourSecretId>
tccli configure set secretKey <YourSecretKey>
tccli configure set region ap-guangzhou
```

验证: `tccli ai3d help` (应显示 19 个 Actions)

## 核心模式

### 1. 调用任意 API (通用方式)

```bash
tccli ai3d <Action> --Key1 Val1 --Key2 '{"json":"obj"}' ...
```

所有 submit 类接口返回 `JobId`，query 类接口通过 `JobId` 查询状态。

JobId 用于后续查询 — **务必记住 JobId**。

### 2. 便利工具 (推荐用于长时间等待的任务)

项目中的 `hunyuan3d.py` 封装了 tccli，提供 job 跟踪和自动轮询:

```bash
# 提交 + 自动跟踪
python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py submit <Action> --Key Val ...

# 等待完成 + 自动下载
python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py wait <JobId>
python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py wait --all

# 查看所有跟踪的任务
python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py list

# 格式转换
python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py convert <url_or_file> <Format>
```

### 3. 查询任务时自动推断 Query Action

不同 submit 接口对应不同查询接口。本地 hunyuan3d.py 自动映射，直接 `wait` 即可。
如果手动用 tccli，查 `references/api-index.md` 获取 submit→query 映射。

## 工作流程

用户请求生成3D内容时:

1. **匹配场景** — 对照下方场景表确定推荐参数
2. **确定任务类型** — 查 `references/api-index.md` 找到对应 Action
3. **查看参数** — 用 `tccli ai3d <Action> help` 或 fetch 官方文档
4. **提交任务** — `python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py submit <Action> --Key Val ...`
5. **等待完成** — `python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py wait <JobId> [--glb] [--opt]`
6. **交付结果** — 文件在 `output/` 目录中

## 场景参数推荐

**根据用户描述的用途，自动选择推荐参数组合。** 这是核心决策表：

### 静态模型 (道具/武器/场景)

| 场景 | 模型 | 面数 | PBR | 格式 | 优化 | 典型耗时 | 典型大小 |
|------|------|------|-----|------|------|---------|---------|
| 🎮 网页/手游 | `SubmitHunyuanTo3DRapidJob` | 默认 | true | GLB | `--opt` | ~1.5min | ~400KB |
| 🖥️ 独立游戏 (PC) | `SubmitHunyuanTo3DProJob --Model 3.0` | 50000 | true | GLB | `--opt` | ~3min | ~2MB |
| 🎬 3A/过场动画 | `SubmitHunyuanTo3DProJob --Model 3.1` | 500000+ | true | FBX | 不压缩 | ~5min | ~30MB+ |
| ⚡ 快速原型 (只看效果) | `SubmitHunyuanTo3DRapidJob` | 默认 | false | GLB | 不压缩 | ~1.5min | ~8MB |

### 角色 (带骨骼+动画)

| 场景 | 建模 | 绑骨 | 动画 | 最终格式 |
|------|------|------|------|---------|
| 🎮 网页/手游 | Rapid | Rigging | Motion × 4 | + `--glb --opt` |
| 🖥️ 独立游戏 | Pro 3.0 | Rigging | Motion × 6 | + `--glb --opt` |
| 🎬 3A | Pro 3.1 + 多视图 | Rigging | Motion × 8+ | FBX→引擎工具链优化 |

### 决策逻辑

```
用户说"网页" / "mobile" / "h5" / "在线" → 网页/手游行
用户说"独立游戏" / "PC" / "steam" → 独立游戏行
用户说"3A" / "电影" / "过场" / "高精度" → 3A行
用户说"快速" / "原型" / "看看效果" → 快速原型行
没有明确说 → 问用户目标平台
```

提交示例:
```bash
# 网页游戏武器
python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py submit SubmitHunyuanTo3DRapidJob \
  --Prompt "一把战术突击步枪" --ResultFormat GLB --EnablePBR true \
  && python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py wait <JobId> --opt

# 3A 级场景资产
python ~/.claude/skills/hunyuan-3d/scripts/hunyuan3d.py submit SubmitHunyuanTo3DProJob \
  --Prompt "哥特式大教堂废墟" --ResultFormat FBX --Model 3.1 \
  --FaceCount 1000000 --EnablePBR true
```

## 快速参考

- 完整 API 列表 & submit→query 映射: `references/api-index.md`
- 模型列表 & 并发限制: `references/models.md`
- 常见错误码: `references/error-codes.md`
- Three.js/FPS 完整管线: `references/threejs-fps-pipeline.md`
- 图片输入规范 & 最佳实践: `references/models.md`

## 注意事项

- 3D 生成任务通常需要 2-5 分钟，极速版约 1.5 分钟
- 图片输入: 分辨率 128~5000，大小 ≤8MB (URL) / ≤6MB (Base64)
- 专业版并发上限 3，极速版并发上限 1
- 生成结果是临时 URL，有时效性，尽快下载
- 遇到 `429`/`上限` 错误 = 并发满了，等 30s 重试
