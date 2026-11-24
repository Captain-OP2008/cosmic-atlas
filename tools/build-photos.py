# -*- coding: utf-8 -*-
r"""把 Playwright 抓下来的 NASA 图片 dataURL JSON 解码成 assets/photos/*.jpg。

输入：<playwright-work>\assets\photos\b*.json，值为 { "NASA_ID": "data:image/jpeg;base64,..." }
输出：assets/photos/<语义名>.jpg（1280px 宽，JPEG q80，已是重采样后的结果）

注意：08 章载具档案的 veh-*.jpg 不经过本脚本 —— 它们是原图下载 + 裁切旋转，
由一次性脚本 artifacts/_tmp/veh/prep.py 统一缩放（1280px 宽、q80）后写入；
来源 ID 与许可记录见 README「数据与影像来源」。
"""


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, str):
        data = json.loads(data)
    return data
import base64
import json
import os
import sys
from glob import glob

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(
    os.path.expanduser("~"),
    "Documents", "deepseek-harness", "default-workspace", "artifacts",
    "playwright-work", "assets", "photos",
)
OUT = os.path.join(HERE, "assets", "photos")

MAP = {
    # Part IV · 星系动物园
    "GSFC_20171208_Archive_e001925": "galaxy-whirlpool",
    "GSFC_20171208_Archive_e000839": "galaxy-andromeda",
    "PIA15426": "galaxy-sombrero",
    "PIA13316": "galaxy-antennae",
    "GSFC_20171208_Archive_e002154": "galaxy-barred",
    "GSFC_20171208_Archive_e001642": "galaxy-lmc",
    "GSFC_20171208_Archive_e001651": "galaxy-deepfield",
    "PIA03296": "galaxy-cartwheel",
    # Part IV · 恒星与星云
    "GSFC_20171208_Archive_e000842": "nebula-pillars",
    "PIA25434": "nebula-orion",
    "PIA03606": "nebula-crab",
    "southern_ring_nebula": "nebula-ring",
    "carina_nebula": "nebula-carina",
    "PIA16680": "star-betelgeuse",
    "PIA21958": "star-flare",
    # Part III · 致密天体
    "PIA23122": "bh-m87-jet",
    "PIA26702": "deep-darkmatter",
    "PIA14094": "deep-darkenergy",
    "PIA17995": "deep-gravwave",
    "PIA15831": "deep-quasar",
    "PIA22085": "bh-concept",
    "PIA23863": "neutronstar-concept",
    # Part II · 探测史
    "PIA14111": "probe-voyager",
    "KSC-20180419-PH_KLS01_0054": "probe-parker",
    "PIA22766": "probe-cassini",
    "PIA09234": "probe-newhorizons",
    "PIA24542": "rover-perseverance",
    # Part V · 人类探索
    "200623_ISS_1": "human-iss",
    "GSFC_20171208_Archive_e000357": "human-jwst",
    "GSFC_20171208_Archive_e002151": "human-hubble",
    "KSC-20180206-PH_FWM02_0190": "rocket-falconheavy",
    "11 03 24 artemis 3 on surface": "rocket-starship",
    "PIA23302": "future-mars",
    "PIA22082": "future-exoplanet",
    "as17-152-23272": "human-earthrise",
    "as08-14-2383": "human-earthrise-1968",
    "as11-40-5903": "human-apollo11",
    "as17-148-22727": "human-blue-marble",
    "PIA23645": "human-palebluedot",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    found = {}
    for path in sorted(glob(os.path.join(SRC, "b*.json"))):
        data = load_json(path)
        found.update(data)
    print("json keys:", len(found))
    missing = [k for k in MAP if k not in found]
    if missing:
        print("MISSING:", missing)
    total = 0
    for nasa_id, name in MAP.items():
        url = found.get(nasa_id)
        if not url:
            continue
        b64 = url.split(",", 1)[1]
        raw = base64.b64decode(b64)
        dst = os.path.join(OUT, name + ".jpg")
        with open(dst, "wb") as f:
            f.write(raw)
        total += len(raw)
        print("%-22s %6.0f KB" % (name + ".jpg", len(raw) / 1024.0))
    print("total %.2f MB, files %d" % (total / 1048576.0, len(MAP) - len(missing)))


if __name__ == "__main__":
    sys.exit(main())
