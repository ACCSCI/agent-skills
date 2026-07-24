#!/usr/bin/env python3
"""
混元生3D 轻量工具 — 弥补 tccli 缺失的「任务跟踪 + 自动轮询下载」
==============================================================
权威文档: https://cloud.tencent.com/document/api/1804
所有 API 调用直接用 tccli，本工具只做便利性封装。

前置要求:
  pip install tccli
  tccli configure set secretId xxx
  tccli configure set secretKey xxx
  tccli configure set region ap-guangzhou

用法:
  python hunyuan3d.py submit SubmitHunyuanTo3DProJob --Prompt "一只小狗" --ResultFormat GLB --Model 3.0
  python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "快猫" --ResultFormat GLB
  python hunyuan3d.py list                           # 列出跟踪的任务
  python hunyuan3d.py status                          # 查看任务状态(不轮询)
  python hunyuan3d.py wait <job_id>                   # 轮询等待+自动下载
  python hunyuan3d.py wait --all                      # 等所有跟踪任务完成
  python hunyuan3d.py download <job_id>               # 下载结果
  python hunyuan3d.py convert <url_or_file> STL       # 格式转换 (自动轮询下载)
"""

import subprocess
import json
import sys
import io
import time
import os
from pathlib import Path
from datetime import datetime

# Fix Windows encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.resolve()

def get_output_dir() -> Path:
    """输出目录: --output-dir > HY3D_OUTPUT_DIR > CWD/output"""
    # 从命令行找 --output-dir / -o
    for i, a in enumerate(sys.argv):
        if a in ("--output-dir", "-o") and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1]).resolve()
    env = os.environ.get("HY3D_OUTPUT_DIR")
    if env:
        return Path(env).resolve()
    return Path.cwd() / "output"

OUTPUT_DIR = get_output_dir()
JOBS_FILE = OUTPUT_DIR / "jobs.json"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# tccli 封装
# ============================================================
def tccli(action: str, **params) -> dict:
    """调用 tccli, 返回 JSON dict"""
    args = ["tccli", "ai3d", action]
    for k, v in params.items():
        if v is None or v == "":
            continue
        if isinstance(v, bool):
            v = "true" if v else "false"
        args.append(f"--{k}")
        args.append(str(v))

    r = subprocess.run(args, capture_output=True, text=True, timeout=120,
                       cwd=str(SCRIPT_DIR))

    if r.returncode != 0:
        # 尝试解析错误
        try:
            err = json.loads(r.stderr or r.stdout)
            msg = err.get("Error", {}).get("Message", r.stderr)
        except:
            msg = r.stderr or "unknown error"
        raise RuntimeError(f"tccli {action} 失败: {msg}")

    return json.loads(r.stdout)


def tccli_raw(args_str: str) -> dict:
    """透传原始参数给 tccli, 格式: 'action --key val ...'"""
    parts = args_str.strip().split()
    action = parts[0]
    more = parts[1:] if len(parts) > 1 else []

    args = ["tccli", "ai3d", action] + more
    r = subprocess.run(args, capture_output=True, text=True, timeout=120,
                       cwd=str(SCRIPT_DIR))

    if r.returncode != 0:
        try:
            err = json.loads(r.stderr or r.stdout)
            msg = err.get("Error", {}).get("Message", r.stderr)
        except:
            msg = r.stderr or "unknown error"
        raise RuntimeError(f"tccli 失败: {msg}")

    return json.loads(r.stdout)


# ============================================================
# Job 跟踪
# ============================================================
def load_jobs() -> dict:
    if JOBS_FILE.exists():
        try: return json.loads(JOBS_FILE.read_text(encoding="utf-8"))
        except: pass
    return {}

def save_jobs(jobs: dict):
    JOBS_FILE.write_text(json.dumps(jobs, indent=2, ensure_ascii=False), encoding="utf-8")

def add_job(job_id: str, meta: dict):
    jobs = load_jobs()
    jobs[job_id] = {**meta, "created_at": datetime.now().isoformat(), "status": "queued"}
    save_jobs(jobs)

