# -*- coding: utf-8 -*-
"""把 Playwright 浏览器抓下来的纹理批次 JSON 合并成 js/tex-solar.js。

原始纹理来源：Solar System Scope Textures（CC BY 4.0），
经浏览器按目标分辨率重采样后以 data URL 形式内联，保证 file:// 下零请求。
本脚本再做一次离线降采样（Lanczos），把显存与文件体积压到可接受范围。
"""
import base64
import io
import json
import os
import sys

from PIL import Image

SRC_DIR = r"C:\Users\Joey Bian\Documents\deepseek-harness\default-workspace\artifacts\playwright-work\assets\tex"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "js", "tex-solar.js")

# 目标宽度：显存里 RGBA + mipmap 约为 宽×高×4×1.34 字节。
# 2048×1024 ≈ 11 MB/张；13 张合计约 145 MB，桌面无压力，移动端靠降低 dpr 兜底。
MAXW = {
    "earth_day": 4096,
    "jupiter": 4096,
    "mars": 4096,
    "saturn": 4096,
    "sun": 3072,
    "moon": 3072,
    "earth_clouds": 3072,
    "mercury": 2048,
    "venus": 2048,
    "earth_night": 2048,
    "saturn_ring": 2048,
    "uranus": 2048,
    "neptune": 2048,
}
QUALITY = 88

ORDER = [
    "sun", "mercury", "venus", "earth_day", "earth_night", "earth_clouds",
    "moon", "mars", "jupiter", "saturn", "saturn_ring", "uranus", "neptune",
]

SOURCES = {
    "sun": "8k_sun.jpg",
    "mercury": "8k_mercury.jpg",
    "venus": "8k_venus_surface.jpg",
    "earth_day": "8k_earth_daymap.jpg",
    "earth_night": "8k_earth_nightmap.jpg",
    "earth_clouds": "8k_earth_clouds.jpg",
    "moon": "8k_moon.jpg",
    "mars": "8k_mars.jpg",
    "jupiter": "8k_jupiter.jpg",
    "saturn": "8k_saturn.jpg",
    "saturn_ring": "8k_saturn_ring_alpha.png",
    "uranus": "2k_uranus.jpg",
    "neptune": "2k_neptune.jpg",
}


def shrink(data_url, key):
    head, b64 = data_url.split(",", 1)
    raw = base64.b64decode(b64)
    im = Image.open(io.BytesIO(raw))
    im.load()
    maxw = MAXW.get(key, 2048)
    if im.width > maxw:
        h = max(1, round(im.height * maxw / im.width))
        im = im.resize((maxw, h), Image.LANCZOS)
    buf = io.BytesIO()
    if key == "saturn_ring":
        im.save(buf, format="PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    if im.mode != "RGB":
        im = im.convert("RGB")
    im.save(buf, format="JPEG", quality=QUALITY, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def main():
    data = {}
    for i in range(1, 6):
        path = os.path.join(SRC_DIR, "tex-%02d.json" % i)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        for k, v in payload.get("data", {}).items():
            data[k] = v

    missing = [k for k in ORDER if k not in data]
    if missing:
        print("MISSING:", missing)
        sys.exit(1)

    for k in ORDER:
        data[k] = shrink(data[k], k)
        print("  %-13s %8.1f KB" % (k, len(data[k]) / 1024.0))

    lines = []
    lines.append("/* ============================================================")
    lines.append(" * COSMOS ATLAS — 太阳系真实贴图（data URL 内联，file:// 下零请求）")
    lines.append(" * 来源：Solar System Scope Textures, https://www.solarsystemscope.com/textures/")
    lines.append(" * 许可：CC BY 4.0（署名见页面页脚「影像来源」）")
    lines.append(" * 本文件由 tools/build-tex.py 生成，请勿手改；改分辨率就重跑脚本。")
    lines.append(" * 目标分辨率：全部 2048 宽（土星环 2048 宽 PNG），JPEG q88")
    lines.append(" * ============================================================ */")
    lines.append("(function (COSMOS) {")
    lines.append("  'use strict';")
    lines.append("  COSMOS.TEX = {")
    for k in ORDER:
        lines.append('    %s: "%s",' % (k, data[k]))
    lines[-1] = lines[-1].rstrip(",")
    lines.append("  };")
    lines.append("")
    lines.append("  /* 贴图来源清单，供页脚影像来源模块读取 */")
    lines.append("  COSMOS.TEX_SOURCES = [")
    for k in ORDER:
        lines.append('    { key: "%s", file: "%s" },' % (k, SOURCES[k]))
    lines[-1] = lines[-1].rstrip(",")
    lines.append("  ];")
    lines.append("})(window.COSMOS = window.COSMOS || {});")
    lines.append("")

    out = "\n".join(lines)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)

    total = sum(len(data[k]) for k in ORDER)
    print("wrote", OUT)
    print("keys:", len(ORDER), "payload chars:", total, "file chars:", len(out))


if __name__ == "__main__":
    main()
