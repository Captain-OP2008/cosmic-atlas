/* ============================================================
 * COSMOS ATLAS · js/nebula-bg.js
 * 抽象星云背景工厂（09 航天里程碑 / 10 现役与未来载具 / 11 未来计划）
 * ------------------------------------------------------------
 * 视觉族与 12 终章（js/scene-nebula.js）相同：fbm 体积云 + 丝状脊线 +
 * 气团点精灵 + 暗尘埃 + 恒星形成区 + 前景星点。区别是本文件做成参数化
 * 工厂，三章各传一套调色板与构图，并保留拖拽/视差/年份联动。
 *
 * 页面结构：这三章是文档流章节（.chapter.is-flow），3D 固定在背景，
 * 文字在左、NASA 照片在右，因此星云主体默认压在屏幕右侧（nebSx ≈ 0.70），
 * 左侧按 leftEdge 压暗，保证正文对比度。
 *
 * 参数（opts，未传的用 DEFAULTS）：
 *   palette  { ha, o3, vio, ion, warm, regions[3] }  线性空间 RGB
 *   nebSx / nebSy      星云脊线中心（屏幕 0~1）
 *   spreadX / spreadY  脊线分布范围
 *   gain               整体亮度
 *   cloudScale         体积云尺度（>1 更弥散）
 *   regions            恒星形成区数组 [{sx,sy,d,spread,tint}]
 *   camTravel          p 驱动推镜距离
 *   parallax / dragYaw / dragPitch / drift   交互幅度
 *   yearLink           true 时读 COSMOS.state.explore.year（09 章）
 *   bloom              后处理参数（沿用 12 章口径）
 *
 * 每帧三层信息：星云主体 / 恒星形成区与暗尘埃 / 前景星点与尘埃。
 * 粒子总数约 4.3 万，draw call 约 42，在 §5.3 预算内。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  if (!THREE) return;
  const U = COSMOS.util;
  const clamp = U.clamp;
  const damp = U.damp;
  const DEG = Math.PI / 180;

  const FOV = 42;
  const TAN_HALF = Math.tan(FOV * 0.5 * DEG);
  const REF_ASPECT = 16 / 9;
  const D_REF = 1000;
  const YEAR_MIN = 1957;
  const YEAR_MAX = 2024;

  /* 屏幕 x/y → 世界坐标（d 为深度；sy 从上到下增大，世界 y 向上为正） */
  function sxToWorldX(sx, d) { return (sx - 0.5) * 2 * TAN_HALF * REF_ASPECT * d; }
  function syToWorldY(sy, d) { return (0.5 - sy) * 2 * TAN_HALF * d; }

  /* ============================================================
   * 程序化纹理（模块级缓存：三章共用一份，只画一次）
   * ============================================================ */
  const texCache = {};

  function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }

  function finish(tex) {
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /* 柔云纹理：大量小气团叠加 + 椭圆径向遮罩，放大后仍是连续柔云 */
  function softCloudTexture(size, blobs, squish) {
    const key = 'neb-cloud-' + size + '-' + blobs;
    if (texCache[key]) return texCache[key];
    const c = makeCanvas(size);
    const g = c.getContext('2d', { willReadFrequently: false });
    const cx = size * 0.5, cy = size * 0.5;
    g.clearRect(0, 0, size, size);
    for (let i = 0; i < blobs; i++) {
      const ang = U.rand() * Math.PI * 2;
      const rad = Math.pow(U.rand(), 0.72) * size * 0.30;
      const bx = cx + Math.cos(ang) * rad;
      const by = cy + Math.sin(ang) * rad * squish;
      const rr = size * (0.030 + U.rand() * 0.070);
      const a = 0.045 + U.rand() * 0.125;
      const grd = g.createRadialGradient(bx, by, 0, bx, by, rr);
      grd.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(4) + ')');
      grd.addColorStop(0.45, 'rgba(255,255,255,' + (a * 0.52).toFixed(4) + ')');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(bx, by, rr, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    g.save();
    g.translate(cx, cy);
    g.scale(1, 0.60);
    const m = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.5);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.46, 'rgba(255,255,255,0.94)');
    m.addColorStop(0.76, 'rgba(255,255,255,0.34)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = m;
    g.beginPath();
    g.arc(0, 0, size * 0.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.globalCompositeOperation = 'destination-out';
    const b = Math.max(2, Math.round(size * 0.008));
    g.fillRect(0, 0, size, b);
    g.fillRect(0, size - b, size, b);
    g.fillRect(0, 0, b, size);
    g.fillRect(size - b, 0, b, size);
    g.globalCompositeOperation = 'source-over';
    return (texCache[key] = finish(new THREE.CanvasTexture(c)));
  }

  /* 丝状纹理：横向蜿蜒的细长暗带（暗尘埃 / 被照亮的云） */
  function filamentTexture(size) {
    const key = 'neb-fil-' + size;
    if (texCache[key]) return texCache[key];
    const c = makeCanvas(size);
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    const lanes = 6;
    for (let k = 0; k < lanes; k++) {
      const y0 = size * (0.30 + 0.40 * U.rand());
      const th = size * (0.012 + U.rand() * 0.030);
      const amp = size * (0.02 + U.rand() * 0.05);
      const ph = U.rand() * Math.PI * 2;
      const alpha = 0.16 + U.rand() * 0.34;
      const steps = 26;
      for (let i = 0; i < steps; i++) {
        const u = i / (steps - 1);
        const env = Math.sin(Math.PI * u);
        const x = u * size;
        const y = y0 + Math.sin(u * 5.6 + ph) * amp;
        const rr = th * (0.7 + env * 1.5);
        const grd = g.createRadialGradient(x, y, 0, x, y, rr);
        const a = alpha * env * env;
        grd.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(4) + ')');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalCompositeOperation = 'destination-in';
    g.save();
    g.translate(size * 0.5, size * 0.5);
    g.scale(1, 0.75);
    const m = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.5);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.55, 'rgba(255,255,255,0.86)');
    m.addColorStop(0.82, 'rgba(255,255,255,0.24)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = m;
    g.beginPath();
    g.arc(0, 0, size * 0.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.globalCompositeOperation = 'destination-out';
    const b = Math.max(2, Math.round(size * 0.008));
    g.fillRect(0, 0, size, b);
    g.fillRect(0, size - b, size, b);
    g.fillRect(0, 0, b, size);
    g.fillRect(size - b, 0, b, size);
    g.globalCompositeOperation = 'source-over';
    return (texCache[key] = finish(new THREE.CanvasTexture(c)));
  }

  /* ============================================================
   * 点精灵 shader
   * ============================================================ */

  // 气团：大、暗、柔，撑起星云体积
  const WISP_VS = [
    'uniform float uTime;',
    'uniform float uPixelRatio;',
    'attribute vec3 aColor;',
    'attribute float aSize;',
    'attribute float aSeed;',
    'varying vec3 vColor;',
    'varying float vSeed;',
    'void main () {',
    '  vec3 pos = position;',
    '  pos.x += sin(uTime * 0.061 + aSeed * 19.7) * 6.5;',
    '  pos.y += cos(uTime * 0.047 + aSeed * 27.3) * 5.0;',
    '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
    '  float depth = max(-mv.z, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = aSize * uPixelRatio * (1000.0 / depth);',
    '  vColor = aColor;',
    '  vSeed = aSeed;',
    '}'
  ].join('\n');

  const WISP_FS = [
    'uniform float uTime;',
    'uniform float uOpacity;',
    'varying vec3 vColor;',
    'varying float vSeed;',
    'void main () {',
    '  vec2 c = gl_PointCoord * 2.0 - 1.0;',
    '  float r2 = dot(c, c);',
    '  if (r2 > 1.0) discard;',
    '  float a = 1.0 - r2;',
    '  a = a * a * (0.72 + 0.28 * a);',
    '  float breathe = 0.70 + 0.30 * sin(uTime * 0.23 + vSeed * 31.0);',
    '  gl_FragColor = vec4(vColor * a * breathe * uOpacity, 1.0);',
    '}'
  ].join('\n');

  // 新生星点 / 前景恒星：小而锐，带闪烁
  const STAR_VS = [
    'uniform float uTime;',
    'uniform float uPixelRatio;',
    'attribute vec3 aColor;',
    'attribute float aSize;',
    'attribute float aPhase;',
    'varying vec3 vColor;',
    'varying float vTwk;',
    'void main () {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float depth = max(-mv.z, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float size = aSize * uPixelRatio * (300.0 / depth);',
    '  vTwk = 0.62 + 0.38 * sin(uTime * (1.1 + aPhase * 0.7) + aPhase * 41.0);',
    '  gl_PointSize = clamp(size, 1.0, 9.0) * (0.86 + 0.14 * vTwk);',
    '  vColor = aColor;',
    '}'
  ].join('\n');

  const STAR_FS = [
    'uniform float uOpacity;',
    'varying vec3 vColor;',
    'varying float vTwk;',
    'void main () {',
    '  vec2 c = gl_PointCoord * 2.0 - 1.0;',
    '  float d2 = dot(c, c);',
    '  if (d2 > 1.0) discard;',
    '  float a = exp(-d2 * 4.6) + 0.10;',
    '  gl_FragColor = vec4(vColor * a * vTwk * uOpacity, 1.0);',
    '}'
  ].join('\n');

  // 十字星芒：星团里最亮的那几颗
  const FLARE_VS = [
    'uniform float uTime;',
    'uniform float uPixelRatio;',
    'attribute vec3 aColor;',
    'attribute float aSize;',
    'attribute float aPhase;',
    'varying vec3 vColor;',
    'varying float vTwk;',
    'varying float vPx;',
    'void main () {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float depth = max(-mv.z, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = aSize * uPixelRatio * (1000.0 / depth);',
    '  vPx = gl_PointSize;',
    '  vTwk = 0.80 + 0.20 * sin(uTime * 1.7 + aPhase * 23.0);',
    '  vColor = aColor;',
    '}'
  ].join('\n');

  const FLARE_FS = [
    'uniform float uOpacity;',
    'varying vec3 vColor;',
    'varying float vTwk;',
    'varying float vPx;',
    'void main () {',
    '  vec2 c = gl_PointCoord * 2.0 - 1.0;',
    '  float d2 = dot(c, c);',
    '  if (d2 > 1.0) discard;',
    '  float core = exp(-d2 * 30.0);',
    '  float h = exp(-abs(c.y) * 34.0) * exp(-abs(c.x) * 2.8);',
    '  float v = exp(-abs(c.x) * 34.0) * exp(-abs(c.y) * 2.8);',
    '  float a = core + (h + v) * 0.40;',
    '  gl_FragColor = vec4(vColor * a * vTwk * uOpacity, 1.0);',
    '}'
  ].join('\n');

  // 前景尘埃：柔和圆斑，NormalBlending 遮挡
  const FDUST_VS = [
    'uniform float uPixelRatio;',
    'attribute float aAlpha;',
    'attribute float aSize;',
    'varying float vAlpha;',
    'void main () {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float depth = max(-mv.z, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = aSize * uPixelRatio * (300.0 / depth);',
    '  vAlpha = aAlpha * smoothstep(120.0, 320.0, depth);',
    '}'
  ].join('\n');

  const FDUST_FS = [
    'uniform float uOpacity;',
    'varying float vAlpha;',
    'void main () {',
    '  vec2 c = gl_PointCoord * 2.0 - 1.0;',
    '  float r2 = dot(c, c);',
    '  if (r2 > 1.0) discard;',
    '  float a = 1.0 - r2;',
    '  a = a * a;',
    '  gl_FragColor = vec4(0.0, 0.0, 0.0, a * vAlpha * uOpacity);',
    '}'
  ].join('\n');

  // 星云本体：fbm 体积云（连续丝状云 + 暗尘沟），颜色由 palette uniform 决定
  const NEBULA_FS = [
    'varying vec2 vUv;',
    'uniform float uTime;',
    'uniform vec2 uCenter;',
    'uniform vec2 uScale;',
    'uniform float uSeed;',
    'uniform float uGain;',
    'uniform float uP;',
    'uniform vec3 uHa;',
    'uniform vec3 uO3;',
    'uniform vec3 uVio;',
    'uniform vec3 uIon;',
    'uniform vec3 uWarm;',
    'uniform float uLeftEdge;',
    'uniform float uLeftSpan;',
    'uniform float uRightA;',
    'uniform float uRightB;',
    COSMOS.GLSL.noise,
    COSMOS.GLSL.fbm,
    'void main () {',
    '  vec2 p = (vUv - uCenter) / uScale;',
    '  float ca = 0.34, sa = 0.34;',
    '  vec2 q = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);',
    '  q.y *= 0.86;',
    '  float t = uTime * 0.018 + uSeed;',
    '  vec3 c1 = vec3(q * 1.35, t * 0.70);',
    '  float wa = fbm(c1, 4, 2.03, 0.55);',
    '  float wb = fbm(c1 + vec3(13.7, 5.3, 2.1), 4, 2.03, 0.55);',
    '  vec2 q2 = q * 2.35 + vec2(wa, wb) * 0.95;',
    '  float b = fbm(vec3(q2, t * 1.20), 5, 2.05, 0.52);',
    '  float fil = 1.0 - abs(b);',
    '  float g = fbm(vec3(q2 * 3.4 + 7.1, t * 2.10), 3, 2.20, 0.50);',
    '  float filD = pow(clamp(fil, 0.0, 1.0), 2.60);',
    '  float nlow = fbm(vec3(q * 1.05 + 3.3, t * 0.40), 4, 2.02, 0.55);',
    '  float mass = smoothstep(0.00, 0.80, nlow * 0.5 + 0.5);',
    '  float dens = mass * 0.95 + filD * 1.05 * (0.30 + 0.90 * mass);',
    '  float r = length((q + vec2(wa, wb) * 0.30) * vec2(0.95, 1.00));',
    '  float core = exp(-pow(r * 0.80, 2.35));',
    '  dens *= core;',
    '  float lane = smoothstep(0.38, 0.66, fbm(vec3(q * 1.60 + 21.3, t * 0.80), 3, 2.10, 0.50));',
    '  dens *= mix(0.08, 1.0, lane);',
    '  dens = pow(clamp(dens, 0.0, 2.2), 1.18) * 1.28;',
    '  vec3 col = mix(uHa, uO3, smoothstep(-0.35, 0.55, b * 1.2 + g * 0.45 + mass * 0.20) * 0.55);',
    '  col = mix(col, uVio, smoothstep(0.60, 1.15, r) * 0.55);',
    '  col += uIon * smoothstep(0.58, 0.96, fil) * (1.0 - lane) * 0.80;',
    '  col += uWarm * smoothstep(1.20, 3.20, dens) * 0.42;',
    // 左侧压暗（文字区），右侧留安全边距
    '  float leftFade = smoothstep(uLeftEdge, uLeftEdge + uLeftSpan, vUv.x);',
    '  float rightFade = 1.0 - smoothstep(uRightA, uRightB, vUv.x);',
    '  float gain = uGain * (0.90 + 0.10 * uP);',
    '  gl_FragColor = vec4(col * dens * gain * leftFade * rightFade, 1.0);',
    '}'
  ].join('\n');

  const NEB_VS = [
    'varying vec2 vUv;',
    'void main () {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  /* ============================================================
   * 默认参数
   * ============================================================ */
  const DEFAULTS = {
    nebSx: 0.70,
    nebSy: 0.44,
    spreadX: 1.0,
    spreadY: 1.0,
    gain: 1.0,
    cloudScale: 1.0,
    leftEdge: 0.34,
    leftSpan: 0.24,
    rightA: 0.94,
    rightB: 1.06,
    camTravel: 240,
    parallax: 0.055,
    dragYaw: 0.10,
    dragPitch: 0.06,
    drift: 1.0,
    yearLink: false,
    palette: {
      ha: [0.44, 0.105, 0.175],
      o3: [0.075, 0.265, 0.32],
      vio: [0.20, 0.085, 0.40],
      ion: [0.26, 0.54, 0.70],
      warm: [0.90, 0.76, 0.66],
      regions: [
        [1.30, 0.52, 0.74],
        [0.62, 1.15, 1.34],
        [0.86, 0.60, 1.45]
      ]
    },
    starCool: [0.86, 1.00, 1.35],
    starWarm: [1.20, 1.02, 0.78],
    bloom: { strength: 1.05, radius: 0.88, threshold: 0.62 }
  };

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function arr3(v, d) {
    if (!Array.isArray(v) || v.length < 3) return d;
    return [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])];
  }

  function mergeCfg(options) {
    const o = options || {};
    const cfg = {
      nebSx: num(o.nebSx, DEFAULTS.nebSx),
      nebSy: num(o.nebSy, DEFAULTS.nebSy),
      spreadX: num(o.spreadX, DEFAULTS.spreadX),
      spreadY: num(o.spreadY, DEFAULTS.spreadY),
      gain: num(o.gain, DEFAULTS.gain),
      cloudScale: num(o.cloudScale, DEFAULTS.cloudScale),
      leftEdge: num(o.leftEdge, DEFAULTS.leftEdge),
      leftSpan: num(o.leftSpan, DEFAULTS.leftSpan),
      rightA: num(o.rightA, DEFAULTS.rightA),
      rightB: num(o.rightB, DEFAULTS.rightB),
      camTravel: num(o.camTravel, DEFAULTS.camTravel),
      parallax: num(o.parallax, DEFAULTS.parallax),
      dragYaw: num(o.dragYaw, DEFAULTS.dragYaw),
      dragPitch: num(o.dragPitch, DEFAULTS.dragPitch),
      drift: num(o.drift, DEFAULTS.drift),
      yearLink: !!o.yearLink,
      starCool: arr3(o.starCool, DEFAULTS.starCool),
      starWarm: arr3(o.starWarm, DEFAULTS.starWarm),
      bloom: o.bloom || DEFAULTS.bloom
    };
    const p = o.palette || {};
    cfg.palette = {
      ha: arr3(p.ha, DEFAULTS.palette.ha),
      o3: arr3(p.o3, DEFAULTS.palette.o3),
      vio: arr3(p.vio, DEFAULTS.palette.vio),
      ion: arr3(p.ion, DEFAULTS.palette.ion),
      warm: arr3(p.warm, DEFAULTS.palette.warm),
      regions: (Array.isArray(p.regions) && p.regions.length >= 3)
        ? [arr3(p.regions[0], DEFAULTS.palette.regions[0]),
           arr3(p.regions[1], DEFAULTS.palette.regions[1]),
           arr3(p.regions[2], DEFAULTS.palette.regions[2])]
        : DEFAULTS.palette.regions
    };
    return cfg;
  }

  /* ============================================================
   * 场景工厂
   * ============================================================ */
  function makeNebulaBackdrop(ctx, options) {
    const cfg = mergeCfg(options);
    const isLow = ctx.quality === 'low';
    const aspect0 = ctx.aspect || REF_ASPECT;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, aspect0, 1, 8000);
    camera.position.set(0, 0, 0);

    const disposables = [];
    function keep(o) { disposables.push(o); return o; }
    const prUniforms = [];

    /* -------- 纹理（三章共享） -------- */
    const texCloud = softCloudTexture(isLow ? 512 : 1024, isLow ? 110 : 170, 0.62);
    const texFil = filamentTexture(isLow ? 512 : 768);
    const texGlow = COSMOS.tex.glowTexture(256);

    /* -------- 0. 深空星野 -------- */
    const bgStars = COSMOS.builders.makeStarfield({
      count: isLow ? 4200 : 7000,
      rMin: 1200,
      rMax: 2400
    });
    bgStars.renderOrder = -20;
    if (bgStars.material && bgStars.material.uniforms && bgStars.material.uniforms.uOpacity) {
      bgStars.material.uniforms.uOpacity.value = 0.90;
    }
    scene.add(bgStars);

    /* -------- 星云主体分组（resize 时整体平移保持构图） -------- */
    const nebGroup = new THREE.Group();
    scene.add(nebGroup);

    /* -------- 1a. 星云本体：两层 fbm 体积平面 -------- */
    const NEB_LAYERS = [
      { d: 980, seed: 3.7, gain: 1.50, sx: 0.40 * cfg.cloudScale, sy: 0.35 * cfg.cloudScale },
      { d: 1380, seed: 9.1, gain: 0.63, sx: 0.33 * cfg.cloudScale, sy: 0.28 * cfg.cloudScale }
    ];
    const nebPlanes = [];
    for (let i = 0; i < NEB_LAYERS.length; i++) {
      const L = NEB_LAYERS[i];
      const geo = keep(new THREE.PlaneGeometry(1, 1));
      const mat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector2(cfg.nebSx, cfg.nebSy) },
          uScale: { value: new THREE.Vector2(L.sx, L.sy) },
          uSeed: { value: L.seed },
          uGain: { value: L.gain * cfg.gain },
          uP: { value: 0 },
          uHa: { value: new THREE.Vector3(cfg.palette.ha[0], cfg.palette.ha[1], cfg.palette.ha[2]) },
          uO3: { value: new THREE.Vector3(cfg.palette.o3[0], cfg.palette.o3[1], cfg.palette.o3[2]) },
          uVio: { value: new THREE.Vector3(cfg.palette.vio[0], cfg.palette.vio[1], cfg.palette.vio[2]) },
          uIon: { value: new THREE.Vector3(cfg.palette.ion[0], cfg.palette.ion[1], cfg.palette.ion[2]) },
          uWarm: { value: new THREE.Vector3(cfg.palette.warm[0], cfg.palette.warm[1], cfg.palette.warm[2]) },
          uLeftEdge: { value: cfg.leftEdge },
          uLeftSpan: { value: cfg.leftSpan },
          uRightA: { value: cfg.rightA },
          uRightB: { value: cfg.rightB }
        },
        vertexShader: NEB_VS,
        fragmentShader: NEBULA_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      const m = new THREE.Mesh(geo, mat);
      m.position.z = -L.d;
      m.renderOrder = 0;
      m.frustumCulled = false;
      scene.add(m);
      nebPlanes.push({ mesh: m, d: L.d, mat: mat });
    }

    /* 星云平面是两片全屏 fbm（每像素约 23 次噪声），直接在主画布渲染会吃掉整个帧预算。
       改为低分辨率离屏渲染 + 隔帧重渲，再加法合成：片元开销 ÷6 左右，星云缓慢漂移，肉眼看不出帧率。 */
    const planeLayer = keep(COSMOS.util.makeLowResLayer({
      planes: nebPlanes.map(function (pl) { return pl.mesh; }),
      scene: scene,
      camera: camera,
      renderer: ctx.renderer,
      scale: isLow ? 0.3 : 0.4,
      every: isLow ? 3 : 2,
      renderOrder: 0
    }));

    function sizePlanes(aspect) {
      const a = aspect && aspect > 0.1 ? aspect : REF_ASPECT;
      for (let i = 0; i < nebPlanes.length; i++) {
        const pl = nebPlanes[i];
        const hh = 2 * TAN_HALF * pl.d * 1.02;
        pl.mesh.scale.set(hh * a, hh, 1);
      }
    }

    /* -------- 1. 星云骨架：屏幕空间扇开的丝状脊线 -------- */
    const N_SPINE = isLow ? 5 : 8;
    const SPINES = [];
    for (let i = 0; i < N_SPINE; i++) {
      const v = N_SPINE === 1 ? 0.5 : i / (N_SPINE - 1);
      SPINES.push({
        cx: cfg.nebSx + (U.rand() - 0.5) * 0.17 * cfg.spreadX,
        cy: cfg.nebSy + (U.rand() - 0.5) * 0.20 * cfg.spreadY,
        th: -0.92 + 1.84 * v + (U.rand() - 0.5) * 0.34,
        len: 0.26 + U.rand() * 0.38,
        cv: (U.rand() - 0.5) * 0.55,
        d0: 860 + U.rand() * 440,
        du: (U.rand() - 0.5) * 280
      });
    }

    const _sv = { x: 0, y: 0, z: 0, d: 0, sx: 0.5, sy: 0.5 };
    function spineAt(sp, u) {
      const uu = u - 0.5;
      const bend = sp.cv * (1.0 - 4.0 * uu * uu) * sp.len;
      const sx = sp.cx + Math.cos(sp.th) * sp.len * uu + Math.cos(sp.th + 1.5707963) * bend;
      const sy = sp.cy + Math.sin(sp.th) * sp.len * uu + Math.sin(sp.th + 1.5707963) * bend;
      const d = sp.d0 + sp.du * (u - 0.5);
      _sv.sx = sx;
      _sv.sy = sy;
      _sv.x = sxToWorldX(sx, d);
      _sv.y = syToWorldY(sy, d);
      _sv.z = -d;
      _sv.d = d;
      return _sv;
    }

    /* -------- 1b. 沿脊线的细长柔云（低 opacity 多层叠加） -------- */
    const GAS_COLORS = [cfg.palette.ha, cfg.palette.o3, cfg.palette.vio];
    const gasSprites = [];
    const gasP = [];
    const N_GAS = isLow ? 6 : 10;

    for (let i = 0; i < N_GAS; i++) {
      const sp = SPINES[i % N_SPINE];
      const u = 0.20 + U.rand() * 0.64;
      const p3 = spineAt(sp, u);
      const px3 = p3.x, py3 = p3.y, pz3 = p3.z, pd = p3.d;
      const armW = sp.len * 2 * TAN_HALF * REF_ASPECT * pd;
      const w = armW * (0.66 + U.rand() * 0.52);
      const h = w * (0.24 + U.rand() * 0.22);

      const ci = i % 3;
      const base = GAS_COLORS[ci];
      const boost = 0.82 + U.rand() * 0.40;
      const r = base[0] * boost + 0.012;
      const g = base[1] * boost + 0.015;
      const b = base[2] * boost + 0.022;

      const mat = keep(new THREE.SpriteMaterial({
        map: texCloud,
        color: new THREE.Color().setRGB(r, g, b),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0.001
      }));
      const sp2 = new THREE.Sprite(mat);
      sp2.position.set(px3, py3, pz3);
      sp2.scale.set(w, h, 1);
      sp2.renderOrder = 1;
      sp2.material.rotation = -sp.th + (U.rand() - 0.5) * 0.16;
      nebGroup.add(sp2);

      const baseOpacity = (0.036 + U.rand() * 0.050) * cfg.gain;
      gasSprites.push(sp2);
      gasP.push({
        bx: px3, by: py3,
        baseOpacity: baseOpacity,
        phase: U.rand() * Math.PI * 2,
        speed: 0.09 + U.rand() * 0.15,
        drift: (6 + U.rand() * 16) * cfg.drift,
        driftRate: 0.030 + U.rand() * 0.040,
        rot0: sp2.material.rotation,
        rotAmp: 0.010 + U.rand() * 0.022
      });
    }

    /* -------- 2. 星云体积：气团点精灵沿脊线成丝 -------- */
    const N_WISP = Math.round((isLow ? 13000 : 30000) * Math.max(0.4, cfg.gain));
    let wispMat = null;
    {
      const pos = new Float32Array(N_WISP * 3);
      const col = new Float32Array(N_WISP * 3);
      const siz = new Float32Array(N_WISP);
      const sed = new Float32Array(N_WISP);
      for (let i = 0; i < N_WISP; i++) {
        const si = i % N_SPINE;
        const sp = SPINES[si];
        const u = U.rand();
        const p3 = spineAt(sp, u);
        const pd = p3.d;
        const gs = (U.rand() + U.rand() + U.rand() - 1.5) / 1.5;
        const off = gs * (0.014 + U.rand() * 0.040);
        const perpX = -Math.sin(sp.th);
        const perpY = Math.cos(sp.th);
        pos[i * 3] = p3.x + perpX * off * 2 * TAN_HALF * REF_ASPECT * pd;
        pos[i * 3 + 1] = p3.y + perpY * off * 2 * TAN_HALF * pd;
        pos[i * 3 + 2] = p3.z + (U.rand() - 0.5) * 130;

        const base = GAS_COLORS[si % 3];
        const hot = U.rand() < 0.05;
        let k = hot ? (0.014 + U.rand() * 0.030) : (0.005 + U.rand() * 0.012);
        const dx = (p3.sx - cfg.nebSx) / 0.44;
        const dy = (p3.sy - cfg.nebSy) / 0.38;
        k *= Math.exp(-(dx * dx + dy * dy) * 1.15);
        const jitter = 0.72 + U.rand() * 0.55;
        col[i * 3] = (base[0] * 0.92 + 0.020) * jitter * k * 6.0;
        col[i * 3 + 1] = (base[1] * 0.92 + 0.026) * jitter * k * 6.0;
        col[i * 3 + 2] = (base[2] * 0.95 + 0.040) * jitter * k * 6.0;

        siz[i] = hot ? (3 + U.rand() * 5) : (1.1 + U.rand() * 2.6);
        sed[i] = U.rand();
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(sed, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -1000), 2400);

      wispMat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 0.86 }
        },
        vertexShader: WISP_VS,
        fragmentShader: WISP_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      prUniforms.push(wispMat.uniforms.uPixelRatio);
      const pts = new THREE.Points(geo, wispMat);
      pts.renderOrder = 3;
      pts.frustumCulled = false;
      nebGroup.add(pts);
    }

    /* -------- 3. 暗尘埃带 -------- */
    const dustSprites = [];
    const dustP = [];
    const N_DUST = isLow ? 5 : 8;
    for (let i = 0; i < N_DUST; i++) {
      const u = (i + 0.5) / N_DUST;
      const sx = cfg.nebSx + (u - 0.5) * 0.42 * cfg.spreadX + (U.rand() - 0.5) * 0.12;
      const sy = cfg.nebSy + (u - 0.5) * 0.34 * cfg.spreadY + (U.rand() - 0.5) * 0.16;
      const d = 520 + U.rand() * 420;
      const w = 560 + U.rand() * 620;
      const h = w * (0.13 + U.rand() * 0.10);
      const mat = keep(new THREE.SpriteMaterial({
        map: texFil,
        color: new THREE.Color(0, 0, 0),
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0.001
      }));
      const sp = new THREE.Sprite(mat);
      sp.position.set(sxToWorldX(sx, d), syToWorldY(sy, d), -d);
      sp.scale.set(w, h, 1);
      sp.renderOrder = 10;
      sp.material.rotation = -0.30 + (U.rand() - 0.5) * 0.85;
      nebGroup.add(sp);
      dustSprites.push(sp);
      dustP.push({
        baseOpacity: 0.16 + U.rand() * 0.16,
        phase: U.rand() * Math.PI * 2,
        speed: 0.06 + U.rand() * 0.10,
        rot0: sp.material.rotation,
        rotAmp: 0.02 + U.rand() * 0.035,
        bx: sp.position.x, by: sp.position.y,
        drift: (5 + U.rand() * 12) * cfg.drift
      });
    }

    /* -------- 4. 恒星形成区 -------- */
    const REGIONS = cfg.regions || [
      { sx: cfg.nebSx - 0.06, sy: cfg.nebSy + 0.13, d: 860, spread: 15, tint: 0 },
      { sx: cfg.nebSx + 0.08, sy: cfg.nebSy - 0.04, d: 1040, spread: 19, tint: 1 },
      { sx: cfg.nebSx - 0.10, sy: cfg.nebSy - 0.06, d: 1160, spread: 13, tint: 2 },
      { sx: cfg.nebSx + 0.04, sy: cfg.nebSy + 0.24, d: 760, spread: 21, tint: 1 }
    ];
    const REGION_COLORS = cfg.palette.regions;
    const regionGlows = [];
    const regionCores = [];
    const regionPos = [];

    for (let i = 0; i < REGIONS.length; i++) {
      const rg = REGIONS[i];
      const x = sxToWorldX(rg.sx, rg.d);
      const y = syToWorldY(rg.sy, rg.d);
      const z = -rg.d;
      regionPos.push({ x: x, y: y, z: z, d: rg.d, spread: rg.spread });
      const c = REGION_COLORS[rg.tint % 3];

      const lit = keep(new THREE.SpriteMaterial({
        map: texFil,
        color: new THREE.Color().setRGB(c[0] * 0.50, c[1] * 0.50, c[2] * 0.50),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0.001
      }));
      const litS = new THREE.Sprite(lit);
      litS.position.set(x + (U.rand() - 0.5) * 30, y + (U.rand() - 0.5) * 24, z + 40);
      litS.scale.set(rg.d * (0.46 + U.rand() * 0.20), rg.d * (0.20 + U.rand() * 0.10), 1);
      litS.material.rotation = (U.rand() - 0.5) * 1.6;
      litS.renderOrder = 5;
      nebGroup.add(litS);

      const halo = keep(new THREE.SpriteMaterial({
        map: texGlow,
        color: new THREE.Color().setRGB(c[0] * 0.30, c[1] * 0.30, c[2] * 0.30),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0.001
      }));
      const haloS = new THREE.Sprite(halo);
      haloS.position.set(x, y, z + 10);
      haloS.scale.set(rg.d * 0.20, rg.d * 0.20, 1);
      haloS.renderOrder = 6;
      nebGroup.add(haloS);

      const core = keep(new THREE.SpriteMaterial({
        map: texGlow,
        color: new THREE.Color().setRGB(c[0] * 1.45, c[1] * 1.45, c[2] * 1.45),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0.001
      }));
      const coreS = new THREE.Sprite(core);
      coreS.position.set(x, y, z);
      coreS.scale.set(rg.d * 0.042, rg.d * 0.042, 1);
      coreS.renderOrder = 7;
      nebGroup.add(coreS);

      const warm = keep(new THREE.SpriteMaterial({
        map: texGlow,
        color: new THREE.Color().setRGB(
          cfg.palette.warm[0] * 2.2,
          cfg.palette.warm[1] * 2.2,
          cfg.palette.warm[2] * 2.2
        ),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0.001
      }));
      const warmS = new THREE.Sprite(warm);
      warmS.position.set(x, y, z + 4);
      warmS.scale.set(rg.d * 0.020, rg.d * 0.020, 1);
      warmS.renderOrder = 8;
      nebGroup.add(warmS);

      regionGlows.push({
        lit: litS, halo: haloS, core: coreS, warm: warmS,
        litBase: 0.155, haloBase: 0.050, coreBase: 0.78, warmBase: 0.70,
        phase: U.rand() * Math.PI * 2,
        speed: 0.22 + U.rand() * 0.3
      });
      regionCores.push(i * 0.16);
    }

    /* -------- 4b. 新生星点 -------- */
    const N_NEW = isLow ? 1000 : 2200;
    let newStarMat = null;
    {
      const pos = new Float32Array(N_NEW * 3);
      const col = new Float32Array(N_NEW * 3);
      const siz = new Float32Array(N_NEW);
      const pha = new Float32Array(N_NEW);
      for (let i = 0; i < N_NEW; i++) {
        const ri = i % REGIONS.length;
        const rp = regionPos[ri];
        const a = U.rand() * Math.PI * 2;
        const rad = Math.pow(U.rand(), 1.7) * rp.spread * 3.4;
        pos[i * 3] = rp.x + Math.cos(a) * rad;
        pos[i * 3 + 1] = rp.y + Math.sin(a) * rad * 0.92;
        pos[i * 3 + 2] = rp.z + (U.rand() - 0.5) * rp.spread * 2.4;
        const bright = 0.35 + Math.pow(U.rand(), 2.4) * 2.6;
        const warmStar = U.rand() < 0.22;
        const base = warmStar ? cfg.starWarm : cfg.starCool;
        col[i * 3] = base[0] * bright;
        col[i * 3 + 1] = base[1] * bright;
        col[i * 3 + 2] = base[2] * bright;
        siz[i] = 1.0 + Math.pow(U.rand(), 2.0) * 3.2;
        pha[i] = U.rand();
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -1000), 2200);
      newStarMat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 1.0 }
        },
        vertexShader: STAR_VS,
        fragmentShader: STAR_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      prUniforms.push(newStarMat.uniforms.uPixelRatio);
      const pts = new THREE.Points(geo, newStarMat);
      pts.renderOrder = 9;
      pts.frustumCulled = false;
      nebGroup.add(pts);
    }

    /* -------- 4c. 十字星芒 -------- */
    let flareMat = null;
    {
      const N = REGIONS.length * 3;
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      const siz = new Float32Array(N);
      const pha = new Float32Array(N);
      let k = 0;
      for (let i = 0; i < REGIONS.length; i++) {
        const rp = regionPos[i];
        for (let j = 0; j < 3; j++) {
          const a = U.rand() * Math.PI * 2;
          const rad = U.rand() * rp.spread * 1.5;
          pos[k * 3] = rp.x + Math.cos(a) * rad;
          pos[k * 3 + 1] = rp.y + Math.sin(a) * rad;
          pos[k * 3 + 2] = rp.z + (U.rand() - 0.5) * rp.spread;
          const bright = 1.5 + U.rand() * 1.5;
          col[k * 3] = cfg.starCool[0] * bright;
          col[k * 3 + 1] = cfg.starCool[1] * bright;
          col[k * 3 + 2] = cfg.starCool[2] * bright;
          siz[k] = 18 + U.rand() * 26;
          pha[k] = U.rand();
          k++;
        }
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -1000), 2200);
      flareMat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 0.9 }
        },
        vertexShader: FLARE_VS,
        fragmentShader: FLARE_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      prUniforms.push(flareMat.uniforms.uPixelRatio);
      const pts = new THREE.Points(geo, flareMat);
      pts.renderOrder = 12;
      pts.frustumCulled = false;
      nebGroup.add(pts);
    }

    /* -------- 5. 前景恒星 -------- */
    const N_FG = isLow ? 1300 : 2600;
    let fgStarMat = null;
    {
      const pos = new Float32Array(N_FG * 3);
      const col = new Float32Array(N_FG * 3);
      const siz = new Float32Array(N_FG);
      const pha = new Float32Array(N_FG);
      for (let i = 0; i < N_FG; i++) {
        const sx = U.rand();
        const sy = U.rand();
        const d = 160 + U.rand() * 520;
        pos[i * 3] = sxToWorldX(sx, d);
        pos[i * 3 + 1] = syToWorldY(sy, d);
        pos[i * 3 + 2] = -d;
        const dim = sx < cfg.leftEdge + 0.10 ? 0.55 : 1.0;
        const bright = (0.10 + Math.pow(U.rand(), 2.6) * 0.95) * dim;
        const warm = U.rand() < 0.30;
        const base = warm ? cfg.starWarm : cfg.starCool;
        col[i * 3] = base[0] * bright;
        col[i * 3 + 1] = base[1] * bright;
        col[i * 3 + 2] = base[2] * bright;
        siz[i] = 1.1 + Math.pow(U.rand(), 2.2) * 3.4;
        pha[i] = U.rand();
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -400), 1400);
      fgStarMat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 1.0 }
        },
        vertexShader: STAR_VS,
        fragmentShader: STAR_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      prUniforms.push(fgStarMat.uniforms.uPixelRatio);
      const pts = new THREE.Points(geo, fgStarMat);
      pts.renderOrder = 14;
      pts.frustumCulled = false;
      scene.add(pts);
    }

    /* -------- 6. 前景尘埃 -------- */
    let fgDustMat = null;
    {
      const N = isLow ? 340 : 700;
      const pos = new Float32Array(N * 3);
      const siz = new Float32Array(N);
      const alp = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const sx = 0.34 + U.rand() * 0.72;
        const sy = U.rand();
        const d = 150 + U.rand() * 340;
        pos[i * 3] = sxToWorldX(sx, d);
        pos[i * 3 + 1] = syToWorldY(sy, d);
        pos[i * 3 + 2] = -d;
        siz[i] = 24 + U.rand() * 66;
        alp[i] = 0.05 + U.rand() * 0.13;
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -300), 1400);
      fgDustMat = keep(new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 1.0 } },
        vertexShader: FDUST_VS,
        fragmentShader: FDUST_FS,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: false
      }));
      prUniforms.push(fgDustMat.uniforms.uPixelRatio);
      const pts = new THREE.Points(geo, fgDustMat);
      pts.renderOrder = 16;
      pts.frustumCulled = false;
      scene.add(pts);
    }

    /* -------- 布局：按视口比例平移星云组，保持右侧构图 -------- */
    const baseShiftX = (cfg.nebSx - 0.5) * 2 * TAN_HALF * REF_ASPECT * D_REF;
    function layout(aspect) {
      if (!(aspect > 0.1)) return;
      const want = (cfg.nebSx - 0.5) * 2 * TAN_HALF * aspect * D_REF;
      nebGroup.position.x = want - baseShiftX;
    }
    layout(aspect0);

    /* -------- resize -------- */
    function resize(w, h) {
      const aspect = w / Math.max(h, 1);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      layout(aspect);
      sizePlanes(aspect);
      const pr = Math.min(ctx.pixelRatio || 1, 2);
      for (let i = 0; i < prUniforms.length; i++) prUniforms[i].value = pr;
    }
    resize(ctx.width || 1440, ctx.height || 810);

    /* -------- 交互状态（闭包内，禁止每帧 new） -------- */
    let yaw = 0, pitch = 0, yawT = 0, pitchT = 0;
    let yearSmooth = 1969;
    let first = true;

    function reset() { yawT = 0; pitchT = 0; }

    /* -------- update -------- */
    function update(t, dt, p) {
      const q = p === undefined ? 0 : clamp(p, 0, 1);
      const e = U.ease.inOutCubic(q);
      const reduce = !!(ctx.reduceMotion && ctx.reduceMotion.matches);
      const input = ctx.input || {};

      /* 拖拽环绕（uiTarget 时不响应，避免和控件抢手势） */
      if (input.dragging && !input.uiTarget) {
        yawT -= (input.dx || 0) * 0.0016;
        pitchT += (input.dy || 0) * 0.0010;
      }
      yawT = clamp(yawT, -cfg.dragYaw, cfg.dragYaw);
      pitchT = clamp(pitchT, -cfg.dragPitch, cfg.dragPitch);

      const parX = reduce ? 0 : (input.nx || 0) * cfg.parallax;
      const parY = reduce ? 0 : (input.ny || 0) * cfg.parallax * 0.6;
      yaw = damp(yaw, yawT + parX, 3.4, dt);
      pitch = damp(pitch, pitchT + parY, 3.4, dt);

      /* 年份联动（09 章）：时间轴推进 → 星云更亮、星团更活跃 */
      let yearK = 0;
      if (cfg.yearLink) {
        const s = COSMOS.state && COSMOS.state.explore;
        const yv = s && typeof s.year === 'number' ? s.year : 1969;
        yearSmooth = damp(yearSmooth, yv, 2.4, dt);
        yearK = clamp((yearSmooth - YEAR_MIN) / (YEAR_MAX - YEAR_MIN), 0, 1);
      }

      /* 相机：极缓推进 + 横摇 + 拖拽环绕 */
      const drift = reduce ? 0 : cfg.drift;
      camera.position.z = -cfg.camTravel * e;
      camera.position.x = Math.sin(t * 0.037) * 13.0 * drift + Math.sin(t * 0.0141) * 7.0 * drift;
      camera.position.y = Math.cos(t * 0.031) * 8.5 * drift;
      camera.rotation.z = -0.028 + Math.sin(t * 0.024) * 0.013 * drift;
      camera.rotation.y = Math.sin(t * 0.019) * 0.022 * drift + e * 0.02
        + yaw + (yearK - 0.5) * 0.10;
      camera.rotation.x = Math.cos(t * 0.017) * 0.010 * drift + pitch;
      camera.updateMatrixWorld();

      /* 星云本体：时间演化 + 年份提亮 */
      const planeYear = cfg.yearLink ? (0.88 + 0.22 * yearK) : 1.0;
      for (let i = 0; i < nebPlanes.length; i++) {
        const pl = nebPlanes[i];
        pl.mat.uniforms.uTime.value = t;
        pl.mat.uniforms.uP.value = q;
        pl.mat.uniforms.uGain.value = NEB_LAYERS[i].gain * cfg.gain * planeYear;
      }
      /* uniform 更新完再离屏渲染，避免半分辨率层落后一帧 */
      planeLayer.render();

      /* 云层：漂移 + 呼吸 + 缓慢自转 */
      for (let i = 0; i < N_GAS; i++) {
        const a = gasP[i];
        const s = gasSprites[i];
        const ph = a.phase;
        s.position.x = a.bx + Math.sin(t * a.driftRate + ph) * a.drift;
        s.position.y = a.by + Math.cos(t * a.driftRate * 0.83 + ph * 1.7) * a.drift * 0.62;
        s.material.opacity = a.baseOpacity * (0.76 + 0.24 * Math.sin(t * a.speed + ph));
        s.material.rotation = a.rot0 + Math.sin(t * 0.043 + ph) * a.rotAmp;
      }

      /* 暗尘埃：轻微呼吸与转动 */
      for (let i = 0; i < N_DUST; i++) {
        const a = dustP[i];
        const s = dustSprites[i];
        s.material.opacity = a.baseOpacity * (0.84 + 0.16 * Math.sin(t * a.speed + a.phase));
        s.material.rotation = a.rot0 + Math.sin(t * 0.031 + a.phase) * a.rotAmp;
        s.position.x = a.bx + Math.sin(t * 0.019 + a.phase) * a.drift;
        s.position.y = a.by + Math.cos(t * 0.015 + a.phase) * a.drift * 0.6;
      }

      /* 恒星形成区：呼吸 + 随 p 点亮 + 年份增亮 */
      const ignite = U.smoothstep(0.05, 0.62, q) * (cfg.yearLink ? (0.55 + 0.62 * yearK) : 1.0);
      for (let i = 0; i < regionGlows.length; i++) {
        const r = regionGlows[i];
        const ign = clamp(ignite * 1.25 - regionCores[i], 0, 1);
        const pulse = 0.90 + 0.10 * Math.sin(t * r.speed + r.phase);
        r.lit.material.opacity = r.litBase * ign * pulse;
        r.halo.material.opacity = r.haloBase * ign * pulse;
        r.core.material.opacity = r.coreBase * ign * (0.94 + 0.06 * Math.sin(t * r.speed * 1.7 + r.phase));
        r.warm.material.opacity = r.warmBase * ign * pulse;
      }

      /* shader 时间与年份亮度 */
      wispMat.uniforms.uTime.value = t;
      wispMat.uniforms.uOpacity.value = 0.86 * (cfg.yearLink ? (0.80 + 0.30 * yearK) : 1.0);
      newStarMat.uniforms.uTime.value = t;
      /* 年表隐喻：1957 年几乎只有一颗，2024 年人造目标铺满视场 */
      newStarMat.uniforms.uOpacity.value = cfg.yearLink ? (0.16 + 1.10 * yearK) : 1.0;
      flareMat.uniforms.uTime.value = t;
      fgStarMat.uniforms.uTime.value = t;

      /* 前景尘埃：p 推进时淡出，避免糊屏 */
      fgDustMat.uniforms.uOpacity.value = 1.0 - 0.55 * e;

      if (first) {
        first = false;
        for (let i = 0; i < N_GAS; i++) gasSprites[i].material.opacity = gasP[i].baseOpacity;
        for (let i = 0; i < N_DUST; i++) dustSprites[i].material.opacity = dustP[i].baseOpacity;
      }
    }

    /* -------- dispose：只释放本实例的几何/材质；纹理是共享缓存 -------- */
    function dispose() {
      for (let i = 0; i < disposables.length; i++) {
        const d = disposables[i];
        if (d && typeof d.dispose === 'function') d.dispose();
      }
      disposables.length = 0;
    }

    return {
      scene: scene,
      camera: camera,
      update: update,
      resize: resize,
      reset: reset,
      leave: reset,
      dispose: dispose,
      bloom: cfg.bloom
    };
  }

  COSMOS.nebulaBackdrop = makeNebulaBackdrop;
})(window.COSMOS = window.COSMOS || {});