def update_job(job_id: str, status: str):
    jobs = load_jobs()
    if job_id in jobs:
        jobs[job_id]["status"] = status
        jobs[job_id]["updated_at"] = datetime.now().isoformat()
        save_jobs(jobs)


# ============================================================
# 查询 & 下载
# ============================================================
QUERY_ACTIONS = {
    "SubmitHunyuanTo3DProJob":     "QueryHunyuanTo3DProJob",
    "SubmitHunyuanTo3DRapidJob":   "QueryHunyuanTo3DRapidJob",
    "SubmitTextureTo3DJob":        "DescribeTextureTo3DJob",
    "SubmitReduceFaceJob":         "DescribeReduceFaceJob",
    "SubmitHunyuan3DPartJob":      "QueryHunyuan3DPartJob",
    "SubmitHunyuanTo3DUVJob":      "DescribeHunyuanTo3DUVJob",
    "SubmitHunyuanTo3DMotionJob":  "DescribeHunyuanTo3DMotionJob",
    "SubmitAutoRiggingJob":        "DescribeAutoRiggingJob",
    "SubmitProfileTo3DJob":        "DescribeProfileTo3DJob",
}

def query_job(action: str, job_id: str) -> dict:
    """自动推断 query action"""
    qa = QUERY_ACTIONS.get(action)
    if not qa:
        raise ValueError(f"未知的 submit action: {action}, 无对应 query")
    return tccli(qa, JobId=job_id)


def wait_job(action: str, job_id: str, max_wait=600, interval=15,
             auto_download=True, to_glb=False, optimize=False) -> dict | None:
    """轮询等待任务完成"""
    print(f"轮询 {job_id} (by {action})...")
    start = time.time()
    while (time.time() - start) < max_wait:
        time.sleep(interval)
        r = query_job(action, job_id)
        status = r.get("Status", "")
        elapsed = int(time.time() - start)
        if status == "DONE":
            print(f"  [{elapsed}s] DONE")
            update_job(job_id, "completed")
            if auto_download:
                download_result(job_id, r, to_glb=to_glb, optimize=optimize)
            return r
        elif status == "FAIL":
            print(f"  [{elapsed}s] FAIL: {r.get('ErrorMessage','?')}")
            update_job(job_id, "failed")
            return r
        else:
            print(f"  [{elapsed}s] {status}...")
    print(f"  TIMEOUT after {max_wait}s")
    update_job(job_id, "timeout")
    return None


def download_result(job_id: str, result_data: dict = None, to_glb: bool = False,
                    optimize: bool = False):
    """下载 ResultFile3Ds 中的文件"""
    if not result_data:
        result_data = load_jobs().get(job_id, {}).get("_last_result", {})
    files = result_data.get("ResultFile3Ds") or []
    if not files:
        print("  无文件可下载")
        return
    for item in files:
        url = item.get("Url", "")
        ftype = item.get("Type", "file").lower()
        if not url: continue
        fname = f"{job_id}.{ftype}"
        fp = OUTPUT_DIR / fname
        try:
            import requests
            content = requests.get(url, timeout=120).content
            fp.write_bytes(content)
            note = " (zip)" if content[:2] == b"PK" else ""
            print(f"  -> {fname}  {len(content):,} bytes{note}")

            # opt-in: FBX → GLB
            if to_glb and ftype == "fbx":
                try:
                    from fbx2glb import fbx2glb
                    fbx2glb(str(fp))
                except Exception as e:
                    print(f"  (FBX→GLB: {e})")

            # opt-in: gltf-transform optimize
            if optimize and (ftype == "glb" or fname.endswith(".glb")):
                try:
                    opt_fp = fp.with_stem(fp.stem + "_opt")
                    subprocess.run(
                        ["gltf-transform", "optimize", str(fp), str(opt_fp),
                         "--compress", "draco", "--texture-compress", "webp"],
                        check=True, timeout=60, capture_output=True)
                    if opt_fp.exists():
                        pct = (1 - opt_fp.stat().st_size / fp.stat().st_size) * 100
                        print(f"  -> {opt_fp.name}  {opt_fp.stat().st_size:,} bytes  (-{pct:.0f}%)")
                except Exception as e:
                    print(f"  (optimize: {e})")
        except Exception as e:
            print(f"  err {e}")


