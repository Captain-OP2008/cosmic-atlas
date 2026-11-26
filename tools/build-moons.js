#!/usr/bin/env node
/**
 * COSMOS ATLAS — P1 卫星 / 银河贴图打包脚本（零依赖，只用 node 内置模块）
 *
 * 输入：assets/textures/<key>.jpg （由 tools/build_moons.py 预处理生成）
 * 输出：js/tex-moons.js —— 经典 IIFE，把 13 张 JPEG 以 data URL 追加到 COSMOS.TEX
 *
 * 用法：node tools/build-moons.js
 * 复现：python tools/build_moons.py && node tools/build-moons.js
 *
 * 契约（artifacts/p1-contract.md §5）：
 *   - 必须在 js/tex-solar.js 之后加载；只追加，不覆盖 COSMOS.TEX / COSMOS.TEX_SOURCES
 *   - 每张图 JPEG q82–88，卫星 1024 宽、银河 2048 宽
 *   - 新增总量 ≤ 6 MB（脚本末尾自检，超限直接退出 1）
 *   - file:// 下零网络请求：全部内联为 data URL
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEX_DIR = path.join(ROOT, 'assets', 'textures');
const OUT_FILE = path.join(ROOT, 'js', 'tex-moons.js');
const MAX_TOTAL = 6 * 1024 * 1024; // 6 MB 上限（base64 后的字符数）

/* 键名 / 文件名 / 署名 / 许可 / 下载与处理说明。
 * 键名是场景侧读写约定，不要改名。 */
const BODIES = [
  {
    key: 'io', file: 'io.jpg', w: 1024, h: 512,
    credit: 'NASA Galileo / Voyager 影像，USGS Astrogeology 全球 mosaic（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/io.jpg',
    derived: 'https://astrogeology.usgs.gov/search/map/io_voyager_galileo_ssi_false_color_global_mosaic_1km',
    license: 'PD'
  },
  {
    key: 'europa', file: 'europa.jpg', w: 1024, h: 512,
    credit: 'NASA Voyager / Galileo 影像，USGS Astrogeology 全球 mosaic（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/europa.jpg',
    derived: 'https://astrogeology.usgs.gov/search/map/planetary-globes',
    license: 'PD'
  },
  {
    key: 'ganymede', file: 'ganymede.jpg', w: 1024, h: 512,
    credit: 'Björn Jónsson 由 NASA Voyager / Galileo PDS 数据制作，作者声明可免费使用并要求署名',
    src: 'https://bjj.mmedia.is/data/ganymede/ganymede.jpg',
    derived: '',
    license: 'CC BY（作者声明，署名即可用）'
  },
  {
    key: 'callisto', file: 'callisto.jpg', w: 1024, h: 512,
    credit: 'Björn Jónsson 由 NASA Voyager / Galileo PDS 数据（78 张影像）制作，作者声明可免费使用并要求署名',
    src: 'https://bjj.mmedia.is/data/callisto/callisto.jpg',
    derived: 'https://bjj.mmedia.is/data/callisto/index.html',
    license: 'CC BY（作者声明，署名即可用）'
  },
  {
    key: 'titan', file: 'titan.jpg', w: 1024, h: 512,
    credit: 'NASA / JPL-Caltech / University of Arizona，Cassini 表面 mosaic（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/titan.jpg',
    derived: 'https://photojournal.jpl.nasa.gov/',
    license: 'PD'
  },
  {
    key: 'enceladus', file: 'enceladus.jpg', w: 1024, h: 512,
    credit: 'NASA / JPL-Caltech / Space Science Institute / LPI，Cassini 彩色地图（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/enceladus.jpg',
    derived: '',
    license: 'PD'
  },
  {
    key: 'rhea', file: 'rhea.jpg', w: 1024, h: 512,
    credit: 'NASA / JPL-Caltech / Space Science Institute / LPI，Cassini 彩色地图（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/rhea.jpg',
    derived: '',
    license: 'PD'
  },
  {
    key: 'phobos', file: 'phobos.jpg', w: 1024, h: 512,
    credit: 'NASA Viking 影像，Phil Stooke 的 PDS mosaic（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/phobos.jpg',
    derived: '',
    license: 'PD'
  },
  {
    key: 'deimos', file: 'deimos.jpg', w: 1024, h: 512,
    credit: 'Stooke, P., Stooke Small Bodies Maps V3.0, NASA Planetary Data System, 2015（CC0-1.0）',
    src: 'https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/master/textures/hires/deimos.jpg',
    derived: 'https://data.nasa.gov/',
    license: 'CC0 1.0'
  },
  {
    key: 'triton', file: 'triton.jpg', w: 1024, h: 512,
    credit: 'NASA Voyager 2 影像，Lunar and Planetary Institute 全球 mosaic（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/triton.jpg',
    derived: '',
    license: 'PD'
  },
  {
    key: 'charon', file: 'charon.jpg', w: 1024, h: 512,
    credit: 'NASA / JHUAPL / SwRI，New Horizons 圆柱投影地图（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/charon.jpg',
    derived: '',
    license: 'PD'
  },
  {
    key: 'pluto', file: 'pluto.jpg', w: 1024, h: 512,
    credit: 'NASA / JHUAPL / SwRI，New Horizons 全球彩色 mosaic（公有领域）',
    src: 'https://raw.githubusercontent.com/auraofintelligence/virtual-solar-swarm/main/assets/maps/pluto.jpg',
    derived: '',
    license: 'PD'
  },
  {
    key: 'stars_milky_way', file: 'stars_milky_way.jpg', w: 2048, h: 1024,
    credit: 'Solar System Scope，银河背景（CC BY 4.0）',
    src: 'https://www.solarsystemscope.com/textures/download/2k_stars_milky_way.jpg',
    derived: 'https://www.solarsystemscope.com/textures/',
    license: 'CC BY 4.0'
  }
];

