/* ============================================================
 * COSMOS ATLAS · scene-solarsystem.js
 * 02 太阳系 · 真实星历驱动的 3D 太阳系舞台（stage: solar）
 *
 * 契约：COSMOS.registerStage('solar', factory) → {
 *   scene, camera, arrowKeys, update(t, dt, p), resize(w, h),
 *   enter(), leave(), reset(), dispose(), bloom
 * }
 *
 * 数据与时间（契约 §2/§3/§4）：
 *   · 位置全部来自 COSMOS.ephem（JPL 近似轨道根数 + Meeus 月球 + 卫星平均轨道），
 *     本文件只调用契约 API：jdFromMs / planet / moonRel / moonIds。
 *   · 时间由 COSMOS.state.solar.timeMs 驱动，本场景是唯一推进者：
 *     未暂停时 timeMs += dt * daysPerSec * 86400000（daysPerSec 可为负 = 倒放）。
 *   · 径向映射 sceneR = 5.2 + 3.0 * sqrt(au)，方向取真实 J2000 黄道向量；
 *     黄道 (x,y,z) → three (x, z, -y)，太阳在原点。
 *   · 行星半径 bodyRadius(km) = 0.16 * pow(km / 12742, 0.5)，enlarge 时 ×6
 *     （明确不按比例，只为看得见）；卫星距离压缩到 4.5–8 × 母行星半径，
 *     真实顺序保持（契约 §4.1）。
 *
 * 状态：COSMOS.state.solar（场景与 widget 共享）
 *   { timeMs, daysPerSec, paused, view, focus, selected, labels, orbits,
 *     enlarge, qualityHint }
 *   场景写回：timeMs / view / focus / selected / enlarge；
 *   场景读：paused / daysPerSec / labels / orbits / selected。
 *
 * 事件：
 *   收 solar:cmd { type: view|focus|select|zoom|reset|goto|enlarge|shake, ... }
 *   收 solar:zoom { dir } / solar:reset（旧 widget 兼容）
 *   发 solar:tick { timeMs, jd, bodies:[{id, helioAU, geoAU, lightMin}] }（8Hz）
 *   发 solar:ready {} / solar:focus { id } / solar:hover { id }
 *
 * 标签层：#sol-labels（body 级 DOM，本场景创建/接管；行星名常显、卫星名在
 *   聚焦行星或足够近时显示；同帧投影 + 矩形避让 + aria-hidden）。
 *
 * 性能预算（契约 §4.1）：draw call ≤ 70、三角 ≤ 30 万、high ≥ 50fps；
 *   update() 内零 new（临时向量 / 标签数组 / tick payload 全部预建复用）；
 *   行星与卫星共用一个 SphereGeometry，所有 uniform 预建、纹理首帧预热。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var THREE = window.THREE;
  var U = COSMOS.util;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  var J2000 = 2451545.0;          /* 2000-01-01 12:00 TT（契约 §3 同口径） */
  var AU_KM = 149597870.7;        /* 1 AU = 149,597,870.7 km */
  var LIGHT_MIN_AU = 8.316746;    /* 1 AU 的光行时（分钟） */

  /* 径向压缩映射：契约 §4.1；太阳 5.2，海王星 ≈ 21.7 */
  var MAP_BASE = 5.2;
  var MAP_SQRT = 3.0;
  var SUN_R = 3.4;                /* 太阳显示半径（契约 §4.1） */

  /* 默认相机：whole 视图要完整看到海王星轨道（sceneR ≈ 21.7），
   * 同时太阳盘高 < 画面的 35%（3.4*2 / (2*58*tan25°) ≈ 12.6%）。 */
  var DEF = { yaw: 0.85, pitch: 0.30, dist: 44 };
  var VIEW_DIST = { whole: 44, inner: 22, planet: 9 };
  var LIMIT = { pitchMin: 0.02, pitchMax: 1.45, distMin: 0.35, distMax: 300 };

  /* 屏幕偏移：左侧是文案栏、右侧是控制台，把主体往右上让一点。
   * 用 setViewOffset 做屏幕空间平移，project()/raycaster 会自动跟随。 */
  var VIEW_SHIFT = { x: 0.07, y: -0.062 };

  var ENLARGE = 6;                /* enlarge 开关的显示倍率（不按比例） */
  var SPIN_GAIN = 0.06;           /* 自转观感增益：真实角速度 × 0.06 */
  var TICK_INTERVAL = 0.125;      /* solar:tick 8Hz（契约要求 ≥6Hz） */

  /* 行星半径：只用于"看得见"，不按比例（契约 §4.1）。参数是直径 km。 */
  function bodyRadius(km) {
    return 0.16 * Math.pow(Math.max(km, 1) / 12742, 0.5);
  }

  /* AU → 场景径向距离（同一个映射给行星位置与轨道线）。 */
  function sceneRadius(au) {
    return MAP_BASE + MAP_SQRT * Math.sqrt(Math.max(au, 0));
  }

  /* ============================================================
   * 行星外观参数（颜色与强度按物理性质设定，不是调色盘）
   * ============================================================ */
  var LOOK = {
    mercury: {
      atmo: [0.78, 0.73, 0.66], atmoStrength: 0.08, tint: [1.0, 1.0, 1.0]
    },
    venus: {
      atmo: [1.0, 0.88, 0.62], atmoStrength: 0.55, tint: [1.04, 1.0, 0.90]
    },
    earth: {
      atmo: [0.32, 0.62, 1.0], atmoStrength: 0.82, tint: [1.0, 1.0, 1.0],
      ocean: 0.9, clouds: 1, cloudShadow: 0.45, night: 1
    },
    mars: {
      atmo: [0.96, 0.56, 0.38], atmoStrength: 0.22, tint: [1.04, 0.97, 0.92],
      ice: 1.0
    },
    jupiter: {
      atmo: [0.95, 0.86, 0.72], atmoStrength: 0.30, tint: [1.0, 0.99, 0.96],
      jupiter: 1, grs: 0.55,
      ring: { inner: 1.36, outer: 1.62, opacity: 0.10, tint: [0.72, 0.66, 0.58] }
    },
    saturn: {
      atmo: [0.98, 0.90, 0.68], atmoStrength: 0.26, tint: [1.02, 1.0, 0.94],
      ring: { inner: 1.28, outer: 2.34, opacity: 0.98, tex: 1, tint: [1.0, 0.93, 0.80] }
    },
    uranus: {
      atmo: [0.60, 0.92, 1.0], atmoStrength: 0.45, tint: [0.88, 1.0, 1.04],
      bands: 1, ring: { inner: 1.55, outer: 1.95, opacity: 0.10, tint: [0.62, 0.74, 0.82] }
    },
    neptune: {
      atmo: [0.42, 0.58, 1.0], atmoStrength: 0.50, tint: [0.86, 0.98, 1.10],
      bands: 1, ring: { inner: 1.60, outer: 2.05, opacity: 0.07, tint: [0.55, 0.65, 0.80] }
    },
    pluto: {
      atmo: [0.70, 0.66, 0.62], atmoStrength: 0.03, tint: [1.0, 0.98, 0.96]
    }
  };

  /* ============================================================
   * 卫星兜底表：优先用 COSMOS.DATA.moons（Lead 在 data.js 里加的那份），
   * 缺失时按契约 §7 的字段表内置一份，保证场景独立可跑。
   * ============================================================ */
  var MOON_FALLBACK = [
    { id: 'moon', name: '月球', en: 'Moon', parent: 'earth', radiusKm: 1737.4,
      diameterKm: 3474.8, periodDays: 27.32, distanceKm: 384400, texture: 'moon' },
    { id: 'phobos', name: '火卫一', en: 'Phobos', parent: 'mars', radiusKm: 11.27,
      diameterKm: 22.53, periodDays: 0.319, distanceKm: 9376, texture: 'phobos' },
    { id: 'deimos', name: '火卫二', en: 'Deimos', parent: 'mars', radiusKm: 6.2,
      diameterKm: 12.4, periodDays: 1.263, distanceKm: 23463, texture: 'deimos' },
    { id: 'io', name: '木卫一', en: 'Io', parent: 'jupiter', radiusKm: 1821.6,
      diameterKm: 3643.2, periodDays: 1.769, distanceKm: 421700, texture: 'io' },
    { id: 'europa', name: '木卫二', en: 'Europa', parent: 'jupiter', radiusKm: 1560.8,
      diameterKm: 3121.6, periodDays: 3.551, distanceKm: 671034, texture: 'europa' },
    { id: 'ganymede', name: '木卫三', en: 'Ganymede', parent: 'jupiter', radiusKm: 2634.1,
      diameterKm: 5268.2, periodDays: 7.155, distanceKm: 1070412, texture: 'ganymede' },
    { id: 'callisto', name: '木卫四', en: 'Callisto', parent: 'jupiter', radiusKm: 2410.3,
      diameterKm: 4820.6, periodDays: 16.689, distanceKm: 1882709, texture: 'callisto' },
    { id: 'enceladus', name: '土卫二', en: 'Enceladus', parent: 'saturn', radiusKm: 252.1,
      diameterKm: 504.2, periodDays: 1.370, distanceKm: 237948, texture: 'enceladus' },
    { id: 'rhea', name: '土卫五', en: 'Rhea', parent: 'saturn', radiusKm: 763.8,
      diameterKm: 1527.6, periodDays: 4.518, distanceKm: 527108, texture: 'rhea' },
    { id: 'titan', name: '土卫六', en: 'Titan', parent: 'saturn', radiusKm: 2574.7,
      diameterKm: 5149.5, periodDays: 15.945, distanceKm: 1221870, texture: 'titan' },
    { id: 'triton', name: '海卫一', en: 'Triton', parent: 'neptune', radiusKm: 1353.4,
      diameterKm: 2706.8, periodDays: 5.877, distanceKm: 354759, texture: 'triton' },
    { id: 'charon', name: '冥卫一', en: 'Charon', parent: 'pluto', radiusKm: 606,
      diameterKm: 1212, periodDays: 6.387, distanceKm: 19591, texture: 'charon' }
  ];

  /* ============================================================
   * 星历兜底（ephem.js 尚未加载时使用；最终代码只调用契约 API）
   * 行星：J2000 平均轨道根数 + 开普勒方程；月球/卫星：圆轨道近似。
   * 只是让场景在 ephem 就绪前可运行，精度远低于 ephem.js。
   * ============================================================ */
  var FALLBACK = (function () {
    /* a(AU), e, i(deg), node(deg), peri(deg), M0(deg), n(deg/day) —— J2000 */
    var ELEM = {
      mercury: { a: 0.387098, e: 0.205630, i: 7.005, node: 48.331, peri: 77.456, M0: 252.251, n: 4.092334 },
      venus: { a: 0.723332, e: 0.006772, i: 3.395, node: 76.680, peri: 131.533, M0: 181.979, n: 1.602131 },
      earth: { a: 1.000001, e: 0.016709, i: 0.0005, node: -11.26064, peri: 102.94719, M0: 100.46435, n: 0.985609 },
      mars: { a: 1.523679, e: 0.093400, i: 1.850, node: 49.558, peri: 336.041, M0: 355.453, n: 0.524033 },
      jupiter: { a: 5.202600, e: 0.048490, i: 1.303, node: 100.464, peri: 14.331, M0: 34.351, n: 0.083091 },
      saturn: { a: 9.554910, e: 0.055510, i: 2.489, node: 113.666, peri: 93.057, M0: 50.077, n: 0.033444 },
      uranus: { a: 19.218450, e: 0.046300, i: 0.773, node: 74.006, peri: 173.005, M0: 314.055, n: 0.011731 },
      neptune: { a: 30.110390, e: 0.008990, i: 1.770, node: 131.784, peri: 48.124, M0: 304.349, n: 0.005981 },
      pluto: { a: 39.481680, e: 0.248800, i: 17.160, node: 110.303, peri: 113.763, M0: 14.530, n: 0.003975 }
    };

    function norm(x) {
      x = x % TAU;
      return x < 0 ? x + TAU : x;
    }

    function kepler(M, e) {
      var E = M;
      for (var it = 0; it < 7; it++) {
        E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      }
      return E;
    }

    function helio(id, jd) {
      var el = ELEM[id];
      if (!el) return null;
      var M = norm((el.M0 + el.n * (jd - J2000)) * DEG);
      var E = kepler(M, el.e);
      var xv = el.a * (Math.cos(E) - el.e);
      var yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
      var w = el.peri * DEG, om = el.node * DEG, inc = el.i * DEG;
      var cw = Math.cos(w), sw = Math.sin(w);
      var co = Math.cos(om), so = Math.sin(om);
      var ci = Math.cos(inc), si = Math.sin(inc);
      var x1 = xv * cw - yv * sw;
      var y1 = xv * sw + yv * cw;
      var X = x1 * co - y1 * ci * so;
      var Y = x1 * so + y1 * ci * co;
      var Z = y1 * si;
      return { x: X, y: Y, z: Z, au: Math.sqrt(X * X + Y * Y + Z * Z) };
    }

    /* 兜底卫星表：parent / 周期 / 平均距离 / 轨道倾角（相对黄道，度） */
    var MOONS = {};
    for (var mi = 0; mi < MOON_FALLBACK.length; mi++) {
      var md = MOON_FALLBACK[mi];
      MOONS[md.parent + ':' + md.id] = md;
    }
    var INC = { moon: 5.14, phobos: 1.08, deimos: 1.79, io: 0.04, europa: 0.47,
      ganymede: 0.20, callisto: 0.19, enceladus: 0.01, rhea: 0.35, titan: 0.35,
      triton: 156.9, charon: 0.08 };

    function moonRel(parentId, moonId, jd) {
      var md = MOONS[parentId + ':' + moonId];
      if (!md) return null;
      var period = md.periodDays || 27.32;
      var inc = (INC[moonId] || 0.5) * DEG;
      var phase = 0;
      for (var k = 0; k < moonId.length; k++) phase = (phase * 31 + moonId.charCodeAt(k)) % 360;
      var ang = phase * DEG + (jd - J2000) / period * TAU;
      var dAU = md.distanceKm / AU_KM;
      var x = Math.cos(ang) * dAU;
      var y = Math.sin(ang) * dAU * Math.sin(inc);
      var z = Math.sin(ang) * dAU * Math.cos(inc);
      return { x: x, y: y, z: z };
    }

    function moonIds(parentId) {
      var out = [];
      for (var i = 0; i < MOON_FALLBACK.length; i++) {
        if (MOON_FALLBACK[i].parent === parentId) out.push(MOON_FALLBACK[i].id);
      }
      return out;
    }

    return {
      version: '0-fallback',
      JD_UNIX_EPOCH: 2440587.5,
      jdFromMs: function (ms) { return ms / 86400000 + 2440587.5; },
      msFromJd: function (jd) { return (jd - 2440587.5) * 86400000; },
      planet: function (id, jd) { return helio(id, jd); },
      earth: function (jd) { return helio('earth', jd); },
      sunGeo: function () { return { x: 0, y: 0, z: 0, ra: 0, dec: 0, lon: 0, lat: 0, distAU: 1 }; },
      moonGeo: function (jd) {
        var e = helio('earth', jd), m = moonRel('earth', 'moon', jd);
        return { x: e.x + m.x, y: e.y + m.y, z: e.z + m.z, au: e.au };
      },
      moonRel: moonRel,
      moonIds: moonIds,
      eclToEq: function (x, y, z) { return { x: x, y: y, z: z }; },
      eqToAltAz: function () { return { alt: 0, az: 0 }; },
      gmst: function () { return 0; },
      moonPhase: function () { return 0; },
      eventsBetween: function () { return []; },
      nextEvents: function () { return []; }
    };
  })();

  /* ============================================================
   * GLSL 片段（ES 1.00；噪声自包含，不依赖 addons）
   * ============================================================ */
  var GLSL_NOISE = [
    'float h31(vec3 p) {',
    '  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));',
    '  p *= 17.0;',
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    'float vnoise(vec3 x) {',
    '  vec3 i = floor(x);',
    '  vec3 f = fract(x);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(mix(h31(i), h31(i + vec3(1.0, 0.0, 0.0)), f.x),',
    '        mix(h31(i + vec3(0.0, 1.0, 0.0)), h31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
    '    mix(mix(h31(i + vec3(0.0, 0.0, 1.0)), h31(i + vec3(1.0, 0.0, 1.0)), f.x),',
    '        mix(h31(i + vec3(0.0, 1.0, 1.0)), h31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);',
    '}',
    'float fbm3(vec3 p) {',
    '  float s = 0.0;',
    '  float a = 0.5;',
    '  for (int i = 0; i < 4; i++) {',
    '    s += a * vnoise(p);',
    '    p = p * 2.03 + vec3(11.7, 5.3, 1.9);',
    '    a *= 0.5;',
    '  }',
    '  return s;',
    '}'
  ].join('\n');

  var PLANET_VS = [
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'varying vec3 vObjPos;',
    'void main() {',
    '  vUv = uv;',
    '  vObjPos = position;',
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var PLANET_FS = [
    'uniform sampler2D uMap;',
    'uniform sampler2D uNightMap;',
    'uniform sampler2D uCloudMap;',
    'uniform vec3 uSunPos;',
    'uniform vec3 uTint;',
    'uniform float uTime;',
    'uniform float uHover;',
    'uniform float uOcean;',
    'uniform float uCloudShadow;',
    'uniform float uCloudOffset;',
    'uniform float uIce;',
    'uniform float uBands;',
    'uniform float uGrs;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'varying vec3 vObjPos;',
    '#ifdef P_RING',
    'uniform sampler2D uRingMap;',
    'uniform vec3 uRingCenter;',
    'uniform vec3 uRingNormal;',
    'uniform float uRingInner;',
    'uniform float uRingOuter;',
    'float ringDensityAt(float k) {',
    '  vec4 t = texture2D(uRingMap, vec2(clamp(k, 0.002, 0.998), 0.5));',
    '  float dens = clamp(t.a, 0.0, 1.0) * (0.55 + 0.45 * clamp(t.r, 0.0, 1.0));',
    '  /* 贴图本身已带真实的卡西尼缝 / 恩克缝，这里不再合成 */',
    '  return clamp(dens, 0.0, 1.0);',
    '}',
    'float ringShadow(vec3 P) {',
    '  vec3 L = normalize(uSunPos - P);',
    '  float dn = dot(L, uRingNormal);',
    '  if (abs(dn) < 0.0008) return 1.0;',
    '  float t = dot(uRingCenter - P, uRingNormal) / dn;',
    '  if (t <= 0.0) return 1.0;',
    '  vec3 H = P + L * t;',
    '  float rad = length(H - uRingCenter);',
    '  if (rad < uRingInner || rad > uRingOuter) return 1.0;',
    '  float k = (rad - uRingInner) / (uRingOuter - uRingInner);',
    '  return 1.0 - ringDensityAt(k) * 0.85;',
    '}',
    '#endif',
    GLSL_NOISE,
    'void main() {',
    '  vec3 albedo = texture2D(uMap, vUv).rgb * uTint;',
    '  #ifdef P_JUPITER',
    '  float wx = fbm3(vObjPos * 6.0 + vec3(0.0, uTime * 0.006, 0.0)) - 0.5;',
    '  float wy = fbm3(vObjPos * 3.5 + vec3(uTime * 0.004, 0.0, 0.0)) - 0.5;',
    '  vec2 juv = vec2(vUv.x + wx * 0.009, vUv.y + wy * 0.015);',
    '  albedo = texture2D(uMap, juv).rgb * uTint;',
    '  float turb = fbm3(vec3(juv * vec2(13.0, 21.0), uTime * 0.010));',
    '  albedo *= 0.90 + 0.26 * turb;',
    '  vec2 g = (vUv - vec2(0.38, 0.62)) * vec2(7.0, 12.5);',
    '  float ge = length(g);',
    '  float gr = (1.0 - smoothstep(0.10, 1.0, ge)) * uGrs;',
    '  float sw = 0.5 + 0.5 * sin(ge * 9.0 - atan(g.y, g.x) * 2.0 + uTime * 0.10);',
    '  albedo = mix(albedo, vec3(0.62, 0.30, 0.18) * (0.75 + 0.5 * sw), clamp(gr, 0.0, 0.85));',
    '  #endif',
    '  #ifdef P_BANDS',
    '  float band = 0.5 + 0.5 * sin(vUv.y * 62.83 + (vnoise(vObjPos * 5.0) - 0.5) * 3.0);',
    '  albedo *= mix(vec3(1.0), vec3(0.86, 0.95, 1.06), uBands * band * 0.55);',
    '  #endif',
    '  #ifdef P_ICE',
    '  float lat = vObjPos.y;',
    '  float cn = (fbm3(vObjPos * 8.0) - 0.5) * 0.20;',
    '  float north = smoothstep(0.56, 0.90, lat + cn);',
    '  float south = smoothstep(0.60, 0.95, -lat + cn * 0.9);',
    '  float cap = max(north, south) * uIce;',
    '  albedo = mix(albedo, vec3(0.94, 0.96, 0.99), cap);',
    '  #endif',
    '  float clum = 0.0;',
    '  #ifdef P_CLOUDS',
    '  clum = dot(texture2D(uCloudMap, vec2(fract(vUv.x + uCloudOffset), vUv.y)).rgb,',
    '             vec3(0.299, 0.587, 0.114));',
    '  #endif',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 L = normalize(uSunPos - vWorldPos);',
    '  vec3 V = normalize(cameraPosition - vWorldPos);',
    '  float nl = dot(N, L);',
    '  float day = smoothstep(-0.10, 0.24, nl);',
    '  float diff = pow(max(nl, 0.0), 0.85);',
    '  #ifdef P_RING',
    '  float rs = ringShadow(vWorldPos);',
    '  diff *= rs;',
    '  day *= mix(1.0, rs, 0.85);',
    '  #endif',
    '  #ifdef P_CLOUDS',
    '  diff *= 1.0 - uCloudShadow * smoothstep(0.16, 0.60, clum);',
    '  #endif',
    '  vec3 color = albedo * diff * vec3(1.06, 1.0, 0.94);',
    '  color += albedo * 0.030;',
    '  #ifdef P_OCEAN',
    '  vec3 Hv = normalize(L + V);',
    '  float water = smoothstep(0.03, 0.14, albedo.b - albedo.r);',
    '  float spec = pow(max(dot(N, Hv), 0.0), 56.0) * water * uOcean;',
    '  color += vec3(1.0, 0.94, 0.82) * spec * day;',
    '  #endif',
    '  #ifdef P_NIGHT',
    '  vec3 night = texture2D(uNightMap, vUv).rgb;',
    '  color += vec3(1.0, 0.80, 0.52) * night * (1.0 - smoothstep(-0.16, 0.10, nl)) * 1.15;',
    '  #endif',
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);',
    '  color += vec3(0.14, 0.26, 0.46) * fres * uHover;',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  var ATMO_VS = [
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  /* 云层顶点着色器：大气 VS 不声明 vUv，云层 FS 需要 uv，单独一份避免 varying 不匹配 */
  var CLOUD_VS = [
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vUv = uv;',
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var ATMO_FS = [
    'uniform vec3 uAtmoColor;',
    'uniform vec3 uSunPos;',
    'uniform float uAtmoStrength;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 V = normalize(cameraPosition - vWorldPos);',
    '  vec3 L = normalize(uSunPos - vWorldPos);',
    '  float fres = pow(1.0 - abs(dot(N, V)), 3.2);',
    '  float lit = smoothstep(-0.35, 0.40, dot(N, L));',
    '  float fwd = pow(max(dot(V, -L), 0.0), 5.0);',
    '  float a = fres * (0.35 + 0.85 * lit) + fwd * 0.20 * lit;',
    '  gl_FragColor = vec4(uAtmoColor * (0.9 + 0.6 * fwd), clamp(a, 0.0, 1.0) * uAtmoStrength);',
    '}'
  ].join('\n');

  var CLOUD_FS = [
    'uniform sampler2D uMap;',
    'uniform vec3 uSunPos;',
    'uniform float uOpacity;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  float m = dot(texture2D(uMap, vUv).rgb, vec3(0.299, 0.587, 0.114));',
    '  float dens = smoothstep(0.12, 0.55, m);',
    '  if (dens < 0.01) discard;',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 L = normalize(uSunPos - vWorldPos);',
    '  float lit = smoothstep(-0.20, 0.35, dot(N, L));',
    '  vec3 col = mix(vec3(0.16, 0.20, 0.28), vec3(1.0, 1.0, 1.0), lit);',
    '  gl_FragColor = vec4(col, dens * uOpacity);',
    '}'
  ].join('\n');

  var SUN_FS = [
    'uniform float uTime;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'varying vec3 vObjPos;',
    GLSL_NOISE,
    'void main() {',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 V = normalize(cameraPosition - vWorldPos);',
    '  float mu = max(dot(N, V), 0.0);',
    '  float g0 = fbm3(vObjPos * 0.45 + vec3(uTime * 0.010)) * 0.5 + 0.5;',
    '  float g1 = fbm3(vObjPos * 1.0 + vec3(0.0, 0.0, uTime * 0.026)) * 0.5 + 0.5;',
    '  float g2 = fbm3(vObjPos * 2.4 - vec3(uTime * 0.018)) * 0.5 + 0.5;',
    '  float g3 = fbm3(vObjPos * 4.6 + vec3(0.0, uTime * 0.05, 0.0)) * 0.5 + 0.5;',
    '  float gran = g0 * 0.38 + g1 * 0.45 + g2 * 0.22 + g3 * 0.12;',
    '  float spot = 1.0 - smoothstep(0.28, 0.58, fbm3(vObjPos * 0.42 + vec3(uTime * 0.003)) * 0.5 + 0.5);',
    '  /* 线性 HDR 亮度按黑体色温给：中心穿到较深较热层（≈5772 K），',
    '   * 临边昏暗降到 ≈4200 K 的橙红。>1 交给统一泛光。 */',
    '  vec3 edge = vec3(0.40, 0.09, 0.010);',
    '  vec3 mid  = vec3(1.00, 0.20, 0.010);',
    '  vec3 hot  = vec3(1.80, 0.38, 0.020);',
    '  vec3 core = mix(edge, mid, smoothstep(0.00, 0.52, mu));',
    '  core = mix(core, hot, smoothstep(0.55, 0.96, mu));',
    '  core = mix(core, vec3(0.12, 0.022, 0.003), spot * 0.92);',
    '  core *= 0.18 + 1.35 * gran;',
    '  /* 色球 / spicule：μ→0 的轮廓上一圈薄亮环 */',
    '  float rim = (1.0 - smoothstep(0.0, 0.09, mu)) * (0.50 + 0.50 * fbm3(vObjPos * 4.5 + vec3(uTime * 0.5)));',
    '  core += vec3(1.10, 0.36, 0.05) * rim * 0.65;',
    '  gl_FragColor = vec4(core, 1.0);',
    '}'
  ].join('\n');

  var CORONA_VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var CORONA_FS = [
    'uniform float uTime;',
    'uniform float uOpacity;',
    'uniform vec3 uColor;',
    'uniform float uDiscR;',
    'varying vec2 vUv;',
    'float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float n2(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),',
    '             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    'void main() {',
    '  vec2 c = vUv - 0.5;',
    '  float r = length(c) * 2.0;',
    '  float ang = atan(c.y, c.x);',
    '  float n = n2(vec2(ang * 3.0, r * 6.0 - uTime * 0.20)) * 0.6',
    '          + n2(vec2(ang * 8.0 + 3.0, r * 12.0 - uTime * 0.33)) * 0.4;',
    '  float rays = 0.55 + 0.40 * sin(ang * 12.0 + n * 2.6 + uTime * 0.10);',
    '  float streamer = pow(max(0.0, n2(vec2(ang * 13.0, 0.5))), 3.6);',
    '  float outside = smoothstep(uDiscR * 0.92, uDiscR * 1.25, r);',
    '  float ring = exp(-pow((r - uDiscR * 1.02) / (uDiscR * 0.10), 2.0));',
    '  float fall = pow(clamp(1.0 - (r - uDiscR) / max(0.98 - uDiscR, 0.001), 0.0, 1.0), 1.55);',
    '  float alpha = (fall * outside * (0.55 + 0.30 * rays + 0.30 * streamer) + ring * 0.60) * uOpacity;',
    '  if (alpha < 0.002) discard;',
    '  vec3 col = mix(vec3(2.10, 1.35, 0.55), uColor, smoothstep(uDiscR, 0.92, r));',
    '  col *= 1.0 + 0.85 * ring;',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  var RING_VS = [
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vUv = uv;',
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var RING_FS = [
    'uniform sampler2D uMap;',
    'uniform float uUseTex;',
    'uniform float uStyle;',
    'uniform vec3 uTint;',
    'uniform vec3 uSunPos;',
    'uniform vec3 uPlanetPos;',
    'uniform float uPlanetR;',
    'uniform float uOpacity;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  float k = clamp(vUv.x, 0.0, 1.0);',
    '  vec3 base = uTint;',
    '  float dens;',
    '  if (uUseTex > 0.5) {',
    '    vec4 t = texture2D(uMap, vec2(k, 0.5));',
    '    base = t.rgb * uTint;',
    '    dens = clamp(t.a, 0.0, 1.0) * (0.55 + 0.45 * clamp(t.r, 0.0, 1.0));',
    '  } else {',
    '    float band = 0.0;',
    '    band += smoothstep(0.02, 0.06, k) * (1.0 - smoothstep(0.08, 0.12, k)) * 0.90;',
    '    band += smoothstep(0.30, 0.34, k) * (1.0 - smoothstep(0.38, 0.42, k)) * 0.55;',
    '    band += smoothstep(0.55, 0.58, k) * (1.0 - smoothstep(0.66, 0.70, k)) * 0.40;',
    '    dens = band * uStyle;',
    '  }',
    '  if (uUseTex < 0.5) {',
    '    float cass = smoothstep(0.530, 0.552, k) * (1.0 - smoothstep(0.596, 0.620, k));',
    '    float encke = smoothstep(0.905, 0.918, k) * (1.0 - smoothstep(0.925, 0.940, k));',
    '    dens *= 1.0 - cass * 0.94;',
    '    dens *= 1.0 - encke * 0.80;',
    '  }',
    '  dens *= 0.90 + 0.10 * sin(k * 220.0);',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 L = normalize(uSunPos - vWorldPos);',
    '  vec3 V = normalize(cameraPosition - vWorldPos);',
    '  float ndl = abs(dot(N, L));',
    '  float lit = 0.30 + 0.70 * ndl;',
    '  vec3 oc = vWorldPos - uPlanetPos;',
    '  float b = dot(oc, L);',
    '  float c = dot(oc, oc) - uPlanetR * uPlanetR;',
    '  float disc = b * b - c;',
    '  float shadow = 1.0;',
    '  if (disc > 0.0) {',
    '    float tHit = -b - sqrt(disc);',
    '    if (tHit > 0.0) shadow = mix(0.06, 1.0, smoothstep(0.0, uPlanetR * 0.10, sqrt(disc)));',
    '  }',
    '  float grazing = abs(dot(N, V));',
    '  dens *= mix(0.55, 1.0, grazing);',
    '  float alpha = clamp(dens, 0.0, 1.0) * uOpacity;',
    '  if (alpha < 0.004) discard;',
    '  vec3 col = base * lit * shadow * (0.85 + 0.50 * (1.0 - grazing));',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  var ORBIT_VS = [
    'attribute float aAlpha;',
    'varying float vA;',
    'void main() {',
    '  vA = aAlpha;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var ORBIT_FS = [
    'uniform vec3 uColor;',
    'uniform float uOpacity;',
    'varying float vA;',
    'void main() {',
    '  gl_FragColor = vec4(uColor, vA * uOpacity);',
    '}'
  ].join('\n');

  /* ============================================================
   * 几何工厂（全部一次性构建，update 内不创建几何）
   * ============================================================ */

  /* 单位圆（xz 平面）：卫星轨道线共享几何的底座 */
  function circleGeometry(radius, segments) {
    var n = segments || 96;
    var pos = new Float32Array((n + 1) * 3);
    for (var i = 0; i <= n; i++) {
      var a = i / n * TAU;
      pos[i * 3] = Math.cos(a) * radius;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(a) * radius;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }

  /* 行星轨道线：按真实轨道根数采样整周期（保留偏心率），
   * 用与行星位置完全相同的 sceneRadius 映射，所以线一定穿过行星。 */
  function orbitLinesGeometry(ephem, list, segments) {
    var n = segments;
    var segCount = list.length * n;
    var pos = new Float32Array(segCount * 6);
    var alpha = new Float32Array(segCount * 2);
    var k = 0;
    var ai = 0;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var px = 0, py = 0, pz = 0;
      for (var j = 0; j <= n; j++) {
        var jd = J2000 + it.days * (j / n);
        var p = ephem.planet(it.id, jd);
        var au = (p && p.au > 1e-6) ? p.au : 1;
        var sr = sceneRadius(au);
        var x, y, z;
        if (p) {
          x = (p.x / au) * sr;
          y = (p.z / au) * sr;
          z = (-p.y / au) * sr;
        } else {
          x = sr; y = 0; z = 0;
        }
        if (j > 0) {
          pos[k++] = px; pos[k++] = py; pos[k++] = pz;
          pos[k++] = x; pos[k++] = y; pos[k++] = z;
          alpha[ai++] = it.alpha;
          alpha[ai++] = it.alpha;
        }
        px = x; py = y; pz = z;
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    return geo;
  }

  /* 环几何：径向 uv（0 内缘 → 1 外缘），单位是"行星半径倍数"，
   * 由 mesh.scale 缩放，这样 enlarge 时环自动跟着行星放大。 */
  function ringGeometry(inner, outer, segments) {
    var seg = segments || 128;
    var vcount = (seg + 1) * 2;
    var pos = new Float32Array(vcount * 3);
    var uv = new Float32Array(vcount * 2);
    var nor = new Float32Array(vcount * 3);
    var idx = [];
    for (var i = 0; i <= seg; i++) {
      var a = i / seg * TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      var vi = i * 6;
      pos[vi] = ca * inner;
      pos[vi + 1] = 0;
      pos[vi + 2] = sa * inner;
      pos[vi + 3] = ca * outer;
      pos[vi + 4] = 0;
      pos[vi + 5] = sa * outer;
      uv[i * 4] = 0;
      uv[i * 4 + 1] = 0.5;
      uv[i * 4 + 2] = 1;
      uv[i * 4 + 3] = 0.5;
      nor[vi + 1] = 1;
      nor[vi + 4] = 1;
    }
    for (i = 0; i < seg; i++) {
      var a0 = i * 2, b0 = i * 2 + 1, a1 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    return geo;
  }

  /* 一颗母行星所有卫星的轨道线合并成一个 LineSegments：
   * 顶点半径 = "母行星半径倍数"，由父级 scale 控制（enlarge 时同步放大）。 */
  function moonOrbitGeometry(ratios, segments) {
    var seg = segments || 96;
    var count = ratios.length * seg * 2;
    var pos = new Float32Array(count * 3);
    var k = 0;
    for (var i = 0; i < ratios.length; i++) {
      var rr = ratios[i];
      for (var j = 0; j < seg; j++) {
        var a0 = j / seg * TAU;
        var a1 = (j + 1) / seg * TAU;
        pos[k++] = Math.cos(a0) * rr;
        pos[k++] = 0;
        pos[k++] = Math.sin(a0) * rr;
        pos[k++] = Math.cos(a1) * rr;
        pos[k++] = 0;
        pos[k++] = Math.sin(a1) * rr;
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }

  /* ============================================================
   * 卫星程序化贴图（tex-moons.js 缺失时的兜底；一次生成、全局缓存）
   * 尺寸 low: 256×128 / high: 512×256，球面等距投影足够用。
   * ============================================================ */
  var MOON_TEX_CACHE = {};

  /* 确定性伪随机：按 kind 取种子，避免污染全局随机序列 */
  function lcg(seedStr) {
    var s = 1;
    for (var i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function css(r, g, b, a) {
    return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + a + ')';
  }

  /* 每颗卫星的底色 / 斑块 / 坑数量（颜色取自真实反照率与成分） */
  var MOON_LOOK = {
    moon: { top: [168, 164, 158], mid: [140, 136, 130], bot: [118, 114, 110],
      blob: [96, 92, 88], craters: 260, csize: 1.0 },
    phobos: { top: [104, 100, 96], mid: [86, 82, 78], bot: [72, 68, 64],
      blob: [58, 54, 50], craters: 220, csize: 1.4 },
    deimos: { top: [128, 124, 118], mid: [110, 106, 100], bot: [92, 88, 84],
      blob: [80, 76, 72], craters: 160, csize: 1.0 },
    io: { top: [232, 206, 120], mid: [226, 186, 96], bot: [208, 160, 76],
      blob: [196, 108, 52], craters: 90, csize: 0.8, sulfur: 1 },
    europa: { top: [230, 226, 216], mid: [214, 208, 196], bot: [196, 188, 176],
      blob: [150, 120, 96], craters: 40, csize: 0.6, cracks: 1 },
    ganymede: { top: [152, 144, 132], mid: [132, 124, 112], bot: [112, 104, 94],
      blob: [92, 86, 78], craters: 180, csize: 1.1, grooves: 1 },
    callisto: { top: [110, 102, 92], mid: [94, 86, 78], bot: [78, 72, 66],
      blob: [64, 58, 52], craters: 320, csize: 1.5 },
    enceladus: { top: [242, 244, 246], mid: [232, 236, 240], bot: [222, 228, 234],
      blob: [204, 214, 224], craters: 60, csize: 0.7, tiger: 1 },
    rhea: { top: [198, 196, 192], mid: [180, 178, 174], bot: [162, 160, 156],
      blob: [146, 144, 140], craters: 240, csize: 1.0 },
    titan: { top: [224, 172, 96], mid: [212, 156, 84], bot: [198, 142, 74],
      blob: [180, 128, 70], craters: 20, csize: 0.5, haze: 1 },
    triton: { top: [222, 208, 200], mid: [206, 190, 184], bot: [188, 172, 168],
      blob: [168, 150, 148], craters: 80, csize: 0.8, polar: 1 },
    charon: { top: [158, 152, 146], mid: [140, 134, 128], bot: [122, 116, 110],
      blob: [108, 100, 94], craters: 200, csize: 1.1, cap: 1 },
    pluto: { top: [196, 176, 152], mid: [176, 156, 134], bot: [152, 134, 116],
      blob: [128, 112, 98], craters: 90, csize: 0.8, heart: 1 }
  };

  function drawMoonCanvas(ctx, w, h, kind) {
    var look = MOON_LOOK[kind] || MOON_LOOK.moon;
    var rnd = lcg(kind);
    var i, n, x, y, r, a;
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(look.top[0], look.top[1], look.top[2], 1));
    g.addColorStop(0.52, css(look.mid[0], look.mid[1], look.mid[2], 1));
    g.addColorStop(1, css(look.bot[0], look.bot[1], look.bot[2], 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    /* 大尺度斑块（海 / 高地 / 硫磺沉积） */
    n = kind === 'io' ? 46 : 26;
    for (i = 0; i < n; i++) {
      x = rnd() * w;
      y = rnd() * h;
      r = (0.05 + rnd() * 0.16) * w;
      a = 0.06 + rnd() * 0.20;
      ctx.fillStyle = css(look.blob[0], look.blob[1], look.blob[2], a);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.4 + rnd() * 0.7), rnd() * Math.PI, 0, TAU);
      ctx.fill();
    }
    /* 细颗粒噪点 */
    for (i = 0; i < 2400; i++) {
      x = rnd() * w;
      y = rnd() * h;
      a = rnd() * 0.10;
      var v = rnd() < 0.5 ? 255 : 0;
      ctx.fillStyle = css(v, v, v, a);
      ctx.fillRect(x, y, 1, 1);
    }
    /* 陨石坑：暗底 + 亮边 */
    for (i = 0; i < look.craters; i++) {
      x = rnd() * w;
      y = rnd() * h;
      r = (1.2 + Math.pow(rnd(), 2.2) * 9.0) * look.csize * (w / 512);
      ctx.fillStyle = css(0, 0, 0, 0.10 + rnd() * 0.16);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = css(255, 255, 255, 0.05 + rnd() * 0.10);
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath();
      ctx.arc(x - r * 0.10, y - r * 0.10, r * 0.92, 0, TAU);
      ctx.stroke();
    }
    /* 木卫二：冰壳裂纹（细长褐线） */
    if (look.cracks) {
      ctx.strokeStyle = css(120, 92, 70, 0.42);
      for (i = 0; i < 26; i++) {
        ctx.lineWidth = 0.6 + rnd() * 1.2;
        ctx.beginPath();
        var cx = rnd() * w, cy = rnd() * h;
        ctx.moveTo(cx, cy);
        for (var s = 0; s < 5; s++) {
          cx += (rnd() - 0.5) * w * 0.22;
          cy += (rnd() - 0.5) * h * 0.30;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
    /* 木卫三：沟槽（平行浅色条纹） */
    if (look.grooves) {
      for (i = 0; i < 70; i++) {
        y = rnd() * h;
        ctx.strokeStyle = css(210, 204, 194, 0.10 + rnd() * 0.16);
        ctx.lineWidth = 0.6 + rnd() * 1.4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + (rnd() - 0.5) * h * 0.10);
        ctx.stroke();
      }
    }
    /* 木卫一：硫磺斑与火山黑点 */
    if (look.sulfur) {
      for (i = 0; i < 22; i++) {
        x = rnd() * w;
        y = rnd() * h;
        r = (0.01 + rnd() * 0.05) * w;
        ctx.fillStyle = css(206, 74, 34, 0.20 + rnd() * 0.30);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
      for (i = 0; i < 30; i++) {
        ctx.fillStyle = css(24, 18, 14, 0.55);
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, 1 + rnd() * 3, 0, TAU);
        ctx.fill();
      }
    }
    /* 土卫二：南极虎纹（四条蓝色冰裂） */
    if (look.tiger) {
      for (i = 0; i < 4; i++) {
        y = h * (0.78 + i * 0.045);
        ctx.strokeStyle = css(120, 176, 214, 0.55);
        ctx.lineWidth = 1.6 + rnd() * 2.0;
        ctx.beginPath();
        ctx.moveTo(w * (0.12 + rnd() * 0.20), y);
        ctx.bezierCurveTo(w * 0.4, y - h * 0.03, w * 0.6, y + h * 0.03, w * 0.88, y);
        ctx.stroke();
      }
    }
    /* 土卫六：橙色雾霭（整颗几乎无特征） */
    if (look.haze) {
      ctx.fillStyle = css(240, 190, 110, 0.16);
      ctx.fillRect(0, 0, w, h);
    }
    /* 海卫一：粉色极冠 */
    if (look.polar) {
      var pg = ctx.createLinearGradient(0, 0, 0, h * 0.30);
      pg.addColorStop(0, css(244, 216, 220, 0.55));
      pg.addColorStop(1, css(244, 216, 220, 0));
      ctx.fillStyle = pg;
      ctx.fillRect(0, 0, w, h * 0.30);
    }
    /* 冥卫一：北极红棕色斑块 */
    if (look.cap) {
      ctx.fillStyle = css(150, 104, 84, 0.42);
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.10, w * 0.30, h * 0.16, 0, 0, TAU);
      ctx.fill();
    }
    /* 冥王星：汤博区（心形亮斑） */
    if (look.heart) {
      ctx.fillStyle = css(236, 224, 204, 0.55);
      ctx.beginPath();
      ctx.ellipse(w * 0.44, h * 0.56, w * 0.16, h * 0.20, 0.35, 0, TAU);
      ctx.fill();
      ctx.fillStyle = css(196, 152, 120, 0.35);
      ctx.beginPath();
      ctx.ellipse(w * 0.44, h * 0.56, w * 0.10, h * 0.14, 0.35, 0, TAU);
      ctx.fill();
    }
  }

  function makeMoonTexture(kind, low) {
    var w = low ? 256 : 512;
    var h = low ? 128 : 256;
    return U.tex.canvasTexture(w, h, function (ctx) {
      drawMoonCanvas(ctx, w, h, kind);
    }, { srgb: true });
  }

  /* 卫星贴图：优先 COSMOS.TEX（tex-moons.js），缺失则程序化兜底 */
  function moonTexture(kind, low) {
    if (COSMOS.TEX && COSMOS.TEX[kind]) return U.tex.load(kind);
    if (!MOON_TEX_CACHE[kind]) MOON_TEX_CACHE[kind] = makeMoonTexture(kind, low);
    return MOON_TEX_CACHE[kind];
  }

  /* 土星环贴图：优先真实环贴图，缺失时程序化一条带缝的径向条带 */
  var PROC_RING = null;

  function makeProcRingTexture() {
    return U.tex.canvasTexture(1024, 4, function (ctx, w) {
      var img = ctx.createImageData(w, 4);
      for (var x = 0; x < w; x++) {
        var k = x / (w - 1);
        /* 三层主环带 + 卡西尼缝 + 恩克缝 */
        var dens = 0.30;
        dens += 0.55 * smoothBand(k, 0.05, 0.24, 0.02);
        dens += 0.75 * smoothBand(k, 0.26, 0.52, 0.02);
        dens += 0.85 * smoothBand(k, 0.56, 0.90, 0.02);
        dens += 0.55 * smoothBand(k, 0.93, 0.99, 0.01);
        dens *= 1.0 - 0.94 * smoothBand(k, 0.530, 0.596, 0.012);
        dens *= 1.0 - 0.85 * smoothBand(k, 0.905, 0.940, 0.008);
        dens *= 0.90 + 0.10 * Math.sin(k * 180.0);
        var c = 0.72 + 0.28 * Math.sin(k * 90.0 + 1.3);
        var r = 236 * c, g = 214 * c, b = 176 * c;
        for (var y = 0; y < 4; y++) {
          var o = (y * w + x) * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = Math.round(Math.min(1, dens) * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    }, { srgb: true });
  }

  /* 平滑环带：k 落在 [a,b] 内为 1，边缘按 f 过渡 */
  function smoothBand(k, a, b, f) {
    return smooth01((k - a + f) / (2 * f)) * (1 - smooth01((k - b + f) / (2 * f)));
  }

  function smooth01(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x * x * (3 - 2 * x);
  }

  function ringTexture(low) {
    if (COSMOS.TEX && COSMOS.TEX.saturn_ring) return U.tex.load('saturn_ring');
    if (!PROC_RING) PROC_RING = makeProcRingTexture(low);
    return PROC_RING;
  }

  /* 太阳横向光晕（镜头拉丝）：一次性 canvas 纹理 */
  var STREAK_TEX = null;

  function streakTexture() {
    if (STREAK_TEX) return STREAK_TEX;
    STREAK_TEX = U.tex.canvasTexture(256, 32, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      var g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,214,150,0)');
      g.addColorStop(0.30, 'rgba(255,214,150,0.10)');
      g.addColorStop(0.50, 'rgba(255,236,200,0.55)');
      g.addColorStop(0.70, 'rgba(255,214,150,0.10)');
      g.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      var vg = ctx.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(0.5, 'rgba(0,0,0,1)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }, { srgb: true });
    return STREAK_TEX;
  }

  /* ============================================================
   * 舞台工厂：solar
   * ============================================================ */
  COSMOS.registerStage('solar', function (ctx) {
    var low = ctx.quality === 'low';
    var pr = Math.min(ctx.pixelRatio || 1, 2);
    var width = ctx.width || 1;
    var height = ctx.height || 1;
    var seg = low ? 30 : 64;
    var atmoSeg = low ? 20 : 32;

    var D = COSMOS.DATA || {};
    var S = COSMOS.state;

    /* ---- 共享状态：boot 已建好 COSMOS.state.solar（含深链），
     *      场景只读 + 补缺失字段，绝不整体替换 ---- */
    var solar = S.solar;
    if (!solar) solar = S.solar = {};
    if (typeof solar.timeMs !== 'number') solar.timeMs = Date.now();
    if (typeof solar.daysPerSec !== 'number') solar.daysPerSec = 1;
    if (typeof solar.paused !== 'boolean') solar.paused = false;
    if (!solar.view) solar.view = 'whole';
    if (solar.labels === undefined) solar.labels = true;
    if (solar.orbits === undefined) solar.orbits = true;
    if (solar.enlarge === undefined) solar.enlarge = false;

    var EPHEM = COSMOS.ephem || FALLBACK;

    /* 共享 uniform：太阳恒在原点；时间 uniform 全场景共用一个 */
    var SUN_UNIFORM = { value: new THREE.Vector3(0, 0, 0) };
    var TIME_UNIFORM = { value: 0 };

    /* ---- 场景与相机 ---- */
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    var camera = U.makeCamera(50, ctx.aspect || (width / height));
    camera.near = 0.02;
    camera.far = 2800;
    camera.updateProjectionMatrix();

    function isNarrow() {
      return width < 860;
    }

    /* 屏幕空间平移：左文案、右控制台，主体往右上让一点 */
    function applyViewShift() {
      var sx = isNarrow() ? 0 : width * VIEW_SHIFT.x;
      var sy = height * (isNarrow() ? -0.055 : VIEW_SHIFT.y);
      camera.setViewOffset(width, height, sx, sy, width, height);
    }
    applyViewShift();

    /* ---- 星空：优先银河背景球，缺失时回退程序化星点 ---- */
    var stars = null;
    var skyDome = null;
    if (COSMOS.TEX && COSMOS.TEX.stars_milky_way) {
      var skyTex = U.tex.load('stars_milky_way');
      skyTex.wrapS = THREE.RepeatWrapping;
      skyTex.anisotropy = 4;
      var skyGeo = new THREE.SphereGeometry(1200, low ? 32 : 48, low ? 16 : 24);
      var skyMat = new THREE.MeshBasicMaterial({
        map: skyTex, side: THREE.BackSide, depthWrite: false, depthTest: false
      });
      skyDome = new THREE.Mesh(skyGeo, skyMat);
      skyDome.rotation.set(0.32, 0.65, 0.18);
      skyDome.renderOrder = -20;
      skyDome.frustumCulled = false;
      scene.add(skyDome);
      stars = COSMOS.builders.makeStarfield({ count: low ? 700 : 1400, rMin: 420, rMax: 900 });
      stars.renderOrder = -19;
    } else {
      stars = COSMOS.builders.makeStarfield({ count: low ? 1400 : 2800, rMin: 520, rMax: 1500 });
    }
    if (stars && stars.material && stars.material.uniforms && stars.material.uniforms.uPixelRatio) {
      stars.material.uniforms.uPixelRatio.value = pr;
    }
    scene.add(stars);

    /* ---- 太阳：光球（米粒/黑子/临边昏暗）+ 日冕 + 光晕 + 耀斑 ---- */
    var sunGeo = new THREE.SphereGeometry(SUN_R, seg, Math.max(16, seg >> 1));
    var sunMat = new THREE.ShaderMaterial({
      uniforms: { uTime: TIME_UNIFORM },
      vertexShader: PLANET_VS,
      fragmentShader: SUN_FS
    });
    var sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.rotation.z = 7.25 * DEG;
    scene.add(sunMesh);

    var coronaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: TIME_UNIFORM,
        uOpacity: { value: 0.85 },
        uColor: { value: new THREE.Vector3(1.70, 0.95, 0.42) },
        uDiscR: { value: 2.0 / 2.7 }
      },
      vertexShader: CORONA_VS,
      fragmentShader: CORONA_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    var corona = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), coronaMat);
    corona.scale.setScalar(SUN_R * 2.7);
    corona.renderOrder = 2;
    scene.add(corona);

    var glowTex = U.tex.glowTexture(256, '#fff4d8', 'rgba(255,150,40,0)');
    var glowNear = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffd28a, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    }));
    glowNear.scale.setScalar(SUN_R * 3.4);
    glowNear.renderOrder = 1;
    scene.add(glowNear);
    var glowFar = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffb45a, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    }));
    glowFar.scale.setScalar(SUN_R * 5.0);
    glowFar.renderOrder = 1;
    scene.add(glowFar);

    var streak = new THREE.Sprite(new THREE.SpriteMaterial({
      map: streakTexture(), color: 0xffe2b0, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    }));
    streak.scale.set(SUN_R * 6.0, SUN_R * 0.48, 1);
    streak.renderOrder = 1;
    scene.add(streak);

    var flareTex = U.tex.glowTexture(128, '#ffffff', 'rgba(255,140,40,0)');
    var flares = [];
    var fi;
    for (fi = 0; fi < 3; fi++) {
      var fsp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flareTex, color: 0xffcf8a, transparent: true, opacity: 0.25,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      }));
      var fang = fi * 2.399963;
      fsp.position.set(
        Math.cos(fang) * SUN_R * 1.03,
        Math.sin(fang * 1.7) * SUN_R * 0.55,
        Math.sin(fang) * SUN_R * 1.03
      );
      fsp.scale.setScalar(SUN_R * (0.42 + fi * 0.16));
      fsp.userData.phase = fi * 1.9;
      fsp.userData.base = 0.20 + fi * 0.06;
      fsp.renderOrder = 3;
      scene.add(fsp);
      flares.push(fsp);
    }

    /* ---- 行星 ---- */
    var sphereGeo = new THREE.SphereGeometry(1, seg, Math.max(16, seg >> 1));
    var atmoGeo = new THREE.SphereGeometry(1, atmoSeg, Math.max(12, atmoSeg >> 1));
    var moonSphereGeo = new THREE.SphereGeometry(1, low ? 18 : 28, low ? 10 : 16);

    var planetRecs = [];
    var planetById = {};
    var pickMeshes = [];

    /* 行星贴图：数据里 texture 为 null（如冥王星）时用程序化兜底 */
    function planetMap(p) {
      if (p.texture && COSMOS.TEX && COSMOS.TEX[p.texture]) return U.tex.load(p.texture);
      return moonTexture(p.id, low);
    }

    function makePlanetMaterial(p, look) {
      var defines = {};
      if (look.ocean) defines.P_OCEAN = 1;
      if (look.clouds) defines.P_CLOUDS = 1;
      if (look.night) defines.P_NIGHT = 1;
      if (look.ice) defines.P_ICE = 1;
      if (look.bands) defines.P_BANDS = 1;
      if (look.jupiter) defines.P_JUPITER = 1;
      if (look.ring && look.ring.tex) defines.P_RING = 1;

      var isEarth = p.id === 'earth';
      var uniforms = {
        uMap: { value: planetMap(p) },
        uNightMap: { value: isEarth ? U.tex.load('earth_night') : planetMap(p) },
        uCloudMap: { value: isEarth ? U.tex.load('earth_clouds') : planetMap(p) },
        uSunPos: SUN_UNIFORM,
        uTint: { value: new THREE.Vector3(look.tint[0], look.tint[1], look.tint[2]) },
        uTime: TIME_UNIFORM,
        uHover: { value: 0 },
        uOcean: { value: look.ocean || 0 },
        uCloudShadow: { value: look.cloudShadow || 0 },
        uCloudOffset: { value: 0 },
        uIce: { value: look.ice || 0 },
        uBands: { value: look.bands || 0 },
        uGrs: { value: look.grs || 0 }
      };
      if (defines.P_RING) {
        uniforms.uRingMap = { value: ringTexture(low) };
        uniforms.uRingCenter = { value: new THREE.Vector3(0, 0, 0) };
        uniforms.uRingNormal = { value: new THREE.Vector3(0, 1, 0) };
        uniforms.uRingInner = { value: 1 };
        uniforms.uRingOuter = { value: 2 };
      }
      return new THREE.ShaderMaterial({
        uniforms: uniforms,
        defines: defines,
        vertexShader: PLANET_VS,
        fragmentShader: PLANET_FS
      });
    }

    function makeAtmoMaterial(look) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uAtmoColor: { value: new THREE.Vector3(look.atmo[0], look.atmo[1], look.atmo[2]) },
          uSunPos: SUN_UNIFORM,
          uAtmoStrength: { value: look.atmoStrength || 0 }
        },
        vertexShader: ATMO_VS,
        fragmentShader: ATMO_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
    }

    function makeCloudMaterial(p) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: U.tex.load('earth_clouds') },
          uSunPos: SUN_UNIFORM,
          uOpacity: { value: 0.62 }
        },
        vertexShader: CLOUD_VS,
        fragmentShader: CLOUD_FS,
        transparent: true,
        depthWrite: false
      });
    }

    function makeRingMaterial(look) {
      var useTex = look.ring.tex ? 1 : 0;
      return new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: useTex ? ringTexture(low) : U.tex.load('sun') },
          uUseTex: { value: useTex },
          uStyle: { value: 1 },
          uTint: { value: new THREE.Vector3(look.ring.tint[0], look.ring.tint[1], look.ring.tint[2]) },
          uSunPos: SUN_UNIFORM,
          uPlanetPos: { value: new THREE.Vector3(0, 0, 0) },
          uPlanetR: { value: 1 },
          uOpacity: { value: look.ring.opacity || 1 }
        },
        vertexShader: RING_VS,
        fragmentShader: RING_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      });
    }

    /* 行星列表：8 颗行星 + 冥王星（§6 天体列表） */
    var allPlanets = [];
    var ai;
    if (D.planets) for (ai = 0; ai < D.planets.length; ai++) allPlanets.push(D.planets[ai]);
    if (D.dwarfPlanets) {
      for (ai = 0; ai < D.dwarfPlanets.length; ai++) {
        if (D.dwarfPlanets[ai].id === 'pluto') allPlanets.push(D.dwarfPlanets[ai]);
      }
    }

    var pi;
    for (pi = 0; pi < allPlanets.length; pi++) {
      var pd = allPlanets[pi];
      var look = LOOK[pd.id] || LOOK.mercury;
      var rec = {
        id: pd.id,
        data: pd,
        look: look,
        r: bodyRadius(pd.diameterKm),
        pivot: new THREE.Object3D(),
        tilt: new THREE.Object3D(),
        hover: 0,
        spin0: pi * 0.73,
        atmo: null,
        clouds: null,
        ring: null,
        ringMat: null
      };
      rec.pivot.name = 'p-' + pd.id;
      rec.tilt.rotation.z = (pd.tilt || 0) * DEG;

      var mat = makePlanetMaterial(pd, look);
      rec.mat = mat;
      rec.mesh = new THREE.Mesh(sphereGeo, mat);
      rec.mesh.scale.setScalar(rec.r);
      rec.mesh.userData.pid = pd.id;
      rec.mesh.userData.kind = 'planet';
      rec.tilt.add(rec.mesh);
      pickMeshes.push(rec.mesh);

      if (look.atmoStrength > 0.02) {
        var atmoMat = makeAtmoMaterial(look);
        rec.atmo = new THREE.Mesh(atmoGeo, atmoMat);
        rec.atmo.scale.setScalar(rec.r * 1.045);
        rec.tilt.add(rec.atmo);
      }
      if (look.clouds) {
        rec.clouds = new THREE.Mesh(atmoGeo, makeCloudMaterial(pd));
        rec.clouds.scale.setScalar(rec.r * 1.018);
        rec.tilt.add(rec.clouds);
      }
      if (look.ring) {
        var rg = ringGeometry(look.ring.inner, look.ring.outer, low ? 96 : 180);
        var ringMat = makeRingMaterial(look);
        rec.ring = new THREE.Mesh(rg, ringMat);
        rec.ring.scale.setScalar(rec.r);
        rec.ring.renderOrder = 1;
        rec.ringMat = ringMat;
        rec.tilt.add(rec.ring);
      }

      rec.pivot.add(rec.tilt);
      scene.add(rec.pivot);
      planetRecs.push(rec);
      planetById[pd.id] = rec;
    }

    /* 行星光点：默认全系统视图下行星本体只有几个像素，
     * 用小点保证 8 颗行星在默认视角下都可见（共 1 个 draw call） */
    var DOT_COLORS = {
      mercury: [0.72, 0.70, 0.66], venus: [1.0, 0.93, 0.72], earth: [0.42, 0.64, 1.0],
      mars: [1.0, 0.48, 0.30], jupiter: [1.0, 0.82, 0.55], saturn: [1.0, 0.90, 0.62],
      uranus: [0.62, 0.90, 0.95], neptune: [0.45, 0.62, 1.0], pluto: [0.80, 0.70, 0.62]
    };
    var dotPos = new Float32Array(planetRecs.length * 3);
    var dotCol = new Float32Array(planetRecs.length * 3);
    for (pi = 0; pi < planetRecs.length; pi++) {
      var dc = DOT_COLORS[planetRecs[pi].id] || [1, 1, 1];
      dotCol[pi * 3] = dc[0];
      dotCol[pi * 3 + 1] = dc[1];
      dotCol[pi * 3 + 2] = dc[2];
    }
    var dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    dotGeo.setAttribute('color', new THREE.BufferAttribute(dotCol, 3));
    var dotMat = new THREE.PointsMaterial({
      size: low ? 5 : 6, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false
    });
    var planetDots = new THREE.Points(dotGeo, dotMat);
    planetDots.frustumCulled = false;
    planetDots.renderOrder = 4;
    scene.add(planetDots);

    /* ============================================================
     * 卫星：D.moons 优先（Lead 已加入 data.js），缺失用内置兜底。
     * 距离压缩到 4.5–8 × 母行星半径（单卫星行星取 5.8），保持真实顺序。
     * ============================================================ */
    var moonRecs = [];
    var moonById = {};
    var moonOrbitGroups = [];

    var moonDataList = (D.moons && D.moons.length) ? D.moons : MOON_FALLBACK;
    var byParent = {};
    var parentOrder = [];
    var mi;
    for (mi = 0; mi < moonDataList.length; mi++) {
      var md0 = moonDataList[mi];
      if (!byParent[md0.parent]) {
        byParent[md0.parent] = [];
        parentOrder.push(md0.parent);
      }
      byParent[md0.parent].push(md0);
    }

    for (var poi = 0; poi < parentOrder.length; poi++) {
      var parentId = parentOrder[poi];
      var parentRec = planetById[parentId];
      if (!parentRec) continue;
      var mlist = byParent[parentId];
      /* 按真实平均距离排序，保证压缩后顺序不变 */
      mlist.sort(function (a, b) {
        return (a.distanceKm || 0) - (b.distanceKm || 0);
      });
      var mn = mlist.length;
      var ratios = [];
      for (var ri = 0; ri < mn; ri++) {
        ratios.push(mn === 1 ? 5.8 : 4.5 + 3.5 * (ri / (mn - 1)));
      }

      /* 该母行星所有卫星的轨道线合并成 1 个 LineSegments（挂 pivot，随行星平移） */
      var mOrbitGeo = moonOrbitGeometry(ratios, low ? 48 : 96);
      var mOrbitMat = new THREE.LineBasicMaterial({
        color: 0x3a4a63, transparent: true, opacity: 0.30, depthWrite: false
      });
      var mLines = new THREE.LineSegments(mOrbitGeo, mOrbitMat);
      mLines.scale.setScalar(parentRec.r);
      mLines.frustumCulled = false;
      parentRec.pivot.add(mLines);
      moonOrbitGroups.push({ rec: parentRec, lines: mLines });

      for (ri = 0; ri < mn; ri++) {
        var mdat = mlist[ri];
        var mtex = moonTexture(mdat.texture || mdat.id, low);
        var mmat = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: mtex },
            uNightMap: { value: mtex },
            uCloudMap: { value: mtex },
            uSunPos: SUN_UNIFORM,
            uTint: { value: new THREE.Vector3(1, 1, 1) },
            uTime: TIME_UNIFORM,
            uHover: { value: 0 },
            uOcean: { value: 0 },
            uCloudShadow: { value: 0 },
            uCloudOffset: { value: 0 },
            uIce: { value: 0 },
            uBands: { value: 0 },
            uGrs: { value: 0 }
          },
          vertexShader: PLANET_VS,
          fragmentShader: PLANET_FS
        });
        var mrec = {
          id: mdat.id,
          data: mdat,
          parent: parentRec,
          ratio: ratios[ri],
          r: Math.max(bodyRadius(mdat.diameterKm || (mdat.radiusKm * 2)), 0.05),
          mesh: null,
          mat: mmat
        };
        mrec.mesh = new THREE.Mesh(moonSphereGeo, mmat);
        mrec.mesh.scale.setScalar(mrec.r);
        mrec.mesh.userData.pid = mdat.id;
        mrec.mesh.userData.kind = 'moon';
        mrec.mesh.userData.parent = parentId;
        parentRec.pivot.add(mrec.mesh);
        pickMeshes.push(mrec.mesh);
        moonRecs.push(mrec);
        moonById[mdat.id] = mrec;
      }
    }

    /* ============================================================
     * 行星轨道线：按真实根数采样整周期（保留偏心率），1 个 draw call
     * ============================================================ */
    var orbitList = [];
    for (pi = 0; pi < planetRecs.length; pi++) {
      orbitList.push({
        id: planetRecs[pi].id,
        days: planetRecs[pi].data.yearDays || 365.25,
        alpha: Math.max(0.55, 1.0 - pi * 0.045)
      });
    }
    var orbitGeo = orbitLinesGeometry(EPHEM, orbitList, low ? 96 : 192);
    var orbitMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(0.22, 0.32, 0.46) },
        uOpacity: { value: 0.62 }
      },
      vertexShader: ORBIT_VS,
      fragmentShader: ORBIT_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var orbitGroup = new THREE.LineSegments(orbitGeo, orbitMat);
    orbitGroup.frustumCulled = false;
    scene.add(orbitGroup);

    /* ============================================================
     * 小行星带（2.1–3.3 AU，含柯克伍德空隙）+ 尘埃 + 柯伊伯带（30–50 AU）
     * ============================================================ */
    var beltCount = low ? 700 : 1500;
    var beltGeo = new THREE.IcosahedronGeometry(1, 0);
    var beltMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var belt = new THREE.InstancedMesh(beltGeo, beltMat, beltCount);
    belt.frustumCulled = false;
    var beltDummy = new THREE.Object3D();
    var beltColor = new THREE.Color();
    var GAPS_AU = [2.50, 2.82, 2.95, 3.27];
    var bi = 0;
    while (bi < beltCount) {
      var bAu = 2.1 + Math.random() * 1.2;
      var skip = false;
      for (var gi = 0; gi < GAPS_AU.length; gi++) {
        if (Math.abs(bAu - GAPS_AU[gi]) < 0.035) { skip = true; break; }
      }
      if (skip) continue;
      var bAng = Math.random() * TAU;
      var bR = sceneRadius(bAu) + (Math.random() - 0.5) * 0.10;
      beltDummy.position.set(
        Math.cos(bAng) * bR,
        (Math.random() - 0.5) * 0.16,
        Math.sin(bAng) * bR
      );
      beltDummy.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
      beltDummy.scale.setScalar(0.006 + Math.pow(Math.random(), 2) * 0.030);
      beltDummy.updateMatrix();
      belt.setMatrixAt(bi, beltDummy.matrix);
      var bShade = 0.16 + Math.random() * 0.18;
      beltColor.setRGB(bShade, bShade * 0.92, bShade * 0.80);
      belt.setColorAt(bi, beltColor);
      bi++;
    }
    belt.instanceMatrix.needsUpdate = true;
    if (belt.instanceColor) belt.instanceColor.needsUpdate = true;
    scene.add(belt);

    var dustCount = low ? 1200 : 2600;
    var dustPos = new Float32Array(dustCount * 3);
    for (var di = 0; di < dustCount; di++) {
      var dAng = Math.random() * TAU;
      var dR = sceneRadius(2.05 + Math.random() * 1.35) + (Math.random() - 0.5) * 0.16;
      dustPos[di * 3] = Math.cos(dAng) * dR;
      dustPos[di * 3 + 1] = (Math.random() - 0.5) * 0.22;
      dustPos[di * 3 + 2] = Math.sin(dAng) * dR;
    }
    var dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    var dustMat = new THREE.PointsMaterial({
      color: 0x8f826d, size: 0.07, transparent: true, opacity: 0.15,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    var dust = new THREE.Points(dustGeo, dustMat);
    dust.frustumCulled = false;
    scene.add(dust);

    var KUIPER_VS = [
      'attribute vec3 aColor;',
      'uniform float uPR;',
      'varying vec3 vColor;',
      'varying float vFade;',
      'void main() {',
      '  vColor = aColor;',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  gl_PointSize = 0.22 * uPR * (330.0 / max(-mv.z, 1.0));',
      '  vFade = clamp(1.0 - (-mv.z) / 900.0, 0.15, 1.0);',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n');
    var KUIPER_FS = [
      'uniform float uOpacity;',
      'varying vec3 vColor;',
      'varying float vFade;',
      'void main() {',
      '  vec2 c = gl_PointCoord - 0.5;',
      '  float d = 1.0 - smoothstep(0.18, 0.5, length(c));',
      '  if (d < 0.02) discard;',
      '  gl_FragColor = vec4(vColor, d * vFade * uOpacity);',
      '}'
    ].join('\n');

    var kuiperCount = low ? 3600 : 9000;
    var kPos = new Float32Array(kuiperCount * 3);
    var kCol = new Float32Array(kuiperCount * 3);
    for (var ki = 0; ki < kuiperCount; ki++) {
      var kAng = Math.random() * TAU;
      var kR = sceneRadius(30 + Math.pow(Math.random(), 0.85) * 20) + (Math.random() - 0.5) * 0.5;
      kPos[ki * 3] = Math.cos(kAng) * kR;
      kPos[ki * 3 + 1] = (Math.random() - 0.5) * 1.6;
      kPos[ki * 3 + 2] = Math.sin(kAng) * kR;
      var kv = 0.35 + Math.random() * 0.35;
      kCol[ki * 3] = kv;
      kCol[ki * 3 + 1] = kv * 0.96;
      kCol[ki * 3 + 2] = kv * 0.88;
    }
    var kuiperGeo = new THREE.BufferGeometry();
    kuiperGeo.setAttribute('position', new THREE.BufferAttribute(kPos, 3));
    kuiperGeo.setAttribute('aColor', new THREE.BufferAttribute(kCol, 3));
    var kuiperMat = new THREE.ShaderMaterial({
      uniforms: { uPR: { value: pr }, uOpacity: { value: 0.32 } },
      vertexShader: KUIPER_VS,
      fragmentShader: KUIPER_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var kuiper = new THREE.Points(kuiperGeo, kuiperMat);
    kuiper.frustumCulled = false;
    scene.add(kuiper);

    /* ============================================================
     * 相机与交互状态
     * ============================================================ */
    var TIME_MIN = Date.UTC(1600, 0, 1);
    var TIME_MAX = Date.UTC(2400, 0, 1);

    var cam = {
      yaw: DEF.yaw,
      pitch: DEF.pitch,
      dist: DEF.dist,
      distTarget: DEF.dist,
      mode: solar.view || 'whole',
      /* 点击天体后的「朝星球推进」飞行状态：{ u0, u1, r0, r1, t, dur, q } */
      flight: null
    };
    var center = new THREE.Vector3(0, 0, 0);
    var centerTarget = new THREE.Vector3(0, 0, 0);
    var focus = { id: null, kind: null, rec: null };
    var hoverId = null;
    var labelHoverId = null;
    var widgetHoverId = null;
    var shakeT = 0;
    var vy = 0;
    var vp = 0;
    var _v = new THREE.Vector3();
    var _v2 = new THREE.Vector3();
    var _v3 = new THREE.Vector3();
    var _v4 = new THREE.Vector3();
    var _fdir = new THREE.Vector3();
    var _q = new THREE.Quaternion();

    function findBody(id) {
      if (!id) return null;
      if (id === 'sun') return { kind: 'sun', rec: null };
      if (planetById[id]) return { kind: 'planet', rec: planetById[id] };
      if (moonById[id]) return { kind: 'moon', rec: moonById[id] };
      return null;
    }

    /* 当前焦点的世界坐标（行星 = pivot；卫星 = 母行星 pivot + 局部位置） */
    function focusWorldPos(out) {
      if (!focus.rec) return out.set(0, 0, 0);
      if (focus.kind === 'planet') return out.copy(focus.rec.pivot.position);
      if (focus.kind === 'moon') {
        return out.copy(focus.rec.parent.pivot.position).add(focus.rec.mesh.position);
      }
      return out.set(0, 0, 0);
    }

    function focusDistance() {
      var enlargeFactor = solar.enlarge ? ENLARGE : 1;
      if (!focus.rec) return VIEW_DIST.planet;
      /* 按当前显示半径取值：enlarge 打开后显示半径会放大 ENLARGE 倍 */
      if (focus.kind === 'moon') {
        /* 卫星：14 倍显示半径 → 无论本体多小，屏幕上直径都约 110px，保证看得清。
           相机位于卫星「远离母行星」一侧，母行星自然落在背景，不会钻进母行星 */
        var moonR = focus.rec.r * enlargeFactor;
        return Math.max(moonR * 14, 1.2);
      }
      /* 行星取 4.8 倍显示半径 → 屏幕上直径约占 52% 视高，点开即「缩进」到星球跟前。
         早先取 8 倍只有 27%，看着像退到远处望一个小球，不像凑近看。 */
      var base = Math.max(focus.rec.r * enlargeFactor * 4.8, 0.35);
      /* 相机不能越过太阳：距离上限 = 行星日心距 0.8 倍（否则太阳会跑到镜头前） */
      var orbitR = focus.rec.pivot.position.length();
      if (orbitR < 1) orbitR = sceneRadius(focus.rec.data.au);
      var cap = orbitR * 0.8;
      var minR = focus.rec.r * enlargeFactor * 2.2;
      if (cap < base) base = Math.max(cap, minR);
      return base;
    }

    /* planet 视图初始朝向：把相机放到「受光侧」，保证首帧看到被照亮的一面。
       行星：从行星指向太阳的方向；卫星：母行星→卫星的延长线（母行星落在背景），
       若卫星处于母行星背光侧则改为侧视，避免正对暗面。 */
    function faceSun(rec, kind) {
      var target = _v2;
      if (kind === 'moon') {
        target.copy(rec.parent.pivot.position).add(rec.mesh.position);
        /* 母行星→卫星（mesh.position 是母行星本地偏移，方向即世界方向） */
        _v3.copy(rec.mesh.position);
        if (_v3.lengthSq() < 1e-8) _v3.set(1, 0, 0);
        _v3.normalize();
        /* 卫星→太阳（太阳在原点） */
        _v4.copy(target).negate();
        if (_v4.lengthSq() < 1e-8) _v4.set(0, 0, 1);
        _v4.normalize();
        if (_v3.dot(_v4) < -0.2) {
          /* 卫星在母行星背光侧：从侧面看，看到半明半暗而不是整个夜面 */
          _v3.set(-_v3.z, 0, _v3.x);
          if (_v3.lengthSq() < 1e-8) _v3.set(1, 0, 0);
          _v3.normalize();
          if (_v3.dot(_v4) < 0) _v3.negate();
        } else {
          /* 向阳侧：略偏太阳，确保卫星受光，母行星仍在画面背景 */
          _v3.multiplyScalar(0.75).add(_v4.multiplyScalar(0.45)).normalize();
        }
        _v3.y += 0.18;
        _v3.normalize();
        cam.yaw = Math.atan2(_v3.x, _v3.z);
        cam.pitch = U.clamp(Math.asin(U.clamp(_v3.y, -1, 1)), LIMIT.pitchMin, LIMIT.pitchMax);
        vy = 0;
        vp = 0;
        return;
      }
      /* 行星：从目标指向太阳（太阳在原点），再抬高一点，避免正对赤道 */
      target.copy(rec.pivot.position);
      _v3.copy(target).negate();
      if (_v3.lengthSq() < 1e-8) _v3.set(0, 0, 1);
      _v3.normalize().multiplyScalar(0.8);
      _v3.y += 0.45;
      _v3.normalize();
      cam.yaw = Math.atan2(_v3.x, _v3.z);
      cam.pitch = U.clamp(Math.asin(U.clamp(_v3.y, -1, 1)), LIMIT.pitchMin, LIMIT.pitchMax);
      /* 清掉残留惯性，避免切到 planet 后镜头继续飘走 */
      vy = 0;
      vp = 0;
    }

    /* 点击天体后的「朝星球推进」飞行：
       相机相对目标天体做球面插值——半径 r0→r1、方位 u0→u1（slerp），
       路径始终留在天体外的球面上，不会横穿内太阳系被太阳挡住；
       同时视线中心钉住目标天体，画面表现为「星球在中央逐渐放大」，
       而不是沿原视线往前缩放。 */
    function startFlight() {
      if (!focus.rec || (focus.kind !== 'planet' && focus.kind !== 'moon')) {
        cam.flight = null;
        return;
      }
      var target = focusWorldPos(_v2);
      var r0 = camera.position.distanceTo(target);
      var r1 = Math.max(cam.distTarget, 0.05);
      /* 已经在目标附近（重复点同一颗）：交给原有距离 damp，避免来回抖动 */
      if (r0 < r1 * 1.15) {
        cam.flight = null;
        return;
      }
      var fromDir = _v.copy(camera.position).sub(target);
      if (fromDir.lengthSq() < 1e-8) fromDir.set(Math.sin(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.yaw));
      fromDir.normalize();
      var cp = Math.cos(cam.pitch);
      var toDir = new THREE.Vector3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp).normalize();
      cam.flight = {
        u0: fromDir.clone(),
        u1: toDir,
        r0: r0,
        r1: r1,
        t: 0,
        /* 跨度越大飞得越久，0.60s–0.78s（不越过 §2.5 的 800ms 入场上限） */
        dur: U.clamp(0.55 + Math.log(Math.max(r0 / r1, 1.0001)) * 0.10, 0.60, 0.78),
        q: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir)
      };
    }

    function updateFlight(dt, introMul) {
      var f = cam.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      var e = f.t < 0.5 ? 2 * f.t * f.t : 1 - 2 * (1 - f.t) * (1 - f.t);
      var r = f.r0 + (f.r1 - f.r0) * e;
      _q.identity().slerp(f.q, e);
      _fdir.copy(f.u0).applyQuaternion(_q);
      /* center 已在 update 里钉住目标天体，这里只沿球面推进 */
      camera.position.copy(center).addScaledVector(_fdir, r * introMul);
      /* 同步回模型参数：飞行结束交还阻尼模型时位置连续，不瞬移 */
      cam.dist = r;
      cam.yaw = Math.atan2(_fdir.x, _fdir.z);
      cam.pitch = U.clamp(Math.asin(U.clamp(_fdir.y, -1, 1)), LIMIT.pitchMin, LIMIT.pitchMax);
      if (f.t >= 1) cam.flight = null;
    }

    function clearFocus(clearState) {
      cam.flight = null;
      focus.id = null;
      focus.kind = null;
      focus.rec = null;
      centerTarget.set(0, 0, 0);
      if (clearState) {
        solar.focus = null;
        solar.selected = null;
      }
      if (cam.mode === 'planet') {
        cam.mode = 'whole';
        solar.view = 'whole';
        cam.distTarget = VIEW_DIST.whole;
      }
    }

    /* 选中天体：写状态、切 planet 视图、相机 damp 跟随（不瞬移） */
    function selectBody(id, emitFocus) {
      var found = findBody(id);
      if (!found) {
        clearFocus(true);
        return;
      }
      focus.id = id;
      focus.kind = found.kind;
      focus.rec = found.rec;
      solar.focus = id;
      solar.selected = id;
      if (found.kind === 'planet' || found.kind === 'moon') {
        cam.mode = 'planet';
        solar.view = 'planet';
        cam.distTarget = focusDistance();
        centerTarget.copy(focusWorldPos(_v2));
        /* 初始朝向向阳侧，避免相机落在夜面导致「全黑」 */
        faceSun(found.rec, found.kind);
        /* 从当前机位绕行推进到目标天体（不横穿太阳系中心） */
        startFlight();
      } else {
        /* 太阳：只居中，不切档 */
        centerTarget.set(0, 0, 0);
        cam.distTarget = Math.max(cam.distTarget, VIEW_DIST.inner);
      }
      if (emitFocus !== false) COSMOS.emit('solar:focus', { id: id });
    }

    function setView(mode) {
      if (mode !== 'whole' && mode !== 'inner' && mode !== 'planet' && mode !== 'free') return;
      cam.flight = null;
      cam.mode = mode;
      solar.view = mode;
      if (mode === 'whole') {
        clearFocus(true);
        centerTarget.set(0, 0, 0);
        cam.distTarget = VIEW_DIST.whole;
      } else if (mode === 'inner') {
        centerTarget.set(0, 0, 0);
        cam.distTarget = VIEW_DIST.inner;
      } else if (mode === 'planet') {
        if (!focus.rec) {
          var e = planetById['earth'];
          if (e) {
            selectBody('earth', false);
          } else {
            cam.distTarget = VIEW_DIST.planet;
          }
        } else {
          cam.distTarget = focusDistance();
          faceSun(focus.rec, focus.kind);
        }
      }
      /* free：保留当前距离，只切模式 */
    }

    /* Esc / 复位：默认时间 + 默认视角 + 默认相机 */
    function reset() {
      solar.timeMs = Date.now();
      solar.daysPerSec = 1;
      solar.paused = false;
      solar.view = 'whole';
      solar.focus = null;
      solar.selected = null;
      solar.enlarge = false;
      solar.labels = true;
      solar.orbits = true;
      cam.yaw = DEF.yaw;
      cam.pitch = DEF.pitch;
      cam.dist = DEF.dist;
      cam.distTarget = DEF.dist;
      cam.mode = 'whole';
      cam.flight = null;
      center.set(0, 0, 0);
      centerTarget.set(0, 0, 0);
      vy = 0;
      vp = 0;
      shakeT = 0;
      clearFocus(true);
    }

    /* ---- solar:cmd（契约 §4.3 全类型）---- */
    function onCmd(payload) {
      if (!payload || !payload.type) return;
      var type = payload.type;
      if (type === 'view') {
        setView(payload.view);
      } else if (type === 'focus' || type === 'select') {
        if (payload.id) selectBody(payload.id, false);
      } else if (type === 'zoom') {
        var dir = (typeof payload.dir === 'number') ? payload.dir : 1;
        cam.distTarget = U.clamp(cam.distTarget * (dir > 0 ? 0.82 : 1.22), LIMIT.distMin, LIMIT.distMax);
        cam.mode = 'free';
        solar.view = 'free';
      } else if (type === 'reset') {
        reset();
      } else if (type === 'goto') {
        var ms = payload.timeMs;
        if (typeof ms === 'number' && isFinite(ms)) solar.timeMs = U.clamp(ms, TIME_MIN, TIME_MAX);
      } else if (type === 'enlarge') {
        solar.enlarge = payload.on !== false;
      } else if (type === 'shake') {
        shakeT = 0.6;
      }
    }

    var offCmd = COSMOS.on('solar:cmd', onCmd);
    var offZoom = COSMOS.on('solar:zoom', function (p) {
      var dir = (p && typeof p.dir === 'number') ? p.dir : 1;
      cam.distTarget = U.clamp(cam.distTarget * (dir > 0 ? 0.82 : 1.22), LIMIT.distMin, LIMIT.distMax);
      cam.mode = 'free';
      solar.view = 'free';
    });
    var offReset = COSMOS.on('solar:reset', function () { reset(); });
    var offHover = COSMOS.on('solar:hover', function (p) {
      var id = (p && p.id) ? p.id : null;
      /* 自己 emit 的事件（id 与当前 hoverId 相同）不回灌，避免抖动 */
      if (id !== hoverId) widgetHoverId = id;
    });

    /* ============================================================
     * 标签层 #sol-labels（body 级 DOM，场景接管）
     * 结构沿用 css/solar.css：span.sol-label > i.sol-label-dot + b.sol-label-name
     * 状态类：is-off（隐藏）/ is-hot（hover）/ is-active（选中）
     * ============================================================ */
    var canvas = ctx.renderer.domElement;
    var labelsRoot = document.getElementById('sol-labels');
    if (!labelsRoot) {
      labelsRoot = document.createElement('div');
      labelsRoot.id = 'sol-labels';
      labelsRoot.className = 'sol-labels';
      labelsRoot.setAttribute('aria-hidden', 'true');
      document.body.appendChild(labelsRoot);
    }
    /* 章节未激活时整层隐藏（层在 section 之上，否则会漏到别章） */
    labelsRoot.style.display = 'none';

    var labelItems = [];
    var labelPlaced = new Float32Array(64);   /* 每帧已放置矩形 x,y,w,h */
    var labelCount = 0;

    function createLabel(id, name, kind, rec) {
      var el = document.createElement('span');
      el.className = 'sol-label';
      el.setAttribute('data-ui', '1');
      el.setAttribute('data-body', id);
      var dot = document.createElement('i');
      dot.className = 'sol-label-dot';
      var nm = document.createElement('b');
      nm.className = 'sol-label-name';
      nm.textContent = name;
      el.appendChild(dot);
      el.appendChild(nm);
      /* CSS 父层是 pointer-events:none，这里单独打开标签的点击/悬停 */
      el.style.pointerEvents = 'auto';
      labelsRoot.appendChild(el);

      var item = {
        id: id,
        kind: kind,
        rec: rec,
        el: el,
        w: name.length > 3 ? 70 : 58,
        h: 26,
        x: 0,
        y: 0,
        shown: false,
        hot: false,
        active: false,
        world: new THREE.Vector3()
      };
      /* 用真实 DOM 尺寸做避让，字号/双语名长度变化都不再估错 */
      if (el.offsetWidth) item.w = Math.max(44, el.offsetWidth);
      if (el.offsetHeight) item.h = Math.max(24, el.offsetHeight);
      (function (it) {
        el.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          selectBody(it.id, true);
        });
        el.addEventListener('mouseenter', function () { labelHoverId = it.id; });
        el.addEventListener('mouseleave', function () {
          if (labelHoverId === it.id) labelHoverId = null;
        });
      })(item);
      labelItems.push(item);
      return item;
    }

    var li;
    for (li = 0; li < planetRecs.length; li++) {
      createLabel(
        planetRecs[li].id,
        planetRecs[li].data.name || planetRecs[li].id,
        'planet',
        planetRecs[li]
      );
    }
    for (li = 0; li < moonRecs.length; li++) {
      createLabel(
        moonRecs[li].id,
        moonRecs[li].data.name || moonRecs[li].id,
        'moon',
        moonRecs[li]
      );
    }
    createLabel('sun', (D.sun && D.sun.name) ? D.sun.name : '太阳', 'sun', null);

    /* 同帧投影 + 矩形避让（每帧写 transform，CSS 已 will-change） */
    function updateLabels() {
      /* 场景只在激活时 update；若进入时 build 晚于 enter，这里兜底显示标签层 */
      if (labelsRoot && labelsRoot.style.display === 'none') labelsRoot.style.display = '';
      var labelsOn = solar.labels !== false;
      var placed = 0;
      var i, j;
      for (i = 0; i < labelItems.length; i++) {
        var it = labelItems[i];
        var vis = false;
        if (labelsOn) {
          if (it.kind === 'planet') {
            it.world.copy(it.rec.pivot.position);
          } else if (it.kind === 'moon') {
            it.world.copy(it.rec.parent.pivot.position).add(it.rec.mesh.position);
          } else {
            it.world.set(0, 0, 0);
          }
          _v.copy(it.world).project(camera);
          var sx = (_v.x * 0.5 + 0.5) * width;
          var sy = (-_v.y * 0.5 + 0.5) * height;
          var inFront = _v.z > -1 && _v.z < 1;
          var onScreen = sx > -24 && sx < width + 24 && sy > -24 && sy < height + 24;
          if (inFront && onScreen) {
            it.x = sx;
            it.y = sy;
            if (it.kind === 'moon') {
              /* 卫星名：聚焦其母行星/该卫星，或相机足够近时才显示 */
              var near = camera.position.distanceTo(it.world) < 6.5;
              var focusedHere = false;
              if (focus.rec) {
                if (focus.kind === 'moon') focusedHere = (it.rec.parent === focus.rec.parent);
                else if (focus.kind === 'planet') focusedHere = (it.rec.parent === focus.rec);
              }
              vis = near || focusedHere;
            } else {
              vis = true;
            }
          }
        }
        if (vis) {
          var lx = it.x + 9;
          var ly = it.y - 10;
          if (lx < 6) lx = 6;
          if (lx + it.w > width - 6) lx = width - 6 - it.w;
          if (ly < 6) ly = 6;
          if (ly + it.h > height - 6) ly = height - 6 - it.h;
          /* 避让：行星标签优先（多试几次），卫星标签放不下直接隐藏 */
          var tries = it.kind === 'planet' ? 8 : (it.kind === 'moon' ? 4 : 6);
          var fits = false;
          var attempt;
          for (attempt = 0; attempt < tries; attempt++) {
            var overlap = false;
            for (j = 0; j < placed; j++) {
              var px = labelPlaced[j * 4];
              var py = labelPlaced[j * 4 + 1];
              var pw = labelPlaced[j * 4 + 2];
              var ph = labelPlaced[j * 4 + 3];
              /* 标签之间至少留 4px 间距，避免贴成一片 */
              if (lx < px + pw + 4 && lx + it.w + 4 > px &&
                ly < py + ph + 4 && ly + it.h + 4 > py) {
                overlap = true;
                break;
              }
            }
            if (!overlap) { fits = true; break; }
            ly += it.h + 4;
            if (ly + it.h > height - 6) {
              ly = it.y - 10;
              break;
            }
          }
          if (!fits && it.kind === 'moon') {
            vis = false;
          } else {
            labelPlaced[placed * 4] = lx;
            labelPlaced[placed * 4 + 1] = ly;
            labelPlaced[placed * 4 + 2] = it.w;
            labelPlaced[placed * 4 + 3] = it.h;
            placed++;
            it.el.style.transform = 'translate3d(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px,0)';
          }
        }
        if (it.shown !== vis) {
          it.shown = vis;
          if (vis) it.el.classList.remove('is-off');
          else it.el.classList.add('is-off');
        }
        var hot = (hoverId === it.id || widgetHoverId === it.id || labelHoverId === it.id);
        if (it.hot !== hot) {
          it.hot = hot;
          if (hot) it.el.classList.add('is-hot');
          else it.el.classList.remove('is-hot');
        }
        var active = (solar.selected === it.id);
        if (it.active !== active) {
          it.active = active;
          if (active) it.el.classList.add('is-active');
          else it.el.classList.remove('is-active');
        }
      }
      labelCount = placed;
    }

    /* 鼠标 hover：取屏幕距离最近的天体（36px，与扩大后的标签热区匹配），变化时才 emit */
    function updateHover() {
      var input = ctx.input;
      var next = null;
      if (input && !input.uiTarget) {
        var mx = input.x;
        var my = input.y;
        var best = 36;
        var i;
        for (i = 0; i < labelItems.length; i++) {
          var it = labelItems[i];
          if (!it.shown) continue;
          var dx = it.x - mx;
          var dy = it.y - my;
          var d2 = dx * dx + dy * dy;
          if (d2 < best * best) {
            best = Math.sqrt(d2);
            next = it.id;
          }
        }
      }
      if (labelHoverId) next = labelHoverId;
      if (widgetHoverId) next = widgetHoverId;
      if (next !== hoverId) {
        hoverId = next;
        if (canvas) canvas.style.cursor = hoverId ? 'pointer' : 'grab';
        COSMOS.emit('solar:hover', { id: hoverId });
      }
    }

    /* 点击：先 raycast 天体，再退回 hover 目标；空白处取消选中 */
    function handleClick() {
      var input = ctx.input;
      var click = input && input.click;
      if (!click || input.uiTarget) return;
      var hit = U.pick(pickMeshes, camera, click.nx, click.ny);
      var id = null;
      if (hit && hit.object && hit.object.userData) id = hit.object.userData.pid || null;
      if (!id) id = hoverId;
      if (id) {
        selectBody(id, true);
      } else {
        clearFocus(true);
      }
    }

    /* ============================================================
     * solar:tick（8Hz）：太阳 + 8 行星的日心距 / 地心距 / 光行时
     * payload 与 bodies 全部预建复用（ui 读值即用，不长期持引用）
     * ============================================================ */
    var planetPos = {};
    for (pi = 0; pi < planetRecs.length; pi++) {
      planetPos[planetRecs[pi].id] = { x: 0, y: 0, z: 0, au: 1 };
    }

    var tickTimer = 0;
    var tickPayload = { timeMs: 0, jd: 0, bodies: [] };
    var tickBodies = [];
    (function () {
      var ids = ['sun'];
      var i;
      for (i = 0; i < planetRecs.length; i++) {
        if (planetRecs[i].id !== 'pluto') ids.push(planetRecs[i].id);
      }
      for (i = 0; i < ids.length; i++) {
        var item = { id: ids[i], helioAU: 0, geoAU: 0, lightMin: 0 };
        tickBodies.push(item);
        tickPayload.bodies.push(item);
      }
    })();

    function updateTick(dt, jd) {
      tickTimer += dt;
      if (tickTimer < TICK_INTERVAL) return;
      tickTimer = tickTimer % TICK_INTERVAL;
      var earth = planetPos['earth'];
      var i, item, p, dx, dy, dz;
      for (i = 0; i < tickBodies.length; i++) {
        item = tickBodies[i];
        if (item.id === 'sun') {
          item.helioAU = 0;
          item.geoAU = earth ? earth.au : 0;
        } else {
          p = planetPos[item.id];
          if (!p) continue;
          item.helioAU = p.au;
          dx = p.x - (earth ? earth.x : 0);
          dy = p.y - (earth ? earth.y : 0);
          dz = p.z - (earth ? earth.z : 0);
          item.geoAU = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        item.lightMin = item.geoAU * LIGHT_MIN_AU;
      }
      tickPayload.timeMs = solar.timeMs;
      tickPayload.jd = jd;
      COSMOS.emit('solar:tick', tickPayload);
    }

    /* ============================================================
     * 每帧更新：时间 → 星历 → 位置/自转 → 相机 → 标签/拾取 → tick
     * 约束：本函数内不创建任何对象（临时向量、payload 全部预建复用）
     * ============================================================ */
    var BAD_POS = { x: 1, y: 0, z: 0, au: 1 };
    var ephemBroken = false;

    function planetAt(id, jd) {
      if (!ephemBroken) {
        try {
          var p = EPHEM.planet(id, jd);
          if (p && typeof p.x === 'number' && isFinite(p.x)) {
            if (typeof p.au !== 'number') p.au = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            if (p.au > 1e-6) return p;
          }
        } catch (e) {
          ephemBroken = true;
        }
      }
      return FALLBACK.planet(id, jd) || BAD_POS;
    }

    var spinPhase = 0;       /* 自转相位累积（天） */
    var lastJd = null;
    var appliedEnlarge = 0;
    var introMul = 1.35;

    function update(t, dt, p) {
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.12) dt = 0.12;
      var i, j, rec, mrec, input;

      /* ---- 时间推进（场景是唯一推进者，契约 §2）---- */
      if (!solar.paused) {
        var speed = solar.daysPerSec || 0;
        solar.timeMs += dt * speed * 86400000;
        if (solar.timeMs < TIME_MIN) solar.timeMs = TIME_MIN;
        if (solar.timeMs > TIME_MAX) solar.timeMs = TIME_MAX;
      }
      var jd = EPHEM.jdFromMs(solar.timeMs);

      /* 自转相位累积：时间跳变（深链/复位）时归零，避免整圈乱跳 */
      if (lastJd === null) {
        lastJd = jd;
        spinPhase = 0;
      } else {
        var dJd = jd - lastJd;
        if (Math.abs(dJd) > 30) spinPhase = 0;
        else spinPhase += dJd;
        lastJd = jd;
      }

      /* ---- 行星位置：真实星历 → sceneRadius 径向压缩映射 ---- */
      for (i = 0; i < planetRecs.length; i++) {
        rec = planetRecs[i];
        var p3 = planetAt(rec.id, jd);
        var au = (p3.au > 1e-6) ? p3.au : 1;
        var sr = sceneRadius(au);
        rec.pivot.position.set(
          (p3.x / au) * sr,
          (p3.z / au) * sr,
          (-p3.y / au) * sr
        );
        var pos = planetPos[rec.id];
        pos.x = p3.x;
        pos.y = p3.y;
        pos.z = p3.z;
        pos.au = au;
        /* 行星光点（屏幕空间小点）跟随行星位置 */
        dotPos[i * 3] = rec.pivot.position.x;
        dotPos[i * 3 + 1] = rec.pivot.position.y;
        dotPos[i * 3 + 2] = rec.pivot.position.z;
      }
      dotGeo.attributes.position.needsUpdate = true;

      /* ---- enlarge：只改显示比例，不改物理位置（契约 §4.1）---- */
      var enlargeFactor = solar.enlarge ? ENLARGE : 1;
      if (appliedEnlarge !== enlargeFactor) {
        appliedEnlarge = enlargeFactor;
        for (i = 0; i < planetRecs.length; i++) {
          rec = planetRecs[i];
          rec.mesh.scale.setScalar(rec.r * enlargeFactor);
          if (rec.atmo) rec.atmo.scale.setScalar(rec.r * 1.045 * enlargeFactor);
          if (rec.clouds) rec.clouds.scale.setScalar(rec.r * 1.018 * enlargeFactor);
          if (rec.ring) rec.ring.scale.setScalar(rec.r * enlargeFactor);
        }
        for (i = 0; i < moonRecs.length; i++) {
          moonRecs[i].mesh.scale.setScalar(moonRecs[i].r * enlargeFactor);
        }
        /* 卫星轨道只做部分放大（√enlarge），避免放大后卫星飞出 planet 视图 */
        var moonOrbitScale = Math.sqrt(enlargeFactor);
        for (i = 0; i < moonOrbitGroups.length; i++) {
          moonOrbitGroups[i].lines.scale.setScalar(moonOrbitGroups[i].rec.r * moonOrbitScale);
        }
      }

      /* ---- 行星自转 + 云层 + 环 ---- */
      for (i = 0; i < planetRecs.length; i++) {
        rec = planetRecs[i];
        var dayHours = Math.abs(rec.data.dayHours || 24);
        if (dayHours < 0.1) dayHours = 24;
        var spin = spinPhase * (24 / dayHours) * TAU * SPIN_GAIN + rec.spin0;
        rec.mesh.rotation.y = spin;
        if (rec.clouds) {
          rec.clouds.rotation.y = spin * 1.03 + 0.10;
          if (rec.mat.uniforms.uCloudOffset) {
            rec.mat.uniforms.uCloudOffset.value = spinPhase * 0.02;
          }
        }
        if (rec.atmo) rec.atmo.rotation.y = spin;
        var tiltRad = (rec.data.tilt || 0) * DEG;
        if (rec.mat.uniforms.uRingCenter) {
          rec.mat.uniforms.uRingCenter.value.copy(rec.pivot.position);
          rec.mat.uniforms.uRingNormal.value.set(-Math.sin(tiltRad), Math.cos(tiltRad), 0);
          rec.mat.uniforms.uRingInner.value = rec.r * rec.look.ring.inner * enlargeFactor;
          rec.mat.uniforms.uRingOuter.value = rec.r * rec.look.ring.outer * enlargeFactor;
        }
        if (rec.ringMat) {
          rec.ringMat.uniforms.uPlanetPos.value.copy(rec.pivot.position);
          rec.ringMat.uniforms.uPlanetR.value = rec.r * enlargeFactor;
        }
        var hTarget = (hoverId === rec.id || widgetHoverId === rec.id) ? 1 : 0;
        rec.hover += (hTarget - rec.hover) * Math.min(1, dt * 8);
        rec.mat.uniforms.uHover.value = rec.hover;
      }

      /* ---- 卫星位置：moonRel 方向 × 压缩距离（4.5–8 × 母行星半径）---- */
      for (i = 0; i < moonRecs.length; i++) {
        mrec = moonRecs[i];
        var rel = null;
        try {
          rel = EPHEM.moonRel(mrec.parent.id, mrec.id, jd);
        } catch (e2) {
          rel = null;
        }
        var rx, ry, rz;
        if (rel && isFinite(rel.x) && isFinite(rel.y) && isFinite(rel.z)) {
          rx = rel.x;
          ry = rel.y;
          rz = rel.z;
        } else {
          var mAng = (jd - J2000) / (mrec.data.periodDays || 27.32) * TAU;
          rx = Math.cos(mAng);
          ry = 0;
          rz = Math.sin(mAng);
        }
        var rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (!(rl > 1e-9)) { rx = 1; ry = 0; rz = 0; rl = 1; }
        var dispDist = mrec.parent.r * mrec.ratio * Math.sqrt(enlargeFactor);
        var mx = (rx / rl) * dispDist;
        var my = (rz / rl) * dispDist;
        var mz = (-ry / rl) * dispDist;
        mrec.mesh.position.set(mx, my, mz);
        /* 潮汐锁定：球面朝向母行星（视觉上纹理随公转转动） */
        mrec.mesh.rotation.y = Math.atan2(mx, mz) + Math.PI;
        var mh = (hoverId === mrec.id || widgetHoverId === mrec.id) ? 1 : 0;
        mrec.mat.uniforms.uHover.value = mh;
      }

      /* ---- 小行星带 / 尘埃 / 柯伊伯带：真实周期驱动整带旋转 ---- */
      var beltAng = (jd - J2000) / 1680 * TAU * 0.25;
      belt.rotation.y = beltAng;
      dust.rotation.y = beltAng * 1.15;
      kuiper.rotation.y = (jd - J2000) / 109000 * TAU * 0.5;

      /* ---- 太阳 / 星空 / 光晕动画 ---- */
      TIME_UNIFORM.value = t;
      if (stars && stars.material && stars.material.uniforms && stars.material.uniforms.uTime) {
        stars.material.uniforms.uTime.value = t;
      }
      if (skyDome && !ctx.reduceMotion) skyDome.rotation.y += dt * 0.002;
      sunMesh.rotation.y += dt * 0.012;
      corona.quaternion.copy(camera.quaternion);
      glowNear.material.opacity = 0.12 * (0.90 + 0.10 * Math.sin(t * 0.7));
      glowFar.material.opacity = 0.10 * (0.92 + 0.08 * Math.sin(t * 0.43 + 1.7));
      for (j = 0; j < flares.length; j++) {
        var fl = flares[j];
        var pulse = 0.5 + 0.5 * Math.sin(t * 0.55 + fl.userData.phase);
        fl.material.opacity = fl.userData.base * pulse * (pulse > 0.72 ? 1.6 : 1.0);
      }

      /* ---- 输入 → 相机（拖拽 1:1、滚轮/双指缩放、方向键、惯性 ≤600ms）---- */
      input = ctx.input;
      if (input) {
        /* 用户自己动手（拖拽 / 滚轮 / 双指）立即接管：放弃朝星球的飞行，避免抢镜头 */
        if (cam.flight && !input.uiTarget && (input.dragging || input.wheel || input.pinch)) cam.flight = null;
        if (input.dragging && !input.uiTarget) {
          cam.yaw -= input.dx * 0.0042;
          cam.pitch = U.clamp(cam.pitch + input.dy * 0.0032, LIMIT.pitchMin, LIMIT.pitchMax);
          vy = -input.dx * 0.0042;
          vp = input.dy * 0.0032;
          cam.mode = 'free';
          solar.view = 'free';
        } else {
          /* 松手惯性：exp(-3.6t)，600ms 衰减到约 12% */
          if (vy !== 0 || vp !== 0) {
            cam.yaw += vy * (dt * 60);
            cam.pitch = U.clamp(cam.pitch + vp * (dt * 60), LIMIT.pitchMin, LIMIT.pitchMax);
            var dampK = Math.exp(-dt * 3.6);
            vy *= dampK;
            vp *= dampK;
            if (Math.abs(vy) < 1e-5) vy = 0;
            if (Math.abs(vp) < 1e-5) vp = 0;
          }
        }
        if (input.wheel && !input.uiTarget) {
          cam.distTarget = U.clamp(cam.distTarget * Math.exp(input.wheel * 0.0012), LIMIT.distMin, LIMIT.distMax);
          cam.mode = 'free';
          solar.view = 'free';
        }
        if (input.pinch && !input.uiTarget) {
          cam.distTarget = U.clamp(cam.distTarget / (1 + input.pinch * 0.9), LIMIT.distMin, LIMIT.distMax);
          cam.mode = 'free';
          solar.view = 'free';
        }
        var keys = input.keys || {};
        if (keys['ArrowLeft'] || keys['a']) {
          cam.yaw += dt * 0.9;
          cam.mode = 'free'; solar.view = 'free';
        }
        if (keys['ArrowRight'] || keys['d']) {
          cam.yaw -= dt * 0.9;
          cam.mode = 'free'; solar.view = 'free';
        }
        if (keys['ArrowUp'] || keys['w'] || keys['q']) {
          cam.pitch = U.clamp(cam.pitch + dt * 0.55, LIMIT.pitchMin, LIMIT.pitchMax);
          cam.mode = 'free'; solar.view = 'free';
        }
        if (keys['ArrowDown'] || keys['s'] || keys['e']) {
          cam.pitch = U.clamp(cam.pitch - dt * 0.55, LIMIT.pitchMin, LIMIT.pitchMax);
          cam.mode = 'free'; solar.view = 'free';
        }
        if (keys['+'] || keys['=']) {
          cam.distTarget = U.clamp(cam.distTarget * Math.exp(-dt * 1.8), LIMIT.distMin, LIMIT.distMax);
          cam.mode = 'free'; solar.view = 'free';
        }
        if (keys['-'] || keys['_']) {
          cam.distTarget = U.clamp(cam.distTarget * Math.exp(dt * 1.8), LIMIT.distMin, LIMIT.distMax);
          cam.mode = 'free'; solar.view = 'free';
        }
      }

      /* ---- 焦点跟随 + 距离 damp（切 view 过渡 ≤720ms）---- */
      /* 卫星绕母行星公转很快（默认 1 天/秒下木卫一约 1.8 秒一圈、线速度 8+ 单位/秒），
         慢 lerp 会让相机永远追尾巴，卫星焦点直接钉住 center；行星/太阳保持阻尼过渡 */
      if (focus.rec) focusWorldPos(_v3);
      else _v3.set(0, 0, 0);
      centerTarget.copy(_v3);
      if (cam.flight) {
        /* 飞行期间中心钉住目标天体：星球始终在画面中央 */
        center.copy(centerTarget);
      } else if (focus.kind === 'moon') {
        center.copy(centerTarget);
      } else {
        center.lerp(centerTarget, 1 - Math.exp(-dt * 3.4));
      }
      if (!cam.flight) {
        cam.dist += (cam.distTarget - cam.dist) * (1 - Math.exp(-dt * 4.0));
        if (Math.abs(cam.dist - cam.distTarget) < 0.002) cam.dist = cam.distTarget;
      }

      /* 入场推镜：p 0.10 → 0.86 时 1.35 → 1.0 */
      var introP = U.clamp((p - 0.10) / 0.76, 0, 1);
      introMul = 1.35 - 0.35 * introP;

      /* 抖动（solar:cmd shake）*/
      var shakeX = 0, shakeY = 0;
      if (shakeT > 0) {
        shakeT -= dt;
        var sAmt = Math.max(0, shakeT) * 0.03;
        shakeX = Math.sin(t * 61.0) * sAmt;
        shakeY = Math.cos(t * 47.0) * sAmt;
      }

      if (cam.flight) {
        /* 球面推进：相机绕目标天体拉近，路径不会穿过太阳附近 */
        updateFlight(dt, introMul);
        if (shakeX || shakeY) {
          camera.position.x += shakeX;
          camera.position.y += shakeY;
        }
      } else {
        var camDist = cam.dist * introMul;
        var cp = Math.cos(cam.pitch);
        camera.position.set(
          center.x + Math.sin(cam.yaw) * cp * camDist + shakeX,
          center.y + Math.sin(cam.pitch) * camDist + shakeY,
          center.z + Math.cos(cam.yaw) * cp * camDist
        );
      }
      camera.lookAt(center);
      camera.updateMatrixWorld();

      /* ---- 轨道线可见性 ---- */
      orbitGroup.visible = solar.orbits !== false;
      for (i = 0; i < moonOrbitGroups.length; i++) {
        moonOrbitGroups[i].lines.visible = solar.orbits !== false;
      }

      /* ---- 远距带：planet 档或近景 free 时隐藏，避免带内天体在近景变成巨大遮挡物 ---- */
      var nearView = cam.mode === 'planet' || (cam.mode === 'free' && cam.dist < 12);
      belt.visible = !nearView;
      dust.visible = !nearView;
      kuiper.visible = !nearView;

      /* ---- 标签 / hover / 点击 / tick ---- */
      updateHover();
      handleClick();
      updateLabels();
      updateTick(dt, jd);
    }

    /* ---- 生命周期 ---- */
    function resize(w, h) {
      width = w;
      height = h;
      U.fitCamera(camera, 50, width / Math.max(height, 1));
      applyViewShift();
      camera.updateProjectionMatrix();
    }

    function enter() {
      if (labelsRoot) labelsRoot.style.display = '';
      cam.mode = solar.view || 'whole';
      if (cam.mode === 'whole' || cam.mode === 'inner') {
        cam.distTarget = VIEW_DIST[cam.mode];
        centerTarget.set(0, 0, 0);
      } else if (cam.mode === 'planet' && solar.focus) {
        selectBody(solar.focus, false);
        cam.flight = null;
      } else if (!solar.focus) {
        cam.mode = 'whole';
        solar.view = 'whole';
        cam.distTarget = VIEW_DIST.whole;
      }
      hoverId = null;
      labelHoverId = null;
      widgetHoverId = null;
      if (canvas) canvas.style.cursor = 'grab';
      COSMOS.emit('solar:ready', {});
    }

    function leave() {
      if (labelsRoot) labelsRoot.style.display = 'none';
      hoverId = null;
      labelHoverId = null;
      widgetHoverId = null;
      if (canvas) canvas.style.cursor = '';
    }

    function dispose() {
      offCmd();
      offZoom();
      offReset();
      offHover();
      var i;
      for (i = 0; i < labelItems.length; i++) {
        if (labelItems[i].el.parentNode) labelItems[i].el.parentNode.removeChild(labelItems[i].el);
      }
      labelItems.length = 0;
      if (labelsRoot && labelsRoot.parentNode && labelsRoot.childNodes.length === 0) {
        labelsRoot.parentNode.removeChild(labelsRoot);
      }
      scene.traverse(function (obj) {
        if (obj.userData && obj.userData.isStarfield) return;
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) {
          var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (var m = 0; m < mats.length; m++) {
            if (mats[m].dispose) mats[m].dispose();
          }
        }
      });
      /* 共享几何（scene.traverse 会重复 dispose，这里兜底一次） */
      sphereGeo.dispose();
      atmoGeo.dispose();
      moonSphereGeo.dispose();
      sunGeo.dispose();
      beltGeo.dispose();
    }

    /* ---- 初始状态：按 solar.view / solar.focus 恢复（URL 深链）---- */
    if (solar.focus) {
      selectBody(solar.focus, false);
    } else if (solar.view === 'inner') {
      cam.dist = VIEW_DIST.inner;
      cam.distTarget = VIEW_DIST.inner;
    } else if (solar.view === 'planet' && planetById['earth']) {
      selectBody('earth', false);
    }
    if (canvas) canvas.style.cursor = 'grab';

    return {
      scene: scene,
      camera: camera,
      arrowKeys: true,
      bloom: { strength: 0.52, radius: 0.62, threshold: 0.82 },
      update: update,
      resize: resize,
      enter: enter,
      leave: leave,
      reset: reset,
      dispose: dispose
    };
  });
})(window.COSMOS = window.COSMOS || {});