# ============================================================
# CLI
# ============================================================
def cmd_submit():
    """submit <action> --key val ..."""
    parts = sys.argv[2:]
    if not parts:
        print("用法: python hunyuan3d.py submit <Action> --Key Val ...")
        print("示例: python hunyuan3d.py submit SubmitHunyuanTo3DProJob --Prompt '小狗' --ResultFormat GLB --Model 3.0")
        return

    action = parts[0]
    # 构建参数字典
    params = {}
    i = 1
    while i < len(parts):
        if parts[i].startswith("--"):
            key = parts[i][2:]
            if i + 1 < len(parts) and not parts[i + 1].startswith("--"):
                params[key] = parts[i + 1]
                i += 2
            else:
                params[key] = ""  # flag, no value
                i += 1
        else:
            i += 1

    print(f"tccli ai3d {action} ...")
    result = tccli(action, **params)
    jid = result.get("JobId")
    if jid:
        print(f"JobId: {jid}")
        add_job(jid, {"type": action, "params": params})
        print(f"跟踪: python hunyuan3d.py wait {jid}")
        # 也存下 request id
        print(f"RequestId: {result.get('RequestId','?')}")
    else:
        # 直接返回结果的(如 Convert3DFormat)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        # 尝试下载
        url = result.get("ResultFile3D")
        if url:
            try:
                import requests
                ext = params.get("Format", "file").lower()
                fp = OUTPUT_DIR / f"converted.{ext}"
                content = requests.get(url, timeout=120).content
                fp.write_bytes(content)
                print(f"  -> {fp.name}  {len(content):,} bytes")
            except Exception as e:
                print(f"  下载失败: {e}")


def cmd_list():
    jobs = load_jobs()
    if not jobs:
        print("暂无任务")
        return
    print(f"{'Job ID':<22} {'类型':<34} {'状态':<10} {'时间'}")
    print("-"*100)
    for jid, m in sorted(jobs.items(), key=lambda x: x[1].get("created_at",""), reverse=True):
        print(f"{jid:<22} {m.get('type','?'):<34} {m.get('status','?'):<10} {m.get('created_at','')[:19]}")
    print(f"\n共 {len(jobs)} 个 | 文件: {JOBS_FILE}")


def cmd_status():
    jobs = load_jobs()
    if len(sys.argv) > 2:
        jid = sys.argv[2]
        meta = jobs.get(jid, {})
        action = meta.get("type", "SubmitHunyuanTo3DProJob")
        r = query_job(action, jid)
        print(json.dumps(r, indent=2, ensure_ascii=False))
    else:
        cmd_list()


def cmd_wait():
    jobs = load_jobs()
    to_glb = "--glb" in sys.argv
    optimize = "--opt" in sys.argv
    jids = [a for a in sys.argv[2:] if not a.startswith("-")]
    if jids:
        jid = jids[0]
        meta = jobs.get(jid, {})
        action = meta.get("type", "SubmitHunyuanTo3DProJob")
        wait_job(action, jid, to_glb=to_glb, optimize=optimize)
    elif "--all" in sys.argv:
        pending = [(jid, m) for jid, m in jobs.items()
                   if m["status"] in ("queued", "RUN", "")]
        if not pending:
            print("没有待完成的任务")
            return
        for jid, m in pending:
            action = m.get("type", "SubmitHunyuanTo3DProJob")
            print(f"\n--- {jid} ---")
            wait_job(action, jid, to_glb=to_glb, optimize=optimize)
    else:
        print("用法: python hunyuan3d.py wait <job_id> [--glb] [--opt]  或  --all [--glb] [--opt]")


