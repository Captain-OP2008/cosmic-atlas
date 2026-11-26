#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""COSMOS ATLAS — P1 卫星/背景贴图预处理（Pillow + numpy）

把 assets/textures/raw/ 下的原始下载图处理成 2:1 等距圆柱 JPEG，
输出到 assets/textures/<key>.jpg，供 tools/build-moons.js 打包成
js/tex-moons.js。

处理规则（每个 key 一条）：
  - 统一缩放 / 裁切到 1024x512（银河 2048x1024）
  - 上下黑边（极区未覆盖）用垂直方向最近的实像素填充
  - Deimos 原图极暗，做百分位线性拉伸
  - 以 quality=86 重编码（银河 q80）

运行（Windows / Git Bash）：
  python tools/build_moons.py
依赖：Pillow、numpy（项目 bundled Python 已带）。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "assets", "textures", "raw")
OUT = os.path.join(ROOT, "assets", "textures")

# key -> (raw 文件名, 目标宽, 目标高, quality, 是否修黑边, 是否做亮度拉伸)
JOBS = [
    ("io",             "vss_io.jpg",            1024, 512, 86, True,  False),
    ("europa",         "vss_europa.jpg",        1024, 512, 86, True,  False),
    ("ganymede",       "bjj_ganymede.jpg",      1024, 512, 86, True,  False),
    ("callisto",       "bjj_callisto.jpg",      1024, 512, 86, True,  False),
    ("titan",          "vss_titan.jpg",         1024, 512, 86, True,  False),
    ("enceladus",      "vss_enceladus.jpg",     1024, 512, 86, True,  False),
    ("rhea",           "vss_rhea.jpg",          1024, 512, 86, True,  False),
    ("phobos",         "vss_phobos.jpg",        1024, 512, 86, True,  False),
    ("deimos",         "cel_deimos.jpg",        1024, 512, 86, True,  True),
    ("triton",         "vss_triton.jpg",        1024, 512, 86, True,  False),
    ("charon",         "vss_charon.jpg",        1024, 512, 86, True,  False),
    ("pluto",          "vss_pluto.jpg",         1024, 512, 86, True,  False),
    ("stars_milky_way", "2k_stars_milky_way.jpg", 2048, 1024, 80, False, False),
]

BLACK = 26  # 三通道和 <= BLACK 视为"未覆盖"像素


def fit(im, w, h):
    """等比缩放再居中裁切到 w x h（源图基本已是 2:1，只是保险）。"""
    sw, sh = im.size
    sc = max(w / sw, h / sh)
    im = im.resize((max(w, int(round(sw * sc))), max(h, int(round(sh * sc)))),
                   Image.LANCZOS)
    sw, sh = im.size
    return im.crop(((sw - w) // 2, (sh - h) // 2, (sw - w) // 2 + w, (sh - h) // 2 + h))


def stretch(img):
    """百分位线性拉伸到 0..255（用于 Deimos 这类极暗原图）。"""
    a = np.asarray(img).astype(np.float32)
    lo, hi = np.percentile(a, 2), np.percentile(a, 99.5)
    if hi - lo < 1:
        return img
    a = (a - lo) * (255.0 / (hi - lo))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def fill_poles(im):
    """填充上下未覆盖的黑边（极区缺失）。

    逐列取最近的实像素只能得到每列一个色，直接铺开会出现密集竖条纹；
    这里改为：取最靠近极区的有效行平均色，作为该极区的统一底色，
    再叠加一条很轻的垂直渐变。水平方向完全均匀，渲染到球面上像极冠。
    """
    a = np.asarray(im).astype(np.uint8).copy()
    h, w, _ = a.shape
    valid = a.astype(np.int32).sum(axis=2) > BLACK
    if not valid.any():
        return im
    first = np.argmax(valid, axis=0)
    last = h - 1 - np.argmax(valid[::-1], axis=0)
    ytop = int(first.min())
    ybot = int(last.max())

    def band_color(y0, y1):
        seg = a[y0:y1].reshape(-1, 3)
        m = seg.astype(np.int32).sum(axis=1) > BLACK
        return seg[m].mean(axis=0) if m.any() else np.array([24, 24, 26], np.float32)

    top_col = band_color(ytop, min(h, ytop + 10)).astype(np.float32)
    bot_col = band_color(max(0, ybot - 9), ybot + 1).astype(np.float32)
    out = a.copy()
    for x in range(w):
        f = int(first[x])
        l = int(last[x])
        if f > ytop:
            g = np.linspace(0.80, 1.0, f, dtype=np.float32)[:, None]
            out[:f, x] = np.clip(top_col[None, :] * g, 0, 255).astype(np.uint8)
        if l < ybot:
            n = ybot - l
            g = np.linspace(1.0, 0.82, n, dtype=np.float32)[:, None]
            out[l + 1:ybot + 1, x] = np.clip(bot_col[None, :] * g, 0, 255).astype(np.uint8)
    # ytop/ybot 之外没有有效像素的行也补齐
    if ytop > 0:
        out[:ytop] = np.clip(top_col * 0.85, 0, 255).astype(np.uint8)
    if ybot < h - 1:
        out[ybot + 1:] = np.clip(bot_col * 0.85, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def main():
    if not os.path.isdir(RAW):
        sys.exit("missing raw dir: " + RAW)
    total = 0
    for key, src, w, h, q, fix, stretch_it in JOBS:
        path = os.path.join(RAW, src)
        if not os.path.isfile(path):
            print("SKIP %-16s (missing %s)" % (key, src))
            continue
        im = Image.open(path)
        im = im.convert("RGB") if im.mode != "RGB" else im.copy()
        if stretch_it:
            im = stretch(im)
        im = fit(im, w, h)
        if fix:
            im = fill_poles(im)
        dst = os.path.join(OUT, key + ".jpg")
        im.save(dst, "JPEG", quality=q, optimize=True, progressive=True)
        size = os.path.getsize(dst)
        total += size
        print("%-16s %5dx%-5d %7d B  <- %s" % (key, w, h, size, src))
    print("TOTAL %d B (%.2f MB)" % (total, total / 1048576.0))


if __name__ == "__main__":
    main()
