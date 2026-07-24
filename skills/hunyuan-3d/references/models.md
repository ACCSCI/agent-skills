# HY-3D 模型列表

> 数据来源: https://cloud.tencent.com/document/api/1804 模型列表.md
> 实时在线状态: `tccli ai3d help` 或 `GET https://tokenhub.tencentmaas.com/v1/models`

## 3D 模型

| Model ID (tccli) | 名称 | 并发 | 功能 |
|---|---|---|---|
| `3.0` | HY-3D-3.0 专业版 | 3 | 文生3D / 图生3D / 多视图(6视角) / 白模 / 草图 / 智能拓扑 |
| `3.1` | HY-3D-3.1 专业版 | 3 | 文生3D / 图生3D / 八视图(8视角) / 白模 |
| (Express) | HY-3D-Express 极速版 | 1 | 文生3D / 图生3D / 快速白模 (~1.5min) |

## 输出格式

| 格式 | 支持模型 |
|------|---------|
| OBJ | Pro / Rapid |
| GLB | Pro / Rapid |
| STL | Pro / Rapid |
| FBX | Pro / Rapid |
| USDZ | Pro / Rapid |
| MP4 | Rapid only |
| GIF | Convert only |

## 图片输入限制

- 分辨率: 128 ~ 5000 px
- URL: ≤ 8MB
- Base64: 编码前 ≤ 6MB
- 格式: JPG / PNG / JPEG / WebP
- 建议: 纯色背景、单一主体、主体占比 >50%