def cmd_download():
    to_glb = "--glb" in sys.argv
    optimize = "--opt" in sys.argv
    jids = [a for a in sys.argv[2:] if not a.startswith("-")]
    if not jids:
        print("用法: python hunyuan3d.py download <job_id> [--glb] [--opt]")
        return
    jid = jids[0]
    jobs = load_jobs()
    meta = jobs.get(jid, {})
    action = meta.get("type", "SubmitHunyuanTo3DProJob")
    r = query_job(action, jid)
    download_result(jid, r, to_glb=to_glb, optimize=optimize)


def cmd_pipeline():
    """FPS 角色管线: pro → rigging → motion → GLB"""
    args = sys.argv[2:]
    if not args:
        print("Three.js FPS 角色管线")
        print("用法: python hunyuan3d.py pipeline <角色描述>")
        print("示例: python hunyuan3d.py pipeline \"一个穿防弹衣的士兵\"")
        print()
        print("自动执行: pro(生成角色) → rigging(绑骨) → motion(走路+跑步+待机+死亡)")
        print("          → fbx2glb(转换) → GLB 可直接用 THREE.GLTFLoader")
        return

    character_prompt = " ".join(args)
    print(f"🎯 FPS 角色管线: {character_prompt}")
    print("=" * 60)

    # Step 1: 生成角色
    print("\n[1/4] 生成角色模型...")
    r = tccli("SubmitHunyuanTo3DProJob",
               Prompt=f"{character_prompt}, A-pose, T-pose, 全身站立, 正面",
               ResultFormat="FBX", Model="3.0")
    char_jid = r["JobId"]
    add_job(char_jid, {"type": "SubmitHunyuanTo3DProJob", "label": f"角色:{character_prompt}"})
    print(f"  JobId: {char_jid}")

    # Step 2: 绑骨
    print("\n[2/4] 等待角色完成 → 自动绑骨...")
    char_result = wait_job("SubmitHunyuanTo3DProJob", char_jid, max_wait=900)
    if not char_result:
        print("❌ 角色生成失败")
        return
    char_url = (char_result.get("ResultFile3Ds") or [{}])[0].get("Url", "")
    if not char_url:
        print("❌ 角色结果无URL")
        return

    rig_r = tccli("SubmitAutoRiggingJob", File3D=f'{{"Url":"{char_url}"}}')
    rig_jid = rig_r["JobId"]
    add_job(rig_jid, {"type": "SubmitAutoRiggingJob", "label": f"绑骨:{character_prompt}"})
    print(f"  JobId: {rig_jid}")

    # Step 3: 动画
    print("\n[3/4] 等待绑骨完成 → 生成动画...")
    rig_result = wait_job("SubmitAutoRiggingJob", rig_jid, max_wait=600)
    if not rig_result:
        print("❌ 绑骨失败")
        return
    rig_url = (rig_result.get("ResultFile3Ds") or [{}])[0].get("Url", "")

    animations = {
        "idle": "持枪待机循环动画",
        "walk": "慢走巡逻循环动画",
        "run": "快速奔跑动画",
        "death": "被击中倒地死亡动画",
    }
    motion_jids = {}
    for key, desc in animations.items():
        extra = f', RetargetFile={{"Url":"{rig_url}"}}' if rig_url else ""
        mr = tccli("SubmitHunyuanTo3DMotionJob",
                    Prompt=desc, Duration=4, EnableMesh=True)
        motion_jids[key] = mr["JobId"]
        add_job(mr["JobId"], {"type": "SubmitHunyuanTo3DMotionJob", "label": f"{key}:{desc}"})
        print(f"  [{key}] {mr['JobId']}")

    # Step 4: 等待动画 + 转 GLB
    print(f"\n[4/4] 等待 {len(motion_jids)} 个动画完成 → 转 GLB...")
    for key, mjid in motion_jids.items():
        print(f"\n  [{key}] 等待中...")
        r = wait_job("SubmitHunyuanTo3DMotionJob", mjid, max_wait=600, to_glb=True)
        if r:
            print(f"  [{key}] ✅")
        else:
            print(f"  [{key}] ❌")

    print(f"\n{'='*60}")
    print(f"✨ 管线完成! 文件在 {OUTPUT_DIR}/")
    print("Three.js 加载:")
    print("  const gltf = await loader.loadAsync('output/<id>.glb');")
    print("  const mixer = new THREE.AnimationMixer(gltf.scene);")
    print("  mixer.clipAction(gltf.animations[0]).play();")


