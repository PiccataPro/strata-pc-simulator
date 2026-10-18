# -*- coding: utf-8 -*-
"""第二批写实贴图加工 → src/texdata3.js（自动生成，勿手改）

来源（铭铭 2026-10-18 验收）：
  - 内存马甲：Kingston FURY Beast DDR5 官方 datasheet 正侧视图（黑）+ pc53 图编改色（白）
  - 塔顶盖 / 水冷泵顶 / 电源铭牌 / 电源格栅 / 机箱遮罩：pc53 Qwen-Image 正交生成图
处理：裁切（去金手指/边距）→ 旋转对齐 UV → 白底边缘泛洪转 alpha → 缩放 → 量化 PNG → base64
用法：python scripts/mktex3.py <product-refs 根目录>
"""
import sys, os, base64, io
from PIL import Image, ImageOps

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "texdata3.js"))

# (导出名, 源相对路径, 目标宽, 目标高, 透明, crop=(左,上,右,下)比例, 预处理)
# 内存马甲：官方图 1325×374，产品区 y14-354，金手指 y329-353。
#   crop 掉底部金手指带(下0.12)与四周边距，只留马甲区；CW 转 90° 让长边(金手指长度)沿 v 轴、
#   金手指落到 u=0（靠主板侧），匹配 3D 里马甲面 texPlane(27,125) 的 UV 约定。
JOBS = [
    ("RAM_ARMOR_BLACK_PNG", "ram-fury-beast/p1_x40_1325x374.png", 128, 576, True, (0.012, 0.04, 0.012, 0.125), "rotcw"),
    # 白色版：AI 改色两次失败（模型保留黑色）→ 改用黑色源图亮度反转（黑马甲→白、银logo→深灰，
    # 正是白色版配色），确定性零成本。金手指带已被 crop 掉，反转不涉及。
    ("RAM_ARMOR_WHITE_PNG", "ram-fury-beast/p1_x40_1325x374.png", 128, 576, True, (0.012, 0.04, 0.012, 0.125), "rotcw+invert"),
    ("COOLER_TOP_PNG",      "cooler-d15/tex_cooler_top.png",      512, 512, True, None, None),
    ("AIO_PUMP_PNG",        "aio360/tex_aio_pump.png",            512, 512, True, None, None),
    ("PSU_LABEL_PNG",       "psu-ax1200i/tex_psu_label.png",      768, 384, True, None, None),
    # PSU_GRILLE 暂不入库：电源顶面在仓罩内不可见（真机风扇朝下），贴了也看不到，省 ~98KB。
    # 源图已生成留存 product-refs/psu-ax1200i/tex_psu_grille.png，将来若做「电源外露」场景再启用。
    ("CASE_SHROUD_PNG",     "case-front/tex_case_shroud.png",     768, 384, True, None, None),
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
    "/* 第二批写实贴图（本文件由 scripts/mktex3.py 自动生成，勿手改）",
    " * 来源：内存=Kingston 官方 datasheet 图（黑）+ pc53 图编改色（白）；其余=pc53 Qwen-Image 正交生成（铭铭验收）。",
    " * 重新生成：python scripts/mktex3.py <product-refs 根目录>",
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
    if pre and "invert" in pre:
        # 亮度反转（黑马甲→白、银logo→深灰），保留 alpha 通道
        rgb = im.convert("RGB")
        inv = ImageOps.invert(rgb)
        if im.mode == "RGBA":
            inv = inv.convert("RGBA"); inv.putalpha(im.split()[-1])
        im = inv
    if pre and "rotcw" in pre:
        im = im.rotate(-90, expand=True)   # CW 90°：金手指带→左缘(u=0)，长边沿 v 轴
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
