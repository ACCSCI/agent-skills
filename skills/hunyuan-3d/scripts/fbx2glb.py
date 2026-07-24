"""
FBX → GLB 转换工具 (通过 Blender headless)
保留骨骼、蒙皮、动画、材质
用法: python fbx2glb.py input.fbx [output.glb]
"""
import subprocess
import sys
from pathlib import Path

BLENDER_BLEND = """\
import bpy, sys, os
fbx_in = sys.argv[-2]
glb_out = sys.argv[-1]

# 清理场景
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

# 导入 FBX
bpy.ops.import_scene.fbx(filepath=fbx_in)

# 导出 GLB (保留动画+骨骼)
bpy.ops.export_scene.gltf(
    filepath=glb_out,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_apply=False,
)
print(f"DONE: {glb_out}")
"""

def fbx2glb(input_fbx: str, output_glb: str = None):
    inp = Path(input_fbx)
    if not inp.exists():
        raise FileNotFoundError(f"找不到: {input_fbx}")
    out = output_glb or str(inp.with_suffix(".glb"))

    script = Path(inp.parent) / "_fbx2glb_script.py"
    script.write_text(BLENDER_BLEND)

    subprocess.run(
        ["blender", "--background", "--python", str(script), "--", str(inp), out],
        check=True, timeout=120
    )
    script.unlink(missing_ok=True)

    if Path(out).exists():
        print(f"✅ {inp.name} → {Path(out).name}  ({Path(out).stat().st_size:,} bytes)")
    return out

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python fbx2glb.py input.fbx [output.glb]")
        sys.exit(1)
    fbx2glb(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