def cmd_convert():
    """格式转换 快捷命令"""
    if len(sys.argv) < 4:
        print("用法: python hunyuan3d.py convert <url_or_file> <格式>")
        print("示例: python hunyuan3d.py convert model.glb STL")
        return
    src = sys.argv[2]
    fmt = sys.argv[3].upper()

    # 本地文件 → 先提示需要 URL
    if not src.startswith("http"):
        print(f"注意: 格式转换需要 URL, 本地文件请先上传")

    result = tccli("Convert3DFormat", File3D=src, Format=fmt)
    url = result.get("ResultFile3D")
    if url:
        print(f"结果: {url}")
        try:
            import requests
            ext = fmt.lower()
            fp = OUTPUT_DIR / f"converted_{Path(src).stem}.{ext}"
            content = requests.get(url, timeout=120).content
            fp.write_bytes(content)
            print(f"  -> {fp.name}  {len(content):,} bytes")
        except Exception as e:
            print(f"  下载失败: {e}")
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))


# ============================================================
# main
# ============================================================
CMDS = {
    "submit":   cmd_submit,
    "list":     cmd_list,
    "status":   cmd_status,
    "wait":     cmd_wait,
    "download": cmd_download,
    "convert":  cmd_convert,
    "pipeline": cmd_pipeline,
}

HELP = """
混元生3D 轻量工具 — tccli 便利封装

用法:
  python hunyuan3d.py submit <Action> --Key Val ...
    调用任意 ai3d API, 自动提取 JobId 并跟踪
    示例:
      python hunyuan3d.py submit SubmitHunyuanTo3DProJob --Prompt "小狗" --ResultFormat GLB --Model 3.0
      python hunyuan3d.py submit SubmitHunyuanTo3DRapidJob --Prompt "快猫" --ResultFormat GLB
      python hunyuan3d.py submit SubmitTextureTo3DJob --File3D '{"Url":"https://..."}' --Prompt "金属纹理"
      python hunyuan3d.py submit Convert3DFormat --File3D "https://..." --Format STL

  python hunyuan3d.py list
    列出所有跟踪的任务 (jobs.json)

  python hunyuan3d.py status [job_id]
    查看任务状态 (单次查询, 不轮询)

  python hunyuan3d.py wait <job_id>
  python hunyuan3d.py wait --all
    轮询等待任务完成, 自动下载

  python hunyuan3d.py download <job_id>
    下载已完成任务的结果

  python hunyuan3d.py convert <url_or_file> <格式>
    格式转换快捷命令

  python hunyuan3d.py pipeline "角色描述"
    Three.js FPS 一键管线: pro(角色) → rigging(绑骨) → motion(4动画) → GLB

  所有 wait/download 支持 opt-in 标记:
    --glb   FBX→GLB 自动转换 (Three.js)
    --opt   gltf-transform draco+webp 压缩 (网页优化, 通常 -90%+)
    python hunyuan3d.py wait <job_id> --glb --opt

  环境变量:
    HY3D_OUTPUT_DIR  输出目录 (默认 ./output), 也可用 -o <dir>
    示例: python hunyuan3d.py submit ... -o ./assets/models

  python hunyuan3d.py help
    显示此帮助

权威文档: https://cloud.tencent.com/document/api/1804
所有 API 参数以官方文档为准, 本地文档可能过时。
"""

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("help", "-h", "--help"):
        print(HELP)
        return

    cmd = sys.argv[1]
    if cmd not in CMDS:
        print(f"未知命令: {cmd}\n{HELP}")
        return

    try:
        CMDS[cmd]()
    except RuntimeError as e:
        print(f"错误: {e}")
        print("遇到 API 参数问题? 查权威文档: https://cloud.tencent.com/document/api/1804")
        sys.exit(1)
    except Exception as e:
        print(f"错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
