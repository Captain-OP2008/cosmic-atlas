/* ============================================================
 * COSMOS ATLAS · 05 致密天体 / 06 恒星的一生
 * ------------------------------------------------------------
 * 本文件包含两部分：
 *   1) 文案（COSMOS.addContent）—— 每章 3 段正文 + 4 条数据 + 引文
 *   2) 物理模型（COSMOS.deepModel）—— 供 scene-*.js 与 feat-deep.js 共用，
 *      保证“画面 / 滑杆 / 读数 / 赫罗图”用的是同一套公式
 *
 * 数据口径（全站统一，改数字先改这里）：
 *   - 史瓦西半径 rs = 2GM/c²：每 1 倍太阳质量约 2.95 km
 *   - 太阳有效温度 5772 K、光度 3.828×10²⁶ W（IAU 2015 标称值）
 *   - 主序寿命 ≈ 100 亿年 × (M/M☉)^−2.5（常用近似，误差约 2 倍以内）
 *   - 质量—半径—温度：主序段用 R ∝ M^0.8 / M^0.57、T ∝ M^0.33 / M^0.5 的分段经验关系
 *   - 命运阈值（本站口径，与 05 章文案一致）：
 *       < 8 M☉  → 白矮星 + 行星状星云
 *       8–20 M☉ → 中子星 + 超新星遗迹
 *       > 20 M☉ → 黑洞
 *   - 白矮星：半径约地球、密度约 10⁹ kg/m³、钱德拉塞卡极限 1.44 M☉
 *   - 中子星：典型质量 1.4 M☉、半径约 12 km、密度约 10¹⁷ kg/m³
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const D = COSMOS.DATA || {};
  const U = COSMOS.util || {};
  const clamp = U.clamp || function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  const lerp = U.lerp || function (a, b, t) { return a + (b - a) * t; };
  const smoothstep = U.smoothstep || function (a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* ---------------- 物理常数（SI） ---------------- */
  const G = 6.6743e-11;
  const C = 2.99792458e8;
  const MSUN = 1.98847e30;
  const RSUN = 6.957e8;
  const REARTH = 6.371e6;
  const LSUN = 3.828e26;
  const TSUN = 5772;

  const FATES = {
    whitedwarf: { id: 'whitedwarf', label: '白矮星', en: 'white dwarf', photo: 'nebula-ring' },
    neutronstar: { id: 'neutronstar', label: '中子星', en: 'neutron star', photo: 'neutronstar-concept' },
    blackhole: { id: 'blackhole', label: '黑洞', en: 'black hole', photo: 'bh-concept' }
  };

  const STAGES = ['星云', '主序星', '红巨星', '超新星', '残骸'];

  /* ---------------- 格式化（不依赖 COSMOS.util.num） ---------------- */
  function groupDigits(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtNum(v, digits) {
    if (v == null || !isFinite(v)) return '—';
    const d = digits == null ? 2 : digits;
    const abs = Math.abs(v);
    let s;
    if (abs >= 1000) s = String(Math.round(v));
    else if (abs >= 100) s = v.toFixed(1);
    else s = v.toFixed(d);
    const parts = s.split('.');
    parts[0] = groupDigits(parts[0]);
    return parts.join('.');
  }

  /** 寿命（Gyr）→ {v, u}，单位随量级切换：万亿年 / 亿年 / 百万年 / 万年 */
  function fmtLifespan(gyr) {
    if (!isFinite(gyr) || gyr <= 0) return { v: '—', u: '' };
    if (gyr >= 1000) return { v: fmtNum(gyr / 1000, 1), u: '万亿年' };
    if (gyr >= 1) return { v: fmtNum(gyr * 10, 1), u: '亿年' };
    if (gyr >= 0.01) return { v: fmtNum(gyr * 1000, 2), u: '百万年' };
    return { v: fmtNum(gyr * 1e5, 1), u: '万年' };
  }

  /* ---------------- 黑洞（史瓦西解） ---------------- */
  function schwarzschildKm(massMsun) {
    return (2 * G * (massMsun * MSUN)) / (C * C) / 1000;
  }

  /** 质量 → 黑洞读数；吸积盘内缘取 ISCO = 3 rs（史瓦西黑洞） */
  function compactReadout(massMsun) {
    const rs = schwarzschildKm(massMsun);
    return {
      mass: massMsun,
      rsKm: rs,
      diameterKm: rs * 2,
      iscoKm: rs * 3
    };
  }

  /* ---------------- 恒星：质量 → 主序参数 ---------------- */
  function mainRadiusSun(mass) {
    return mass < 1 ? Math.pow(mass, 0.8) : Math.pow(mass, 0.57);
  }

  function mainTempK(mass) {
    return TSUN * (mass < 1 ? Math.pow(mass, 0.33) : Math.pow(mass, 0.5));
  }

  function lumFromRadiusTemp(radiusSun, tempK) {
    const t = tempK / TSUN;
    return radiusSun * radiusSun * t * t * t * t;
  }

  function mainLumSun(mass) {
    return lumFromRadiusTemp(mainRadiusSun(mass), mainTempK(mass));
  }

  function lifespanGyr(mass) {
    return 10 * Math.pow(mass, -2.5);
  }

  function fateOf(mass) {
    if (mass < 8) return 'whitedwarf';
    if (mass <= 20) return 'neutronstar';
    return 'blackhole';
  }

  /* ---------------- 颜色：温度 → sRGB / hex ---------------- */
  function tempRGB(kelvin) {
    const t = clamp(kelvin, 1000, 40000) / 100;
    let r;
    let g;
    let b;
    if (t <= 66) {
      r = 255;
      g = 99.4708025861 * Math.log(t) - 161.1195681661;
      b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = 255;
    }
    return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
  }

  function tempHex(kelvin) {
    const rgb = tempRGB(kelvin);
    let out = '#';
    for (let i = 0; i < 3; i++) out += Math.round(rgb[i] * 255).toString(16).padStart(2, '0');
    return out;
  }

  /* ---------------- 恒星：阶段关键帧 ----------------
   * 五个阶段（0–4）各给一组（半径 R☉、温度 K、光度 L☉）；
   * 阶段滑杆是连续值，阶段之间取对数插值，避免出现线性跳变。
   * 半径/温度是真实物理量；3D 画面用对数压缩后的“示意尺寸”，
   * 会在 widget 里注明“尺寸非等比”。
   */
  function phaseKeyframes(mass) {
    const fate = fateOf(mass);
    const r1 = mainRadiusSun(mass);
    const t1 = mainTempK(mass);
    const l1 = mainLumSun(mass);

    const gr = clamp(r1 * (mass < 8 ? 80 : 140), 20, 900);
    const gt = 3200 + Math.min(900, 160 * Math.log(Math.max(1, mass) + 1) / Math.LN2);
    const gl = lumFromRadiusTemp(gr, gt);

    let evR;
    let evT;
    let evL;
    if (fate === 'whitedwarf') {
      evR = 0.03;
      evT = 100000;
      evL = 3000;
    } else {
      evR = gr * 1.25;
      evT = 8000;
      evL = 1e6;
    }

    let enR;
    let enT;
    let enL;
    if (fate === 'whitedwarf') {
      enR = REARTH / RSUN;
      enT = 12000;
      enL = 0.002;
    } else if (fate === 'neutronstar') {
      enR = 12000 / RSUN;
      enT = 1e6;
      enL = 1e-6;
    } else {
      enR = (schwarzschildKm(mass) * 1000) / RSUN;
      enT = 0;
      enL = 1e-9;
    }

    return [
      { r: 0.9, t: 2800, l: 0.6 },
      { r: r1, t: t1, l: l1 },
      { r: gr, t: gt, l: gl },
      { r: evR, t: evT, l: evL },
      { r: enR, t: enT, l: enL }
    ];
  }

  /**
   * 恒星的当前状态。
   * @param {number} mass 质量（M☉，0.08–40）
   * @param {number} phase 阶段（0 星云 → 4 残骸，可连续）
   * @returns {object} 半径/温度/光度/颜色/闪光/壳层/残骸等
   */
  function stellarState(mass, phase) {
    mass = clamp(isFinite(mass) ? mass : 1, 0.08, 40);
    phase = clamp(isFinite(phase) ? phase : 1, 0, 4);

    const kf = phaseKeyframes(mass);
    const i = Math.min(3, Math.floor(phase));
    const f = smoothstep(0, 1, phase - i);
    const a = kf[i];
    const b = kf[i + 1];

    const radiusSun = Math.exp(lerp(Math.log(a.r), Math.log(b.r), f));
    const lumSun = Math.exp(lerp(Math.log(Math.max(a.l, 1e-12)), Math.log(Math.max(b.l, 1e-12)), f));
    let tempK;
    if (a.t > 0 && b.t > 0) tempK = Math.exp(lerp(Math.log(a.t), Math.log(b.t), f));
    else tempK = lerp(a.t, b.t, f);

    const fate = fateOf(mass);
    const fateInfo = FATES[fate];

    let flash;
    if (fate === 'whitedwarf') {
      // 类太阳恒星：外层缓慢抛离，亮度上升较柔和
      flash = Math.exp(-Math.pow((phase - 2.78) / 0.24, 2)) * 0.35;
    } else {
      // 超新星：一次约 1 秒的亮度峰值（时间包络在 scene 里叠加）
      flash = Math.exp(-Math.pow((phase - 3.05) / 0.16, 2));
    }

    const birthCloud = Math.exp(-Math.pow(phase / 0.5, 2));
    const deathCloud = fate === 'whitedwarf'
      ? Math.exp(-Math.pow((phase - 2.6) / 0.55, 2))
      : 0.7 * Math.exp(-Math.pow((phase - 3.0) / 0.42, 2));
    const envelope = clamp(Math.max(birthCloud, deathCloud), 0, 1);
    const remnant = smoothstep(3.35, 3.95, phase);

    const stageIndex = Math.round(phase);
    const color = tempK > 0 ? tempRGB(tempK) : [0, 0, 0];

    return {
      mass: mass,
      phase: phase,
      fate: fate,
      fateInfo: fateInfo,
      radiusSun: radiusSun,
      tempK: tempK,
      lumSun: lumSun,
      color: color,
      colorHex: tempK > 0 ? tempHex(tempK) : '#000000',
      flash: flash,
      envelope: envelope,
      remnant: remnant,
      stageIndex: stageIndex,
      stageLabel: STAGES[clamp(stageIndex, 0, 4)],
      lifespanGyr: lifespanGyr(mass)
    };
  }

  /**
   * 赫罗图轨迹点（温度 K / 光度 L☉）。
   * 主序带从左上（热、亮）到右下（冷、暗），红巨星在右上。
   */
  function hrPath(mass) {
    mass = clamp(isFinite(mass) ? mass : 1, 0.08, 40);
    const kf = phaseKeyframes(mass);
    const fate = fateOf(mass);
    const pts = [];
    pts.push({ temp: 3000, lum: clamp(kf[0].l, 1e-3, 1e4), label: '星云' });
    pts.push({ temp: 4200, lum: clamp(kf[1].l * 1.4, 1e-3, 1e6), label: '主序前' });
    pts.push({ temp: clamp(kf[1].t, 2000, 60000), lum: Math.max(kf[1].l, 1e-4), label: '主序星' });
    pts.push({ temp: clamp((kf[1].t + kf[2].t) * 0.52, 2400, 60000), lum: Math.sqrt(kf[1].l * kf[2].l), label: '次巨星' });
    pts.push({ temp: kf[2].t, lum: kf[2].l, label: '红巨星' });
    if (fate === 'whitedwarf') {
      pts.push({ temp: 30000, lum: 1200, label: '行星状星云' });
      pts.push({ temp: kf[4].t, lum: kf[4].l, label: '白矮星' });
    } else if (fate === 'neutronstar') {
      pts.push({ temp: 9000, lum: 1e6, label: '超新星' });
      pts.push({ temp: 1e6, lum: 1e-6, label: '中子星' });
    } else {
      pts.push({ temp: 9000, lum: 1e6, label: '超新星' });
      pts.push({ temp: 1e6, lum: 1e-9, label: '黑洞' });
    }
    return pts;
  }

  /* ---------------- 对外模型 ---------------- */
  COSMOS.deepModel = {
    /* 常数 */
    G: G,
    C: C,
    MSUN: MSUN,
    RSUN: RSUN,
    REARTH: REARTH,
    LSUN: LSUN,
    TSUN: TSUN,
    FATES: FATES,
    STAGES: STAGES,

    /* 格式化 */
    fmtNum: fmtNum,
    fmtLifespan: fmtLifespan,
    tempRGB: tempRGB,
    tempHex: tempHex,

    /* 致密天体 */
    schwarzschildKm: schwarzschildKm,
    compactReadout: compactReadout,

    /* 恒星 */
    mainRadiusSun: mainRadiusSun,
    mainTempK: mainTempK,
    mainLumSun: mainLumSun,
    lifespanGyr: lifespanGyr,
    fateOf: fateOf,
    phaseKeyframes: phaseKeyframes,
    stellarState: stellarState,
    hrPath: hrPath
  };

  /* ---------------- 共享交互状态（widget 写、scene 读） ---------------- */
  COSMOS.state = COSMOS.state || {};
  if (!COSMOS.state.compact) {
    COSMOS.state.compact = { mode: 'blackhole', mass: 10 };
  }
  if (!COSMOS.state.compact.screen) {
    COSMOS.state.compact.screen = { rsKm: schwarzschildKm(10), diameterKm: schwarzschildKm(10) * 2 };
  }
  if (!COSMOS.state.stellar) {
    COSMOS.state.stellar = { mass: 1, phase: 1 };
  }

  /* ============================================================
   * 05 致密天体
   * ============================================================ */
  COSMOS.addContent('compact', {
    num: '04',
    index: '06',
    title: '致密天体',
    titleEn: 'COMPACT OBJECTS',
    part: 'III · 深空天体',
    layout: 'split',
    kicker: '残骸的三种形态',
    lead: '同样的引力，把恒星残骸压到三个不同的尺寸。',
    paragraphs: [
      '白矮星、中子星与黑洞都是恒星燃尽后的残骸，差别在于残骸被压到多小。白矮星靠电子简并压支撑，密度约 10⁹ kg/m³；中子星靠中子简并压支撑，半径只有约 12 公里；黑洞的引力强到事件视界内的光也逃不出来。',
      '事件视界半径与质量成正比：rs = 2GM/c²，每 1 倍太阳质量约对应 2.95 公里。10 倍太阳质量的黑洞，视界直径约 59 公里；银河系中心的 Sgr A* 约 430 万倍太阳质量，视界直径约 2,500 万公里，约为水星到太阳平均距离的四成。',
      '常见误解是“黑洞像吸尘器，会把附近一切吸走”。在视界之外，引力仍按平方反比递减：只要没有恰好损失轨道能量，恒星依旧会安全绕行，就像卫星绕地球，速度够快就不会掉下来。决定物质命运的是距离与轨道，而不是“吸力”这个说法；我们银河系的中心，就有一颗 430 万倍太阳质量的黑洞。'
    ],
    facts: [
      { v: '2.95', u: '公里', l: '每 1 倍太阳质量的史瓦西半径' },
      { v: '12', u: '公里', l: '中子星典型半径' },
      { v: '10⁹', u: 'kg/m³', l: '白矮星密度量级' },
      { v: '1.44', u: '倍太阳质量', l: '钱德拉塞卡极限' }
    ],
    hint: '拖动旋转 · Ctrl+滚轮缩放 · Esc 复位 · 切换页签看三种残骸',
    quote: {
      text: '把太阳压进 3 公里以内，它就变成黑洞——物理规律没有变，越过的只是密度极限。',
      cite: '史瓦西解（Schwarzschild，1916）'
    },
    widget: 'compact'
  });

})(window.COSMOS = window.COSMOS || {});
