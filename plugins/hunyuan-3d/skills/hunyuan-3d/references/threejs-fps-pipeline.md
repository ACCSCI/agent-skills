# Three.js WebFPS 资产管线

> 参数选择见 SKILL.md「场景参数推荐」表，本文档专注 Three.js 集成。

## 一键管线命令

```bash
# 静态资产 (武器/道具/场景)
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob \
  --Prompt "战术突击步枪" --ResultFormat GLB --EnablePBR true \
  && python hunyuan3d.py wait <JobId> --opt

# 角色 (带4个动画)
python hunyuan3d.py pipeline "穿防弹衣的士兵"
# 自动执行: Pro(角色) → rigging(绑骨) → motion(待机/走路/跑步/死亡) → GLB+opt
```

## 加载代码

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const loader = new GLTFLoader();

// 静态模型 — 直接挂到相机或场景
loader.load('output/gun_opt.glb', (gltf) => {
  camera.add(gltf.scene);           // 武器挂载第一人称相机
  // scene.add(gltf.scene);         // 场景物件
});

// 动画角色 — AnimationMixer 驱动
loader.load('output/soldier_walk_opt.glb', (gltf) => {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(gltf.animations[0]);
  action.play();
  // update loop: mixer.update(deltaTime);
});
```

## 批量资产清单模板

```bash
# === 武器 ===
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "突击步枪" --ResultFormat GLB --EnablePBR true
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "手枪" --ResultFormat GLB --EnablePBR true
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "战斗匕首" --ResultFormat GLB --EnablePBR true
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "手榴弹" --ResultFormat GLB --EnablePBR true

# === 场景 ===
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "军用弹药箱" --ResultFormat GLB --EnablePBR true
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "混凝土防爆墙" --ResultFormat GLB --EnablePBR true
python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "油桶" --ResultFormat GLB --EnablePBR true

# === 敌人 ===
python hunyuan3d.py pipeline "蒙面士兵"
python hunyuan3d.py pipeline "重装兵"

# 等待所有完成
python hunyuan3d.py wait --all --opt
```

## 文件大小参考 (Express + --opt)

| 资产类型 | 原始 GLB | 优化后 | 
|---------|---------|--------|
| 武器 | ~8MB | ~400KB |
| 场景物件 | ~6MB | ~300KB |
| 角色+动画 | ~15MB | ~1.5MB |
