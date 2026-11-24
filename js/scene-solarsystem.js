/* ============================================================
 * COSMOS ATLAS · scene-solarsystem.js
 * 03 太阳系 · 完整 3D 太阳系舞台（stage: solar）
 *
 * 契约：COSMOS.registerStage('solar', factory) → {
 *   scene, camera, update(t, dt, p), resize(w, h),
 *   enter(), leave(), reset(), dispose(), bloom
 * }
 *
 * 状态：COSMOS.state.solar 由 widget（feat-solar.js）写、本场景只读：
 *   { daysPerSec, paused, labels, orbits, selected }
 *   labels 语义：false = 关闭；数组 = 每帧由本场景写入的屏幕坐标
 *   [{ id, name, x, y, visible }]（数组与内部对象复用，不每帧 new）
 *
 * 事件：
 *   solar:focus { id | null }  scene → widget（点行星 / 点空白）
 *   solar:hover { id | null }  scene → widget（悬停高亮）
 *   solar:zoom  { dir: ±1 }    widget → scene（+ / − 按钮）
 *   solar:reset                widget → scene（复位按钮）
 *
 * v3 精细化（task-5）：
 *   · 行星自定义着色器：昼夜软过渡、晨昏线、海面高光、夜灯、云影、
 *     极冠、云带湍流、大红斑、环在行星上的阴影。
 *   · 8 颗大气壳（菲涅尔边缘散射 + 前向散射），地球独立云层。
 *   · 太阳：米粒组织 / 黑子 / 临边昏暗 / 日冕射线 / 日珥光斑 / 光晕。
 *   · 卫星：月球、木卫一至四、土卫六（程序化表面），真实公转周期。
 *   · 土星环：径向贴图（含真实卡西尼缝、恩克缝）+ 行星投在环上的阴影、
 *     环投在行星上的阴影；木星/天王星/海王星用程序化窄环。
 *   · 小行星带 InstancedMesh（有聚散与柯克伍德空隙），柯伊伯带粒子。
 *   · 轨道线合并为单个 LineSegments（1 draw call）。
 *
 * 性能：draw call ≈ 46；三角 ≈ 11 万（high）；粒子 ≈ 1.6 万；
 *       update() 内零 new（临时 Vector3 / 数组全部预建）。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var THREE = window.THREE;
  var U = COSMOS.util;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  var SUN_R = 6.0;
  var DEF = { yaw: 0.85, pitch: 0.20, dist: 28 };
  var LIMIT = { pitchMin: 0.08, pitchMax: 1.42, distMin: 0.9, distMax: 150 };
  /* 屏幕偏移：左侧是文案，右侧是控制台，把行星盘整体往右上让一点。
   * 用 setViewOffset 做屏幕空间平移，project()/raycaster 都会自动跟随。 */
  var VIEW_SHIFT = { x: -0.072, y: -0.09 };

  /* 行星半径：真实直径比值压缩后整体放大；太阳与轨道距离另行压缩。 */
  function bodyRadius(km) {
    return 0.092 * Math.pow(km / 12742, 0.55) * 6.0;
  }

  /* 轨道半径：按 AU 的平方根压缩，海王星落在 22.3（默认视野略外，缩小可见）；
   * 系数比早期版本大，行星间距整体拉开、更接近真实比例，内行星仍贴着日面。 */
  function orbitRadius(au) {
    return 8.0 + 2.6 * Math.sqrt(au);
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
      jupiter: 1, grs: 0.55, ring: { inner: 1.36, outer: 1.62, opacity: 0.10, tint: [0.72, 0.66, 0.58] }
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
    }
  };

  /* 卫星：半径比与轨道比相对父行星（真实轨道距离压缩到 2.5–5.3 倍行星半径，
   * 否则在行星尺度下会飞出视野），公转周期与相位用真实值。 */
  var MOONS = [
    { id: 'moon', parent: 'earth', tex: 'moon', rRatio: 0.2726, dRatio: 2.70, period: 27.32, phase: 0.4 },
    { id: 'io', parent: 'jupiter', proc: 'io', rRatio: 0.088, dRatio: 2.55, period: 1.769, phase: 1.1 },
    { id: 'europa', parent: 'jupiter', proc: 'europa', rRatio: 0.062, dRatio: 3.20, period: 3.551, phase: 2.4 },
    { id: 'ganymede', parent: 'jupiter', proc: 'ganymede', rRatio: 0.078, dRatio: 3.95, period: 7.155, phase: 0.2 },
    { id: 'callisto', parent: 'jupiter', proc: 'callisto', rRatio: 0.072, dRatio: 5.30, period: 16.689, phase: 4.4 },
    { id: 'titan', parent: 'saturn', proc: 'titan', rRatio: 0.088, dRatio: 4.10, period: 15.945, phase: 3.3 }
  ];

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
    '  /* the texture already carries the real Cassini/Encke gaps */',
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
    '  /* 线性 HDR 亮度直接按黑体色温给：视线中心穿到较深、较热层（≈5772 K 白热），',
    '   * 临边昏暗降到 ≈4200 K 的橙红。数值线性、>1 交给统一泛光，ACES 之后仍有颜色，',
    '   * 不是调色盘。 */',
    '  vec3 edge = vec3(0.40, 0.09, 0.010);',
    '  vec3 mid  = vec3(1.00, 0.20, 0.010);',
    '  vec3 hot  = vec3(1.80, 0.38, 0.020);',
    '  vec3 core = mix(edge, mid, smoothstep(0.00, 0.52, mu));',
    '  core = mix(core, hot, smoothstep(0.55, 0.96, mu));',
    '  core = mix(core, vec3(0.12, 0.022, 0.003), spot * 0.92);',
    '  core *= 0.18 + 1.35 * gran;',
    '  /* 色球 / spicule：μ→0 的轮廓上一圈薄亮环（低色球与针状体的示意） */',
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
    '  /* 日面挡住的地方几乎不发光，否则会把光球洗成一只白盘子 */',
    '  float outside = smoothstep(uDiscR * 0.92, uDiscR * 1.25, r);',
    '  /* 色球亮环：紧贴日面的一圈细亮边 */',
    '  float ring = exp(-pow((r - uDiscR * 1.02) / (uDiscR * 0.10), 2.0));',
    '  /* 日冕亮度按 ~r^-2 量级向外衰减（真实日冕 K 冕的径向衰减方向） */',
    '  float fall = pow(clamp(1.0 - (r - uDiscR) / max(0.98 - uDiscR, 0.001), 0.0, 1.0), 1.55);',
    '  float alpha = (fall * outside * (0.55 + 0.30 * rays + 0.30 * streamer) + ring * 0.60) * uOpacity;',
    '  if (alpha < 0.002) discard;',
    '  /* 内冕偏金黄白（可见连续谱 + 530.3 nm 绿线），外冕洩出的暖色接近色球 */',
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
    '  /* texture rings use the real gaps from the map; only procedural rings synth gaps */',
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
   * 几何构造
   * ============================================================ */
  function circleGeometry(r, segments) {
    var pos = new Float32Array(segments * 3);
    for (var i = 0; i < segments; i++) {
      var a = (i / segments) * TAU;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }

  /* 把 8 条轨道合并成一个 LineSegments：每段两个顶点，aAlpha 控制明暗。 */
  function orbitLinesGeometry(recs, segsPer) {
    var total = recs.length * segsPer * 2;
    var pos = new Float32Array(total * 3);
    var alpha = new Float32Array(total);
    var n = 0;
    for (var ri = 0; ri < recs.length; ri++) {
      var r = recs[ri].orbit;
      var a0 = 0.16 + ri * 0.028;
      for (var i = 0; i < segsPer; i++) {
        var t0 = (i / segsPer) * TAU;
        var t1 = ((i + 1) / segsPer) * TAU;
        pos[n * 3] = Math.cos(t0) * r;
        pos[n * 3 + 1] = 0;
        pos[n * 3 + 2] = Math.sin(t0) * r;
        alpha[n] = a0;
        n++;
        pos[n * 3] = Math.cos(t1) * r;
        pos[n * 3 + 1] = 0;
        pos[n * 3 + 2] = Math.sin(t1) * r;
        alpha[n] = a0;
        n++;
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    return geo;
  }

  /* 土星环几何：贴图 2048×125，宽边是径向剖面。
   * UV.x = 归一化半径（内 0 → 外 1），UV.y = 角度。 */
  function ringGeometry(inner, outer, segments) {
    var pos = new Float32Array(segments * 2 * 3);
    var nor = new Float32Array(segments * 2 * 3);
    var uv = new Float32Array(segments * 2 * 2);
    var idx = new Uint16Array(segments * 6);
    var i, a, c, s, n2;
    for (i = 0; i < segments; i++) {
      n2 = segments * 2;
      a = (i / segments) * TAU;
      c = Math.cos(a);
      s = Math.sin(a);
      pos[i * 6] = c * inner;
      pos[i * 6 + 1] = 0;
      pos[i * 6 + 2] = s * inner;
      pos[i * 6 + 3] = c * outer;
      pos[i * 6 + 4] = 0;
      pos[i * 6 + 5] = s * outer;
      /* 环面法线恒为 +Y（赤道面），供 RING_VS 的光照与掠射项使用 */
      nor[i * 6 + 1] = 1;
      nor[i * 6 + 4] = 1;
      uv[i * 4] = 0;
      uv[i * 4 + 1] = i / segments;
      uv[i * 4 + 2] = 1;
      uv[i * 4 + 3] = i / segments;
      idx[i * 6] = i * 2;
      idx[i * 6 + 1] = i * 2 + 1;
      idx[i * 6 + 2] = (i * 2 + 2) % n2;
      idx[i * 6 + 3] = (i * 2 + 2) % n2;
      idx[i * 6 + 4] = i * 2 + 1;
      idx[i * 6 + 5] = (i * 2 + 3) % n2;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  /* 程序化卫星贴图（canvasTexture；不引入外部资源） */
  function makeMoonTexture(kind) {
    return U.tex.canvasTexture(512, 256, function (g, w, h) {
      var seed = 0;
      for (var ci = 0; ci < kind.length; ci++) seed = (seed * 31 + kind.charCodeAt(ci)) >>> 0;
      function rnd() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      }
      function blob(x, y, rad, col) {
        var grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, col);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, rad, 0, TAU);
        g.fill();
      }
      if (kind === 'io') {
        g.fillStyle = '#cdb85c';
        g.fillRect(0, 0, w, h);
        for (var i = 0; i < 90; i++) {
          blob(rnd() * w, rnd() * h, 8 + rnd() * 34,
            rnd() > 0.5 ? 'rgba(150,74,32,0.55)' : 'rgba(240,232,190,0.55)');
        }
        for (var j = 0; j < 14; j++) {
          g.fillStyle = 'rgba(70,58,32,0.55)';
          g.beginPath();
          g.ellipse(rnd() * w, rnd() * h, 3 + rnd() * 8, 2 + rnd() * 5, rnd() * 3, 0, TAU);
          g.fill();
        }
      } else if (kind === 'europa') {
        g.fillStyle = '#d9d2c2';
        g.fillRect(0, 0, w, h);
        for (var k = 0; k < 48; k++) {
          blob(rnd() * w, rnd() * h, 10 + rnd() * 40, 'rgba(228,222,208,0.5)');
        }
        g.strokeStyle = 'rgba(112,70,48,0.45)';
        for (var s = 0; s < 70; s++) {
          g.lineWidth = 0.6 + rnd() * 1.8;
          var x0 = rnd() * w, y0 = rnd() * h;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x0 + (rnd() - 0.5) * 260, y0 + (rnd() - 0.5) * 70);
          g.stroke();
        }
      } else if (kind === 'ganymede') {
        g.fillStyle = '#8b8274';
        g.fillRect(0, 0, w, h);
        for (var m = 0; m < 80; m++) {
          blob(rnd() * w, rnd() * h, 6 + rnd() * 30,
            rnd() > 0.55 ? 'rgba(60,54,46,0.5)' : 'rgba(214,208,192,0.42)');
        }
        g.strokeStyle = 'rgba(40,36,30,0.4)';
        for (var t = 0; t < 26; t++) {
          g.lineWidth = 1 + rnd() * 2.4;
          g.beginPath();
          g.moveTo(rnd() * w, rnd() * h);
          g.lineTo(rnd() * w, rnd() * h);
          g.stroke();
        }
      } else if (kind === 'callisto') {
        g.fillStyle = '#574f47';
        g.fillRect(0, 0, w, h);
        for (var q = 0; q < 160; q++) {
          var rr = 1 + rnd() * 7;
          g.fillStyle = 'rgba(224,218,206,' + (0.25 + rnd() * 0.55).toFixed(3) + ')';
          g.beginPath();
          g.arc(rnd() * w, rnd() * h, rr, 0, TAU);
          g.fill();
        }
      } else {
        /* titan：橙黄雾霾，表面细节极少 */
        g.fillStyle = '#c98a3f';
        g.fillRect(0, 0, w, h);
        for (var z = 0; z < 30; z++) {
          blob(rnd() * w, rnd() * h, 30 + rnd() * 80, 'rgba(226,168,84,0.28)');
        }
        var grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, 'rgba(240,196,120,0.30)');
        grd.addColorStop(0.5, 'rgba(190,120,48,0.05)');
        grd.addColorStop(1, 'rgba(120,72,30,0.35)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }
    }, { srgb: true });
  }

  /* 土星环贴图的 UV 采样：把 2048 宽的径向剖面当作 u。 */
  function ringTexture() {
    return U.tex.load('saturn_ring');
  }

  COSMOS.registerStage('solar', function (ctx) {
    var DATA = COSMOS.DATA;
    var S = COSMOS.state || (COSMOS.state = {});
    var st = S.solar || (S.solar = {});
    if (st.daysPerSec === undefined) st.daysPerSec = 5;
    if (st.paused === undefined) st.paused = false;
    if (st.labels === undefined) st.labels = true;
    if (st.orbits === undefined) st.orbits = true;
    if (st.selected === undefined) st.selected = null;

    var isLow = ctx.quality === 'low';
    var seg = isLow ? 30 : 64;
    var atmoSeg = isLow ? 20 : 32;
    var width = ctx.width;
    var height = ctx.height;
    var pr = Math.min(ctx.pixelRatio || 1, 2);

    var scene = new THREE.Scene();
    var camera = U.makeCamera(50, ctx.aspect);
    camera.near = 0.02;
    camera.far = 2800;

    function isNarrow() { return width < 860; }
    function defaultDist() { return isNarrow() ? 35 : DEF.dist; }
    function applyViewShift(w, h) {
      var sx = isNarrow() ? 0 : Math.round(w * VIEW_SHIFT.x);
      var sy = isNarrow() ? Math.round(h * -0.055) : Math.round(h * VIEW_SHIFT.y);
      camera.setViewOffset(w, h, sx, sy, w, h);
    }
    applyViewShift(width, height);

    /* 共享 uniform：时间 / 太阳位置（原点）/ 像素比 */
    var uTime = { value: 0 };
    var uSunPos = { value: new THREE.Vector3(0, 0, 0) };

    /* 场景内所有材质都是自定义着色器或自发光点/线，不依赖 three 灯光系统；
     * 这样也不会因为灯光数量变化触发任何 shader 重编译。 */

    /* 星空 */
    var stars = COSMOS.builders.makeStarfield({
      count: isLow ? 1400 : 2800,
      rMin: 520,
      rMax: 1500
    });
    stars.material.uniforms.uPixelRatio.value = pr;
    scene.add(stars);

    var root = new THREE.Group();
    scene.add(root);

    /* ---------------- 太阳 ---------------- */
    var sunGeo = new THREE.SphereGeometry(SUN_R, seg, seg >> 1);
    var sunMat = new THREE.ShaderMaterial({
      uniforms: { uTime: uTime },
      vertexShader: PLANET_VS,
      fragmentShader: SUN_FS
    });
    var sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.rotation.z = 7.25 * DEG;
    root.add(sunMesh);

    /* 日冕：面向相机的 quad（每帧复制相机朝向，无 new） */
    var coronaGeo = new THREE.PlaneGeometry(1, 1);
    var coronaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: uTime,
        uOpacity: { value: 0.85 },
        uColor: { value: new THREE.Color(1.70, 0.95, 0.42) },
        uDiscR: { value: 2.0 / 2.7 }
      },
      vertexShader: CORONA_VS,
      fragmentShader: CORONA_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var corona = new THREE.Mesh(coronaGeo, coronaMat);
    corona.scale.setScalar(SUN_R * 2.7);
    corona.renderOrder = 2;
    root.add(corona);

    var glowTex = U.tex.glowTexture(256, 'rgba(255,226,170,1)', 'rgba(255,120,20,0)');
    var glowNear = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffd8a4, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glowNear.scale.set(SUN_R * 3.4, SUN_R * 3.4, 1);
    root.add(glowNear);
    var glowFar = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffa85c, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glowFar.scale.set(SUN_R * 5.0, SUN_R * 5.0, 1);
    root.add(glowFar);

    /* 克制的一字光晕（真实镜头才会出现的横向 flare） */
    var streakTex = U.tex.canvasTexture(256, 32, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(255,220,170,0)');
      grd.addColorStop(0.5, 'rgba(255,226,180,0.85)');
      grd.addColorStop(1, 'rgba(255,220,170,0)');
      g.fillStyle = grd;
      g.fillRect(0, h * 0.40, w, h * 0.20);
    });
    var streak = new THREE.Sprite(new THREE.SpriteMaterial({
      map: streakTex, color: 0xffd8a8, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    streak.scale.set(SUN_R * 6.0, SUN_R * 0.48, 1);
    root.add(streak);

    /* 日珥 / 耀斑：3 个小光斑贴着球面，偶尔变亮 */
    var flares = [];
    var flareDefs = [
      { lat: 0.30, lon: 1.2, h: 0.06, color: 0xff9a4a, phase: 0.0 },
      { lat: -0.42, lon: 3.6, h: 0.10, color: 0xffb060, phase: 2.1 },
      { lat: 0.62, lon: 5.1, h: 0.04, color: 0xff7040, phase: 4.0 }
    ];
    for (var fi = 0; fi < flareDefs.length; fi++) {
      var fd = flareDefs[fi];
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: fd.color, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      var cl = Math.cos(fd.lat);
      sp.position.set(
        Math.cos(fd.lon) * cl * SUN_R * 1.03,
        Math.sin(fd.lat) * SUN_R * 1.03,
        Math.sin(fd.lon) * cl * SUN_R * 1.03
      );
      sp.scale.setScalar(SUN_R * (0.30 + fd.h));
      root.add(sp);
      flares.push({ sprite: sp, phase: fd.phase, base: (0.22 + fd.h) * 1.35 });
    }

    /* ---------------- 八颗行星 ---------------- */
    var sphereGeo = new THREE.SphereGeometry(1, seg, Math.max(16, seg >> 1));
    var atmoGeo = new THREE.SphereGeometry(1, atmoSeg, Math.max(12, atmoSeg >> 1));
    var recs = [];
    var byId = {};
    var meshes = [];
    var dummyTex = U.tex.load('sun');

    function makePlanetMaterial(p, look) {
      var defines = {};
      if (look.ocean) defines.P_OCEAN = 1;
      if (look.clouds) defines.P_CLOUDS = 1;
      if (look.night) defines.P_NIGHT = 1;
      if (look.ice) defines.P_ICE = 1;
      if (look.bands) defines.P_BANDS = 1;
      if (look.jupiter) defines.P_JUPITER = 1;
      if (p.id === 'saturn') defines.P_RING = 1;
      var uniforms = {
        uMap: { value: U.tex.load(p.texture) },
        uNightMap: { value: look.night ? U.tex.load('earth_night') : dummyTex },
        uCloudMap: { value: look.clouds ? U.tex.load('earth_clouds') : dummyTex },
        uSunPos: uSunPos,
        uTint: { value: new THREE.Vector3(look.tint[0], look.tint[1], look.tint[2]) },
        uTime: uTime,
        uHover: { value: 0 },
        uOcean: { value: look.ocean || 0 },
        uCloudShadow: { value: look.cloudShadow || 0 },
        uCloudOffset: { value: 0 },
        uIce: { value: look.ice || 0 },
        uBands: { value: look.bands ? 1 : 0 },
        uGrs: { value: look.grs || 0 }
      };
      if (defines.P_RING) {
        uniforms.uRingMap = { value: ringTexture() };
        uniforms.uRingCenter = { value: new THREE.Vector3(0, 0, 0) };
        uniforms.uRingNormal = { value: new THREE.Vector3(0, 1, 0) };
        uniforms.uRingInner = { value: 1 };
        uniforms.uRingOuter = { value: 2 };
      }
      var m = new THREE.ShaderMaterial({
        uniforms: uniforms,
        defines: defines,
        vertexShader: PLANET_VS,
        fragmentShader: PLANET_FS
      });
      m.userData.look = look;
      return m;
    }

    DATA.planets.forEach(function (p, i) {
      var look = LOOK[p.id] || LOOK.mercury;
      var rec = {
        id: p.id,
        data: p,
        look: look,
        orbit: orbitRadius(p.au),
        r: bodyRadius(p.diameterKm),
        angle0: 0.55 + i * 2.399963,
        spin0: i * 0.73,
        hover: 0,
        pivot: new THREE.Object3D(),
        tilt: new THREE.Object3D()
      };
      rec.tilt.rotation.z = (p.tilt || 0) * DEG;
      rec.mat = makePlanetMaterial(p, look);
      rec.mesh = new THREE.Mesh(sphereGeo, rec.mat);
      rec.mesh.scale.setScalar(rec.r);
      rec.mesh.userData.pid = p.id;
      rec.tilt.add(rec.mesh);

      /* 大气壳：背面菲涅尔 + 前向散射（每个行星 1 draw call） */
      rec.atmoMat = new THREE.ShaderMaterial({
        uniforms: {
          uAtmoColor: { value: new THREE.Vector3(look.atmo[0], look.atmo[1], look.atmo[2]) },
          uSunPos: uSunPos,
          uAtmoStrength: { value: look.atmoStrength }
        },
        vertexShader: ATMO_VS,
        fragmentShader: ATMO_FS,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      rec.atmo = new THREE.Mesh(atmoGeo, rec.atmoMat);
      rec.atmo.scale.setScalar(rec.r * 1.045);
      rec.tilt.add(rec.atmo);

      if (look.clouds) {
        rec.clouds = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: U.tex.load('earth_clouds') },
            uSunPos: uSunPos,
            uOpacity: { value: 0.62 }
          },
          vertexShader: PLANET_VS,
          fragmentShader: CLOUD_FS,
          transparent: true,
          depthWrite: false
        }));
        rec.clouds.scale.setScalar(rec.r * 1.018);
        rec.tilt.add(rec.clouds);
      }

      /* 巨行星环：土星用贴图，木/天/海用程序化窄环 */
      if (look.ring) {
        var ringDef = look.ring;
        var inner = rec.r * ringDef.inner;
        var outer = rec.r * ringDef.outer;
        rec.ringMat = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: ringTexture() },
            uUseTex: { value: ringDef.tex ? 1 : 0 },
            uStyle: { value: ringDef.tex ? 1 : 0.85 },
            uTint: { value: new THREE.Vector3(ringDef.tint[0], ringDef.tint[1], ringDef.tint[2]) },
            uSunPos: uSunPos,
            uPlanetPos: { value: new THREE.Vector3(0, 0, 0) },
            uPlanetR: { value: rec.r },
            uOpacity: { value: ringDef.opacity }
          },
          vertexShader: RING_VS,
          fragmentShader: RING_FS,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false
        });
        rec.ring = new THREE.Mesh(
          ringGeometry(inner, outer, isLow ? 96 : 180),
          rec.ringMat
        );
        /* 环几何本身位于行星赤道面（XZ 平面、法线 +Y），
         * 赤道倾角由父级 tilt 统一施加。 */
        rec.tilt.add(rec.ring);

        if (p.id === 'saturn') {
          /* 行星着色器里的环阴影参数（世界空间） */
          var up = new THREE.Vector3(0, 1, 0);
          up.applyAxisAngle(new THREE.Vector3(0, 0, 1), (p.tilt || 0) * DEG);
          rec.mat.uniforms.uRingNormal.value.copy(up);
          rec.mat.uniforms.uRingInner.value = inner;
          rec.mat.uniforms.uRingOuter.value = outer;
        }
      }

      rec.pivot.position.set(
        Math.cos(rec.angle0) * rec.orbit,
        0,
        Math.sin(rec.angle0) * rec.orbit
      );
      rec.pivot.add(rec.tilt);
      root.add(rec.pivot);

      recs.push(rec);
      byId[p.id] = rec;
      meshes.push(rec.mesh);
    });

    /* ---------------- 卫星（6 颗，含轨道细线） ---------------- */
    var moonSphereGeo = new THREE.SphereGeometry(1, isLow ? 18 : 28, isLow ? 10 : 16);
    var moonRecs = [];
    var moonLines = [];
    var moonOrbitMat = new THREE.LineBasicMaterial({
      color: 0x3a4a63, transparent: true, opacity: 0.30, depthWrite: false
    });
    MOONS.forEach(function (md) {
      var parent = byId[md.parent];
      if (!parent) return;
      var mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: md.tex ? U.tex.load(md.tex) : makeMoonTexture(md.proc) },
          uNightMap: { value: dummyTex },
          uCloudMap: { value: dummyTex },
          uSunPos: uSunPos,
          uTint: { value: new THREE.Vector3(1, 1, 1) },
          uTime: uTime,
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
      var mesh = new THREE.Mesh(moonSphereGeo, mat);
      var mr = parent.r * md.rRatio;
      mesh.scale.setScalar(mr);
      var pivot = new THREE.Object3D();
      pivot.add(mesh);
      parent.pivot.add(pivot);

      /* 卫星轨道线：跟随父行星 pivot（细、暗） */
      var ringLine = new THREE.LineLoop(
        circleGeometry(parent.r * md.dRatio, isLow ? 48 : 96),
        moonOrbitMat
      );
      parent.pivot.add(ringLine);
      moonLines.push(ringLine);

      moonRecs.push({
        def: md, parent: parent, pivot: pivot, mesh: mesh, r: mr,
        orbitR: parent.r * md.dRatio
      });
    });

    /* ---------------- 轨道线（合并为 1 draw call） ---------------- */
    var orbitMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(0.16, 0.24, 0.37) },
        uOpacity: { value: 0.62 }
      },
      vertexShader: ORBIT_VS,
      fragmentShader: ORBIT_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var orbitGroup = new THREE.LineSegments(
      orbitLinesGeometry(recs, isLow ? 120 : 240),
      orbitMat
    );
    root.add(orbitGroup);

    /* ---------------- 小行星带（InstancedMesh，柯克伍德空隙） ---------------- */
    var beltCount = isLow ? 700 : 1500;
    var beltGeo = new THREE.IcosahedronGeometry(1, 0);
    /* 基本材质 + instanceColor：不依赖灯光，2600 个实例也只占 1 个 draw call */
    var beltMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var belt = new THREE.InstancedMesh(beltGeo, beltMat, beltCount);
    belt.frustumCulled = false;
    var beltDummy = new THREE.Object3D();
    var beltColor = new THREE.Color();
    var beltRnd = 1234567;
    function beltRand() {
      beltRnd = (beltRnd * 1664525 + 1013904223) >>> 0;
      return beltRnd / 4294967296;
    }
    /* 柯克伍德空隙：在这些半径附近降低概率 */
    var GAPS = [11.98, 12.12, 12.30, 12.55];
    for (var bi = 0; bi < beltCount; bi++) {
      var rr = 11.85 + beltRand() * 0.95;
      var gapSkip = 0;
      for (var gi = 0; gi < GAPS.length; gi++) {
        if (Math.abs(rr - GAPS[gi]) < 0.06) gapSkip = 1;
      }
      if (gapSkip && beltRand() > 0.12) rr += 0.18 + beltRand() * 0.22;
      var ang = beltRand() * TAU;
      /* 聚集：沿角度叠两簇，密度有疏密 */
      var cluster = 0.65 + 0.55 * Math.sin(ang * 3.0 + 0.8) + 0.22 * Math.sin(ang * 11.0);
      if (beltRand() > cluster) rr += (beltRand() - 0.5) * 0.9;
      /* 单块尺寸：远景下 1px 以下的小行星会消失，这里放大到 0.012–0.097 */
      var sc = 0.008 + Math.pow(beltRand(), 2.0) * 0.055;
      beltDummy.position.set(
        Math.cos(ang) * rr,
        (beltRand() - 0.5) * 0.34,
        Math.sin(ang) * rr
      );
      beltDummy.rotation.set(beltRand() * TAU, beltRand() * TAU, beltRand() * TAU);
      beltDummy.scale.set(sc * (0.7 + beltRand() * 0.9), sc * (0.6 + beltRand() * 0.7), sc * (0.7 + beltRand() * 0.9));
      beltDummy.updateMatrix();
      belt.setMatrixAt(bi, beltDummy.matrix);
      var shade = 0.16 + beltRand() * 0.18;
      beltColor.setRGB(shade * 0.78, shade * 0.72, shade * 0.62);
      belt.setColorAt(bi, beltColor);
    }
    belt.instanceMatrix.needsUpdate = true;
    if (belt.instanceColor) belt.instanceColor.needsUpdate = true;
    root.add(belt);

    /* 小行星带尘埃（Points，1 draw call） */
    var dustCount = isLow ? 1200 : 2600;
    var dustPos = new Float32Array(dustCount * 3);
    for (var di = 0; di < dustCount; di++) {
      var da = Math.random() * TAU;
      var dr = 11.2 + Math.random() * 1.6;
      dustPos[di * 3] = Math.cos(da) * dr;
      dustPos[di * 3 + 1] = (Math.random() - 0.5) * 0.5;
      dustPos[di * 3 + 2] = Math.sin(da) * dr;
    }
    var dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    var dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0x8f826d, size: 0.07, sizeAttenuation: true,
      transparent: true, opacity: 0.15, depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    dust.frustumCulled = false;
    root.add(dust);

    /* ---------------- 柯伊伯带（海王星之外的冷天体） ---------------- */
    var kuiperCount = isLow ? 3600 : 9000;
    var kuiperPos = new Float32Array(kuiperCount * 3);
    var kuiperCol = new Float32Array(kuiperCount * 3);
    for (var ki = 0; ki < kuiperCount; ki++) {
      var ka = Math.random() * TAU;
      var kr = 22.0 + Math.pow(Math.random(), 0.8) * 5.0;
      kuiperPos[ki * 3] = Math.cos(ka) * kr;
      kuiperPos[ki * 3 + 1] = (Math.random() - 0.5) * 2.6;
      kuiperPos[ki * 3 + 2] = Math.sin(ka) * kr;
      var kc = 0.55 + Math.random() * 0.4;
      kuiperCol[ki * 3] = kc * 0.72;
      kuiperCol[ki * 3 + 1] = kc * 0.80;
      kuiperCol[ki * 3 + 2] = kc;
    }
    var kuiperGeo = new THREE.BufferGeometry();
    kuiperGeo.setAttribute('position', new THREE.BufferAttribute(kuiperPos, 3));
    kuiperGeo.setAttribute('aColor', new THREE.BufferAttribute(kuiperCol, 3));
    var kuiperMat = new THREE.ShaderMaterial({
      uniforms: { uPR: { value: pr }, uOpacity: { value: 0.32 } },
      vertexShader: [
        'attribute vec3 aColor;',
        'uniform float uPR;',
        'varying vec3 vC;',
        'varying float vFade;',
        'void main() {',
        '  vC = aColor;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = 0.22 * uPR * (330.0 / max(-mv.z, 1.0));',
        '  vFade = clamp(1.0 - (-mv.z - 20.0) / 40.0, 0.15, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uOpacity;',
        'varying vec3 vC;',
        'varying float vFade;',
        'void main() {',
        '  vec2 d = gl_PointCoord - 0.5;',
        '  float a = 1.0 - smoothstep(0.1, 0.5, length(d));',
        '  gl_FragColor = vec4(vC * 0.55, a * vFade * uOpacity);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var kuiper = new THREE.Points(kuiperGeo, kuiperMat);
    kuiper.frustumCulled = false;
    root.add(kuiper);

    /* ---------------- 相机 / 交互状态 ---------------- */
    var view = {
      yaw: DEF.yaw, pitch: DEF.pitch,
      vy: 0, vp: 0,
      dist: defaultDist(), distTarget: defaultDist()
    };
    var center = new THREE.Vector3(0, 0, 0);
    var centerTarget = new THREE.Vector3(0, 0, 0);
    var focus = { id: null, rec: null };
    var _v = new THREE.Vector3();
    var simDays = 0;
    var spinPhase = 0;
    var hoverId = null;
    var lastHoverId = null;
    var cursor = '';
    var canvas = ctx.renderer && ctx.renderer.domElement;

    // 标签输出：对象数组只建一次，每帧原地写坐标
    var labelOut = [];
    for (var li = 0; li < recs.length; li++) {
      labelOut.push({
        id: recs[li].id,
        name: recs[li].data.name,
        x: 0, y: 0, visible: false
      });
    }
    // 标签避让缓存（预分配，每帧只写不建）
    var placeX = new Float32Array(recs.length);
    var placeY = new Float32Array(recs.length);

    /* 聚焦距离：让行星占屏幕高度的约 1/3，同时留出左侧档案栏的空间 */
    function focusDistance(rec) {
      return Math.max(rec.r * 5.0 + 0.45, 0.95);
    }

    function setCursor(kind) {
      if (!canvas) return;
      if (cursor === kind) return;
      cursor = kind;
      canvas.style.cursor = kind;
    }

    /* 选行星（场景侧入口）——写回状态并广播给 widget 开抽屉 */
    function select(id) {
      var rec = id ? byId[id] : null;
      if (!rec) {
        if (st.selected === null && focus.id === null) return;
        st.selected = null;
        focus.id = null;
        focus.rec = null;
        view.distTarget = defaultDist();
        COSMOS.emit('solar:focus', { id: null });
        return;
      }
      st.selected = id;
      focus.id = id;
      focus.rec = rec;
      view.distTarget = focusDistance(rec);
      COSMOS.emit('solar:focus', { id: id });
    }

    function resetView() {
      view.yaw = DEF.yaw;
      view.pitch = DEF.pitch;
      view.vy = 0;
      view.vp = 0;
      view.dist = defaultDist();
      view.distTarget = defaultDist();
      center.set(0, 0, 0);
      centerTarget.set(0, 0, 0);
      focus.id = null;
      focus.rec = null;
      st.selected = null;
      setCursor('');
    }

    var offZoom = COSMOS.on('solar:zoom', function (payload) {
      var dir = payload && payload.dir ? payload.dir : 1;
      var f = dir > 0 ? 0.82 : 1.22;
      view.distTarget = U.clamp(view.distTarget * f, LIMIT.distMin, LIMIT.distMax);
    });
    var offReset = COSMOS.on('solar:reset', function () {
      resetView();
    });

    // widget 的 chip 悬停 → 场景内对应行星提亮（不影响相机）
    var widgetHoverId = null;
    var offHover = COSMOS.on('solar:hover', function (payload) {
      widgetHoverId = payload && payload.id ? payload.id : null;
    });

    /* ---------------- 每帧 ---------------- */
    function update(t, dt, p) {
      if (!(dt > 0)) dt = 1 / 60;
      var inp = ctx.input || {};
      var keys = inp.keys || {};
      var paused = !!st.paused;
      var speed = +st.daysPerSec || 0;

      /* 入场推镜：p 在 v3 里是进入本章的 0.10→0.86 进度（约 2 秒） */
      var intro = U.clamp((p - 0.10) / 0.76, 0, 1);
      intro = intro * intro * (3 - 2 * intro);
      var introMul = 1.35 - 0.35 * intro;

      // 时间：只在未暂停时累积；角速度按真实公转周期
      if (!paused) {
        simDays += dt * speed;
        spinPhase += dt;
        sunMesh.rotation.y += dt * 0.012;
      }
      uTime.value = t;

      var i, rec, a, spinRate;
      for (i = 0; i < recs.length; i++) {
        rec = recs[i];
        a = rec.angle0 + (simDays / rec.data.yearDays) * TAU;
        rec.pivot.position.x = Math.cos(a) * rec.orbit;
        rec.pivot.position.z = Math.sin(a) * rec.orbit;

        // 自转是观感量：按真实天数的平方根压缩，避免高倍速下频闪
        spinRate = U.clamp(0.16 * Math.sqrt(24 / Math.max(rec.data.dayHours, 0.1)), 0.02, 0.55);
        rec.mesh.rotation.y = rec.spin0 + spinPhase * spinRate;
        if (rec.clouds) {
          rec.clouds.rotation.y = rec.mesh.rotation.y * 1.03 + 0.10;
          var cloudRel = (rec.clouds.rotation.y - rec.mesh.rotation.y) / TAU;
          rec.mat.uniforms.uCloudOffset.value = cloudRel - Math.floor(cloudRel);
        }
        if (rec.atmo) rec.atmo.rotation.y = rec.mesh.rotation.y;
        if (rec.ring) {
          rec.ringMat.uniforms.uPlanetPos.value.copy(rec.pivot.position);
          if (rec.id === 'saturn') {
            rec.mat.uniforms.uRingCenter.value.copy(rec.pivot.position);
          }
        }
      }

      /* 卫星公转：真实周期，轨道面与父行星赤道近似共面（略倾斜） */
      for (i = 0; i < moonRecs.length; i++) {
        var mrec = moonRecs[i];
        var ma = mrec.def.phase + (simDays / mrec.def.period) * TAU;
        mrec.mesh.position.set(
          Math.cos(ma) * mrec.orbitR,
          0,
          Math.sin(ma) * mrec.orbitR
        );
        mrec.mesh.rotation.y = ma + Math.PI;
      }

      // 小行星带 / 柯伊伯带慢转（暂停时冻结，与行星一致）
      if (!paused) {
        belt.rotation.y += dt * 0.012;
        dust.rotation.y += dt * 0.008;
        kuiper.rotation.y += dt * 0.004;
      }

      // widget 直接改 state.selected（chip / 抽屉关闭）→ 场景跟随
      if (st.selected !== focus.id) {
        if (st.selected && byId[st.selected]) {
          focus.id = st.selected;
          focus.rec = byId[st.selected];
          view.distTarget = focusDistance(focus.rec);
        } else {
          st.selected = null;
          focus.id = null;
          focus.rec = null;
          view.distTarget = defaultDist();
        }
      }

      /* ----- 指针：拖拽 1:1、松手惯性、缩放 ----- */
      if (inp.dragging && !inp.uiTarget) {
        view.yaw -= inp.dx * 0.0042;
        view.pitch = U.clamp(view.pitch + inp.dy * 0.0032, LIMIT.pitchMin, LIMIT.pitchMax);
        view.vy = -inp.dx * 0.0042;
        view.vp = inp.dy * 0.0032;
      } else if (!inp.down) {
        view.yaw += view.vy;
        view.pitch = U.clamp(view.pitch + view.vp, LIMIT.pitchMin, LIMIT.pitchMax);
        var decay = Math.exp(-dt * 3.6);
        view.vy *= decay;
        view.vp *= decay;
        if (Math.abs(view.vy) < 1e-5) view.vy = 0;
        if (Math.abs(view.vp) < 1e-5) view.vp = 0;
      }

      if (inp.pinch) {
        view.distTarget = U.clamp(
          view.distTarget / (1 + inp.pinch * 0.9),
          LIMIT.distMin, LIMIT.distMax
        );
      }
      if (inp.wheel) {
        /* 普通滚轮：向上滚拉近、向下滚拉远（boot.js 在标签页模式下把场景上的滚轮路由到这里） */
        view.distTarget = U.clamp(
          view.distTarget * Math.exp(inp.wheel * 0.0012),
          LIMIT.distMin, LIMIT.distMax
        );
      }
      if (inp.wheelCtrl) {
        view.distTarget = U.clamp(
          view.distTarget * (1 + inp.wheelCtrl * 0.0012),
          LIMIT.distMin, LIMIT.distMax
        );
      }

      /* ----- 键盘：←/→ 旋转、Q/E 俯仰、+/- 缩放（↑↓ 归翻章） ----- */
      if (keys['ArrowLeft'] || keys['a']) view.yaw += dt * 0.9;
      if (keys['ArrowRight'] || keys['d']) view.yaw -= dt * 0.9;
      if (keys['q']) view.pitch = U.clamp(view.pitch - dt * 0.55, LIMIT.pitchMin, LIMIT.pitchMax);
      if (keys['e']) view.pitch = U.clamp(view.pitch + dt * 0.55, LIMIT.pitchMin, LIMIT.pitchMax);
      if (keys['+'] || keys['=']) {
        view.distTarget = U.clamp(view.distTarget * Math.exp(-dt * 1.8), LIMIT.distMin, LIMIT.distMax);
      }
      if (keys['-'] || keys['_']) {
        view.distTarget = U.clamp(view.distTarget * Math.exp(dt * 1.8), LIMIT.distMin, LIMIT.distMax);
      }

      // 默认缓慢漂移；reduced-motion 下不漂移（拖拽仍可用）
      if (!ctx.reduceMotion) view.yaw += dt * (focus.id ? 0.018 : 0.028);

      /* ----- 相机：焦点阻尼 + 球坐标 + 入场推镜 ----- */
      if (focus.id && focus.rec) centerTarget.copy(focus.rec.pivot.position);
      else centerTarget.set(0, 0, 0);
      var k = 1 - Math.exp(-dt * 3.4);
      center.x += (centerTarget.x - center.x) * k;
      center.y += (centerTarget.y - center.y) * k;
      center.z += (centerTarget.z - center.z) * k;

      view.dist += (view.distTarget - view.dist) * Math.min(1, dt * 6);
      var camDist = view.dist * introMul;
      var cp = Math.cos(view.pitch);
      camera.position.set(
        center.x + Math.sin(view.yaw) * cp * camDist,
        center.y + Math.sin(view.pitch) * camDist,
        center.z + Math.cos(view.yaw) * cp * camDist
      );
      camera.lookAt(center);

      /* 日冕 / 日珥朝向相机（直接复制四元数，无 new） */
      corona.quaternion.copy(camera.quaternion);
      for (i = 0; i < flares.length; i++) {
        var fl = flares[i];
        var pulse = Math.sin(t * 0.55 + fl.phase);
        pulse = pulse > 0.72 ? Math.pow((pulse - 0.72) / 0.28, 2.0) : 0;
        fl.sprite.material.opacity = fl.base * pulse;
      }

      /* ----- 标签投影（零分配，等价 COSMOS.util.project） ----- */
      var labelsOff = st.labels === false;
      var nearestId = null;
      var nearestD = 30 * 30;
      var showHover = inp.x > 0 && inp.y > 0;
      /* 标签不许压到左侧文案：文案右缘 = padding + min(500, 43vw) */
      var safeX = isNarrow() ? 0 :
        Math.max(20, Math.min(width * 0.05, 96)) + Math.min(500, width * 0.43) + 12;
      var placeN = 0;
      for (i = 0; i < recs.length; i++) {
        rec = recs[i];
        _v.copy(rec.pivot.position).project(camera);
        var lab = labelOut[i];
        var sx = (_v.x * 0.5 + 0.5) * width;
        var sy = (-_v.y * 0.5 + 0.5) * height;
        lab.x = sx;
        lab.y = sy;
        lab.visible = !labelsOff && _v.z > -1 && _v.z < 1 && sx > safeX &&
          sx < width + 120 && sy > -60 && sy < height + 60;
        /* 相邻行星标签互相避让：重叠时保留先出现的（距离太阳更近的） */
        if (lab.visible) {
          for (var pj = 0; pj < placeN; pj++) {
            var ddx0 = sx - placeX[pj];
            var ddy0 = sy - placeY[pj];
            if (ddx0 > -66 && ddx0 < 66 && ddy0 > -24 && ddy0 < 24) {
              lab.visible = false;
              break;
            }
          }
          if (lab.visible) {
            placeX[placeN] = sx;
            placeY[placeN] = sy;
            placeN += 1;
          }
        }
        if (showHover && _v.z > -1 && _v.z < 1) {
          var ddx = sx - inp.x;
          var ddy = sy - inp.y;
          var dd = ddx * ddx + ddy * ddy;
          if (dd < nearestD) { nearestD = dd; nearestId = rec.id; }
        }
      }
      if (!labelsOff) st.labels = labelOut;

      if (nearestId !== lastHoverId) {
        lastHoverId = nearestId;
        hoverId = nearestId;
        setCursor(nearestId ? 'pointer' : '');
        COSMOS.emit('solar:hover', { id: nearestId });
      } else {
        hoverId = nearestId;
      }

      // 提亮：widget chip 悬停优先，其次画布悬停（着色器 uniform，阻尼过渡）
      var hlId = widgetHoverId || hoverId;
      for (i = 0; i < recs.length; i++) {
        rec = recs[i];
        var want = rec.id === hlId ? 1 : 0;
        rec.hover += (want - rec.hover) * Math.min(1, dt * 9);
        rec.mat.uniforms.uHover.value = rec.hover;
      }

      /* ----- 点击：raycast 优先，屏幕距离兜底 ----- */
      if (inp.click && !inp.uiTarget) {
        var hit = U.pick(meshes, camera, inp.click.nx, inp.click.ny);
        var pid = hit && hit.object && hit.object.userData ? hit.object.userData.pid : null;
        if (!pid) pid = hoverId;
        select(pid || null);
      }

      if (stars && stars.material && stars.material.uniforms) {
        stars.material.uniforms.uTime.value = t;
      }

      if (orbitGroup.visible !== (st.orbits !== false)) {
        orbitGroup.visible = st.orbits !== false;
        var oi;
        for (oi = 0; oi < moonLines.length; oi++) moonLines[oi].visible = orbitGroup.visible;
      }
    }

    function resize(w, h) {
      width = w || ctx.width;
      height = h || ctx.height;
      U.fitCamera(camera, 50, width / Math.max(height, 1));
      applyViewShift(width, height);
    }

    function enter() {
      lastHoverId = null;
      hoverId = null;
    }

    function leave() {
      setCursor('');
      lastHoverId = null;
      hoverId = null;
    }

    function reset() {
      resetView();
    }

    function dispose() {
      offZoom();
      offReset();
      offHover();
      setCursor('');
      scene.traverse(function (o) {
        if (o.userData && o.userData.isStarfield) return;
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          var mats = Array.isArray(o.material) ? o.material : [o.material];
          for (var mi = 0; mi < mats.length; mi++) {
            /* 贴图是全局缓存，其他场景可能还在用：只 dispose 材质/几何，
             * 不 dispose material.map。 */
            mats[mi].dispose();
          }
        }
      });
    }

    return {
      scene: scene,
      camera: camera,
      arrowKeys: true,
      update: update,
      resize: resize,
      enter: enter,
      leave: leave,
      reset: reset,
      dispose: dispose,
      bloom: { strength: 0.52, radius: 0.62, threshold: 0.82 }
    };
  });
})(window.COSMOS = window.COSMOS || {});
