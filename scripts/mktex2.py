# -*- coding: utf-8 -*-
"""pc53 产品贴图加工 → src/texdata2.js（自动生成，勿手改）

输入：源目录里铭铭验收过的 pc53 生成图（按 JOBS 里的文件名）
处理：按 crop 比例裁掉多余部件 → 裁白边 → 缩放到目标尺寸 → 压缩 → base64
输出：src/texdata2.js 导出 4 个 data URL（GPU_SHROUD / MOBO_PCB / CPU_IHS / FAN_TOP）
体积策略：无透明走 JPEG(q82)，风扇面需透明走量化 PNG。
用法：python scripts/mktex2.py <源图目录>
"""
import sys, os, base64, io
from PIL import Image, ImageOps

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "src", "texdata2.js"))

# (导出名, 源文件, 目标宽, 目标高, 透明, crop=(左,上,右,下) 比例 0~1 或 None, 预处理)
# 透明件（轮廓不是满矩形）：显卡罩/CPU顶盖/风扇面 → 白底泛洪转 alpha，
# 贴在矩形面上只露出产品本体，不会带一块白背景。主板 PCB 铺满矩形，走 JPEG。
# GPU_SHROUD 的 rot=90：源图横置（挡板在左），CCW 转 90° 后长轴沿 v 轴，
# 正好匹配 3D 里「面片高度=卡长、像上=世界+Z=卡尾」的 UV 约定。
JOBS = [
    ("GPU_SHROUD_PNG", "gpu_shroud.png", 768, 432, True, (0.085, 0.02, 0.0, 0.17), "rotcw"),   # 去挡板+金手指，CW 转 90°：挡板侧→v=1→世界+Z 卡尾
    ("MOBO_PCB_PNG",   "mobo_pcb.png",   640, 800, False, None, None),
    ("CPU_IHS_PNG",    "cpu_ihs.png",    512, 448, True, None, None),
    ("FAN_HUB_PNG",    "fan_top.png",    256, 256, True, (0.32, 0.32, 0.32, 0.32), None),       # 只取中心轮毂贴纸，贴到旋转叶轮上（整张风扇图会和 3D 扇叶打架）
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

def fan_circle(im):
    """风扇面专用：白底转透明后，圆角方框与圆开口之间的缝隙也会漏白。
       把所有透明像素统一填成深黑（#0d1015）并把 alpha 拉满——
       贴在风扇上等于给缝隙补了个深色底，和机箱内暗环境一致，不再漏白。"""
    im = white_to_alpha(im)
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                px[x, y] = (13, 16, 21, 255)
    return im

def encode(im, transparent, quality=82):
    buf = io.BytesIO()
    if transparent:
        im.quantize(colors=256, method=Image.FASTOCTREE).save(buf, "PNG", optimize=True)
    else:
        im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

lines = [
    "/* pc53 产品贴图（本文件由 scripts/mktex2.py 自动生成，勿手改）",
    " * 来源：pc53 Qwen-Image 2.1 生成的写实产品图（铭铭验收）→ 裁边 → 缩放 → 压缩 → base64。",
    " * 重新生成：python scripts/mktex2.py <含 gpu_shroud/mobo_pcb/cpu_ihs/fan_top.png 的目录>",
    " */",
]
total = 0
for name, fn, W, H, alpha, crop, pre in JOBS:
    path = os.path.join(SRC, fn)
    if not os.path.exists(path):
        print("SKIP missing", fn); continue
    im = Image.open(path).convert("RGBA" if alpha else "RGB")
    im = crop_frac(im, crop)
    if pre == "fancircle":
        im = fan_circle(im).resize((W, H), Image.LANCZOS)
    else:
        if pre != "hub":            # 轮毂裁剪：源图已是满幅产品图，不裁白边（会把四角裁掉）
            im = trim_white(im)
        if pre == "rotcw":
            im = im.rotate(-90, expand=True)  # CW 90°：原图左端(挡板)转到上端 v=1
        if alpha:
            im = white_to_alpha(im).resize((W, H), Image.LANCZOS)
        else:
            im = im.resize((W, H), Image.LANCZOS)
    b64 = encode(im, alpha)
    total += len(b64)
    lines.append("export const %s = 'data:image/%s;base64,%s';" % (name, "png" if alpha else "jpeg", b64))
    print("OK %s %dx%d %s -> %.1f KB base64" % (name, W, H, "png" if alpha else "jpeg", len(b64)/1024))
lines.append("")
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("WROTE", OUT, "total %.1f KB base64" % (total/1024))
