/* ============================================================
 * COSMOS ATLAS — 04 致密天体 / 黑洞模拟器 · 共享物理与格式
 * ------------------------------------------------------------
 * 纯函数，无 DOM / 无 THREE / 无网络；scene-compact.js 与
 * feat-compact.js 都用这里的口径，保证画面与读数同源。
 *
 * 单位约定（见 js/data.js D.compact）：
 *   - 质量 M：太阳质量 M☉
 *   - 长度：显示用 km；场景单位 = 主黑洞 rs（rs = 2.95325008 km × M）
 *   - 速度：c 的倍数；盘内缘气体 0.5c（史瓦西 ISCO = 3 rs）
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const DATA = COSMOS.DATA || {};
  const C_KM_S = 299792.458;
  const RS_KM_MSUN = 2.95325008;          /* 2GM☉/c² */
  const ISCO_RS = 3;                       /* 史瓦西黑洞最内稳定圆轨道 */
  const GAS_SPEED_C = 0.5;                 /* ISCO 处轨道速度 */
  const SHADOW_RS = Math.sqrt(27) / 2;     /* 光子捕获半径 ≈ 2.598 rs */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function rsKm(mass) { return RS_KM_MSUN * Math.max(1e-9, mass || 0); }
  function horizonDiameterKm(mass) { return 2 * rsKm(mass); }
  function iscoKm(mass) { return ISCO_RS * rsKm(mass); }

  /* ISCO 处一圈的坐标时（秒）：T = 2π r / v，r = 3rs，v = 0.5c */
  // ISCO 圆轨道周期（远观测者坐标时）：T = 2π·sqrt(r³/GM)，GM = rs·c²/2。
  // r = 3rs 时约 4.55 ms / 10 M☉（与参考站一致）；不能简单用“周长 ÷ 0.5c”，
  // 0.5c 是局部静止观者测得的轨道速度，坐标周期更长。
  function iscoPeriodSec(mass) {
    const r = iscoKm(mass), rs = rsKm(mass);
    return 2 * Math.PI * Math.sqrt((2 * r * r * r) / (rs * C_KM_S * C_KM_S));
  }

  /* 相机/观察者相对某黑洞的钟慢因子：sqrt(1 - rs/r)，r 以 rs 为单位 */
  function clockRate(distRs) {
    return Math.sqrt(Math.max(0, 1 - 1 / Math.max(1.0001, distRs)));
  }

  /* 黑洞阴影在天空中的角直径（度）：捕获半径 2.598 rs */
  function shadowDeg(distRs) {
    const r = Math.max(1.2, distRs);
    return 2 * Math.atan(SHADOW_RS / r) * 180 / Math.PI;
  }

  function escapeVelocityC(distRs) {
    return Math.sqrt(Math.min(1, 1 / Math.max(1.0001, distRs)));
  }

  /* 主黑洞质量：第一个黑洞，否则 30 M☉ */
  function primaryMass(bodies) {
    if (bodies && bodies.length) {
      for (let i = 0; i < bodies.length; i++) {
        if (bodies[i].kind === 'bh') return bodies[i].mass;
      }
    }
    return 30;
  }

  /* 世界单位 → km：世界 1 单位 = 主黑洞 rs */
  function unitKm(primaryMassMsun) { return rsKm(primaryMassMsun); }

  /* ---------- 数字格式（中英共用，单位由调用方拼） ---------- */
  function group(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    const d = Math.abs(n) >= 1000 ? 0 : (digits == null ? 2 : digits);
    const s = Math.abs(n) >= 1000 ? String(Math.round(n)) : n.toFixed(d);
    const parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + parts.join('.');
  }

  function fmtKm(km, en) {
    if (km == null || !isFinite(km)) return '—';
    const a = Math.abs(km);
    if (a >= 1e8) {
      const v = km / 1e8;
      return group(v, v >= 100 ? 0 : 2) + (en ? ' billion km' : ' 亿公里');
    }
    if (a >= 1e4) return group(km, 0) + (en ? ' km' : ' 公里');
    return group(km, a >= 100 ? 0 : 2) + ' km';
  }

  function fmtDuration(sec, en) {
    const a = Math.abs(sec);
    if (!isFinite(a)) return '—';
    if (a < 1e-3) return group(sec * 1e6, 0) + ' µs';
    if (a < 1) return group(sec * 1e3, 2) + ' ms';
    if (a < 60) return group(sec, sec < 10 ? 2 : 1) + ' s';
    if (a < 3600) return group(sec / 60, 1) + ' min';
    if (a < 86400) return group(sec / 3600, 1) + ' h';
    if (a < 86400 * 400) return group(sec / 86400, 1) + ' d';
    return group(sec / (86400 * 365.25), 2) + (en ? ' yr' : ' 年');
  }

  function fmtMass(mass, en) {
    if (mass == null) return '—';
    if (mass >= 1e6) return group(mass / 1e6, 2) + (en ? ' million M☉' : ' 百万倍太阳质量');
    if (mass >= 1000) return group(mass, 0) + ' M☉';
    return group(mass, mass < 10 ? 1 : 0) + ' M☉';
  }

  function fmtPct(x, digits) { return group(x * 100, digits == null ? 1 : digits) + '%'; }

  /* ---------- 黑体色（近似，给夜景温度染色） ---------- */
  function blackbodyRGB(tempK) {
    const t = clamp(tempK, 1000, 40000) / 100;
    let r, g, b;
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

  /* ---------- 场景 / 预设查询 ---------- */
  function sceneList() { return (DATA.compact && DATA.compact.scenes) || []; }
  function sceneById(id) {
    if (DATA.compactSceneById) return DATA.compactSceneById(id);
    const list = sceneList();
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }
  function presets(kind) {
    const p = DATA.compact && DATA.compact.presets;
    return (p && p[kind]) || [];
  }
  function discColors() { return (DATA.compact && DATA.compact.discColors) || []; }

  COSMOS.bhModel = {
    C_KM_S: C_KM_S,
    RS_KM_MSUN: RS_KM_MSUN,
    ISCO_RS: ISCO_RS,
    SHADOW_RS: SHADOW_RS,
    rsKm: rsKm,
    horizonDiameterKm: horizonDiameterKm,
    iscoKm: iscoKm,
    iscoPeriodSec: iscoPeriodSec,
    clockRate: clockRate,
    shadowDeg: shadowDeg,
    escapeVelocityC: escapeVelocityC,
    primaryMass: primaryMass,
    unitKm: unitKm,
    group: group,
    fmtKm: fmtKm,
    fmtDuration: fmtDuration,
    fmtMass: fmtMass,
    fmtPct: fmtPct,
    blackbodyRGB: blackbodyRGB,
    sceneList: sceneList,
    sceneById: sceneById,
    presets: presets,
    discColors: discColors
  };
})(window.COSMOS = window.COSMOS || {});