function readTex(b) {
  const p = path.join(TEX_DIR, b.file);
  if (!fs.existsSync(p)) {
    throw new Error('缺少贴图文件：' + path.relative(ROOT, p) +
      '\n请先运行：python tools/build_moons.py');
  }
  const buf = fs.readFileSync(p);
  if (buf.length < 20000) throw new Error(b.file + ' 过小（' + buf.length + ' B），疑似下载失败');
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(b.file + ' 不是 JPEG（文件头错误）');
  return buf;
}

function main() {
  const lines = [];
  const sources = [];
  let totalB64 = 0;
  const rows = [];

  for (const b of BODIES) {
    const buf = readTex(b);
    const b64 = buf.toString('base64');
    totalB64 += b64.length;
    rows.push([b.key, buf.length, b64.length, b.w + 'x' + b.h, b.license]);
    lines.push('  COSMOS.TEX[\'' + b.key + '\'] = "data:image/jpeg;base64,' + b64 + '";');
    sources.push('    { key: "' + b.key + '", file: "' + b.file + '" }');
  }

  if (totalB64 > MAX_TOTAL) {
    console.error('✗ data URL 总量 ' + (totalB64 / 1048576).toFixed(2) +
      ' MB 超过 6 MB 上限，请降低分辨率或质量后重跑 tools/build_moons.py');
    process.exit(1);
  }

  const header = [
    '/* ============================================================',
    ' * COSMOS ATLAS — 卫星与银河背景真实贴图（data URL 内联，file:// 下零请求）',
    ' * 由 tools/build-moons.js 从 assets/textures/*.jpg 生成，请勿手改。',
    ' * 前置：python tools/build_moons.py（Pillow 缩放 / 极区补边 / JPEG q86）',
    ' * 必须在 js/tex-solar.js 之后加载：只追加 COSMOS.TEX，不覆盖。',
    ' * 许可：公有领域为主，另含 CC BY 4.0（银河 / Ganymede / Callisto）；',
    ' *       逐项来源与署名见本文件末尾 CREDITS 与 artifacts/textures/sources.md。',
    ' * ============================================================ */',
    '(function (COSMOS) {',
    "  'use strict';",
    '  COSMOS.TEX = COSMOS.TEX || {};',
    ''
  ].join('\n');

  const credits = BODIES.map(function (b) {
    return '    { key: "' + b.key + '", credit: "' + b.credit +
      '", license: "' + b.license + '", src: "' + b.src + '" }';
  }).join(',\n');

  const footer = [
    '',
    '  /* 贴图来源清单，供页脚影像来源模块读取（追加，不覆盖 tex-solar.js 的清单） */',
    '  COSMOS.TEX_SOURCES = (COSMOS.TEX_SOURCES || []).concat([',
    sources.join(',\n'),
    '  ]);',
    '',
    '  /* 逐张署名与许可（P1 契约 §5：本地打包 + 署名登记） */',
    '  COSMOS.TEX_CREDITS = (COSMOS.TEX_CREDITS || []).concat([',
    credits,
    '  ]);',
    '})(window.COSMOS = window.COSMOS || {});',
    ''
  ].join('\n');

  fs.writeFileSync(OUT_FILE, header + lines.join('\n') + footer, 'utf8');

  const outSize = fs.statSync(OUT_FILE).size;
  console.log('生成 ' + path.relative(ROOT, OUT_FILE));
  console.log('key                 jpg B     base64 B   尺寸      许可');
  for (const r of rows) {
    console.log(
      r[0].padEnd(18) + String(r[1]).padStart(8) + '  ' +
      String(r[2]).padStart(9) + '   ' + r[3].padEnd(10) + r[4]
    );
  }
  console.log('-'.repeat(72));
  console.log('base64 合计 ' + totalB64 + ' B (' + (totalB64 / 1048576).toFixed(2) +
    ' MB) / 上限 6.00 MB');
  console.log('js/tex-moons.js ' + outSize + ' B (' + (outSize / 1048576).toFixed(2) + ' MB)');
}

main();
