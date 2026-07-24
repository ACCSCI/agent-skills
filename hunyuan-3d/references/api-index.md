# HY-3D API 完整索引

> 权威参数以 https://cloud.tencent.com/document/api/1804 为准
> 使用 `tccli ai3d <Action> help` 查看参数，或 `tccli ai3d <Action> help --detail` 看详细

## 3D 生成 (核心)

| Action | 功能 | submit→query |
|--------|------|-------------|
| `SubmitHunyuanTo3DProJob` | 专业版 文生3D/图生3D/多视图/白模/草图/智能拓扑 | `QueryHunyuanTo3DProJob` |
| `SubmitHunyuanTo3DRapidJob` | 极速版 文生3D/图生3D (1.5min内) | `QueryHunyuanTo3DRapidJob` |

## 后处理 & 增强

| Action | 功能 | submit→query |
|--------|------|-------------|
| `SubmitTextureTo3DJob` | 纹理生成 (给白模贴纹理) | `DescribeTextureTo3DJob` |
| `SubmitReduceFaceJob` | 智能拓扑 (低多边形重拓扑) | `DescribeReduceFaceJob` |
| `SubmitHunyuan3DPartJob` | 组件生成 (生成3D零件/部件) | `QueryHunyuan3DPartJob` |
| `SubmitHunyuanTo3DUVJob` | UV 展开 | `DescribeHunyuanTo3DUVJob` |

## 动画 & 绑定

| Action | 功能 | submit→query |
|--------|------|-------------|
| `SubmitHunyuanTo3DMotionJob` | 文生动作 (文字描述→3D动画) | `DescribeHunyuanTo3DMotionJob` |
| `SubmitAutoRiggingJob` | 绑骨蒙皮 (自动骨骼绑定+蒙皮) | `DescribeAutoRiggingJob` |

## 人物

| Action | 功能 | submit→query |
|--------|------|-------------|
| `SubmitProfileTo3DJob` | 3D人物生成 (照片→3D角色) | `DescribeProfileTo3DJob` |

## 工具

| Action | 功能 |
|--------|------|
| `Convert3DFormat` | 模型格式转换 (OBJ/GLB/STL/FBX/USDZ/MP4/GIF) |

## 常用参数速查

### SubmitHunyuanTo3DProJob
```
--Prompt "文本描述"          (文生3D, 最多1024字符)
--ImageUrl "https://..."     (图生3D URL)
--ImageBase64 "base64..."    (图生3D Base64, 本地文件走 hunyuan3d.py)
--ResultFormat GLB           (OBJ/GLB/STL/FBX/USDZ)
--Model 3.0                  (3.0 或 3.1)
--EnablePBR true             (PBR 材质)
--FaceCount 500000           (面数 3000~1500000)
--GenerateType Normal        (Normal/LowPoly/Geometry/Sketch)
--PolygonType triangle       (triangle/quadrilateral, 仅LowPoly)
```

### SubmitHunyuanTo3DRapidJob
```
--Prompt "文本描述"          (最多200字符)
--ImageUrl "https://..."
--ResultFormat GLB           (OBJ/GLB/STL/FBX/USDZ/MP4)
--EnablePBR true
--EnableGeometry true        (白模)
```

### SubmitTextureTo3DJob
```
--File3D '{"Url":"https://..."}'  (源3D模型, OBJ/GLB)
--Prompt "纹理描述"
--Image '{"Url":"https://..."}'   (纹理参考图)
--EnablePBR true
--TextureSize 4096                (720~4096)
--Model 3.0                       (3.0/3.1, 3.1支持多视图)
```

### SubmitAutoRiggingJob
```
--File3D '{"Url":"https://..."}'  (FBX或GLB, ≤60MB, 人形A/T Pose)
--MotionType 1                    (1~48, 预设动作编号)
```

### SubmitProfileTo3DJob
```
--Profile '{"Url":"https://face.jpg"}'  (真人头像, 500~4096px)
--Template basketball                   (basketball/pingpong/footballboy等)
```

### Convert3DFormat
```
--File3D "https://model.obj"  (FBX/OBJ/GLB, ≤60MB)
--Format STL                  (STL/USDZ/FBX/MP4/GIF)
```
