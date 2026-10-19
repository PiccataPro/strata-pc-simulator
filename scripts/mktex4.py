# -*- coding: utf-8 -*-
"""第三批写实贴图加工 → src/texdata4.js（自动生成，勿手改）

来源（铭铭 2026-10-19 验收）：全部 pc53 Qwen-Image 正交生成图
  - AMD CPU 顶盖：RYZEN 蚀刻 + 绿 PCB + 金电容 + 定位刻痕（1024x1024 白底）
  - A 卡导风罩：深灰双风扇 + 红色 R logo，挡板在左/金手指在下（1328x768，同 N 卡版构图）
  - A 卡背板：拉丝铝 + RADEON logo + 栅格（1024x512 横版，同 N 卡版构图）
  - 银色内存马甲：白色拉丝 + RGB 灯条 + 金手指（1328x384，同 Fury Beast 构图）
处理：裁切（去挡板/金手指/边距）→ 旋转对齐 UV → 白底边缘泛洪转 alpha → 缩放 → 量化 PNG → base64
用法：python scripts/mktex4.py <product-refs 根目录>
"""
import sys, os, base64, io
from PIL import Image, ImageOps

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "texdata4.js"))

# (导出名, 源相对路径, 目标宽, 目标高, 透明, crop=(左,上,右,下)比例, 预处理)
# 尺寸/UV 约定全部对齐 texdata2/3 同类件（3d.js 挂载面相同）：
# - CPU_IHS：正方形顶盖 trim 后直贴 512x448（与 Intel 版同面同约定）
# - GPU_SHROUD：源图横置（挡板在左 x≈120-126、卡体起 x≈150→左裁 0.115；
#   金手指 y587-601→下裁 0.24 切净），rotcw 后挡板侧→v=1→世界+Z 卡尾（同 N 卡版）
# - GPU_BACKPLATE：横版 rotcw（同 N 卡版：栅格边落侧透可见的卡顶边缘）
# - RAM 银条：金手指占条体 0.849-0.916（实测），整图下裁 0.344 连 PCB 底边一起切净，
#   rotcw 让长边沿 v、马甲顶部落 u 侧（同黑/白 Fury Beast 约定）
JOBS = [
    ("CPU_IHS_AMD_PNG",       "cpu-amd-ihs/tex_cpu_ihs_amd.png",       512,  448, True, None, None),
    ("GPU_SHROUD_AMD_PNG",    "gpu-amd-shroud/tex_gpu_shroud_amd.png", 768,  432, True, (0.115, 0.02, 0.0, 0.24), "rotcw"),
    ("GPU_BACKPLATE_AMD_PNG", "gpu-amd-backplate/tex_gpu_backplate_amd.png", 384, 1024, True, None, "rotcw"),
    ("RAM_ARMOR_SILVER_PNG",  "ram-silver/tex_ram_silver.png",         128,  576, True, (0.012, 0.02, 0.012, 0.344), "rotcw"),
]

def trim_white(im, tol=236):
    g = ImageOps.grayscale(im.convert("RGB"))
    bbox = g.point(lambda v: 255 if v < tol else 0).getbbox()
    return im.crop(bbox) if bbox else im

def crop_frac(im, f):
    if not f: return im
    w, h = im.size
    l, t, r, b = f
    return im.crop((int(w * l), int(h * t), int(w * (1 - r)), int(h * (1 - b))))

def white_to_alpha(im, tol=238):
    """白底→透明：从四边向内泛洪，只把与边缘连通的近白像素置透明，
       保住内容里的银白高光（全局阈值会把高光也挖穿）。"""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    def near_white(x, y):
        r, g, b, a = px[x, y]
        return r >= tol and g >= tol and b >= tol
    stack = []
    for x in range(w):
        stack += [(x, 0), (x, h - 1)]
    for y in range(h):
        stack += [(0, y), (w - 1, y)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h: continue
        i = y * w + x
        if seen[i]: continue
        seen[i] = 1
        if not near_white(x, y): continue
        px[x, y] = (px[x, y][0], px[x, y][1], px[x, y][2], 0)
        stack += [(x+1,y),(x-1,y),(x,y+1),(x,y-1)]
    return im

def encode(im, quality=82):
    buf = io.BytesIO()
    im.quantize(colors=256, method=Image.FASTOCTREE).save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

lines = [
    "/* 第三批写实贴图：AMD 阵营专属 + 银色马甲（本文件由 scripts/mktex4.py 自动生成，勿手改）",
    " * 来源：pc53 Qwen-Image 正交生成（铭铭验收）。",
    " * 重新生成：python scripts/mktex4.py <product-refs 根目录>",
    " */",
]
total = 0
for name, fn, W, H, alpha, crop, pre in JOBS:
    path = os.path.join(SRC, fn)
    if not os.path.exists(path):
        print("SKIP missing", fn); continue
    im = Image.open(path).convert("RGBA" if alpha else "RGB")
    im = crop_frac(im, crop)
    im = trim_white(im)
    if pre and "rotcw" in pre:
        im = im.rotate(-90, expand=True)   # CW 90°：横版→竖版，长边沿 v 轴
    if pre and "rotccw" in pre:
        im = im.rotate(90, expand=True)    # CCW 90°
    if alpha:
        im = white_to_alpha(im).resize((W, H), Image.LANCZOS)
    else:
        im = im.resize((W, H), Image.LANCZOS)
    b64 = encode(im)
    total += len(b64)
    lines.append("export const %s = 'data:image/png;base64,%s';" % (name, b64))
    print("OK %s %dx%d -> %.1f KB base64" % (name, W, H, len(b64)/1024))
lines.append("")
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("WROTE", OUT, "total %.1f KB base64" % (total/1024))
