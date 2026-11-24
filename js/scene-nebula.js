/* ============================================================
 * COSMOS ATLAS · 第 06 章「深空星云」(stage: deepfield)
 * ------------------------------------------------------------
 * 视觉结构（由远及近）：
 *   0. 深空星野    makeStarfield 7000 颗（球壳 1200~2400，几乎不动）
 *   1. 星云主体    18 个巨大的柔云 sprite，沿一条倾斜脊线排布，
 *                  品红 / 青 / 紫 三色多层加法叠加，每层独立漂移 + 呼吸
 *   2. 星云体积    6500 个「气团」点精灵（大而暗）填补丝状体积感
 *   3. 暗尘埃带    7 条深色丝状遮挡（NormalBlending 黑），切出层次
 *   4. 恒星形成区  4 处灼亮新生星团：HDR 光核 + 被照亮的云 + 密集新生星点 + 十字星芒
 *   5. 前景星点    2600 颗细小闪烁恒星
 *   6. 前景尘埃    700 个大而暗的尘埃团，p 推进时从镜头前掠过
 *
 * 构图：星云主体压在画面右侧（脊线中心 ≈ 屏幕 x 0.665），左侧 0~42% 留黑给文字。
 * 镜头：相机沿 -z 推进 CAM_TRAVEL = 330（≈ 主体深度的 33%），配合极缓的横摇/滚转。
 *
 * 约定：所有「屏幕坐标」一律 sx, sy ∈ [0,1]，sy 从上到下增大（与纹理一致），
 *       世界坐标 y 向上为正，因此屏幕 → 世界 必须用 (0.5 - sy)。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  const U = COSMOS.util;
  const DEG = Math.PI / 180;

  /* ============================================================
   * TUNE —— 调参集中区（改这里就能整体调）
   * ============================================================ */
  const TUNE = {
    gasGain: 1.00,       // 星云大云层整体亮度
    wispGain: 1.00,      // 气团点精灵（体积感）亮度
    dustGain: 1.00,      // 暗尘埃带强度
    regionGain: 1.00,    // 恒星形成区亮度
    starGain: 1.00,      // 新生星点亮度
    fgStarGain: 1.00,    // 前景恒星亮度
    fgDustGain: 1.00,    // 前景尘埃遮挡强度
    leftFade: 0.55,      // 左侧文字区衰减系数
    bloom: { strength: 1.05, radius: 0.88, threshold: 0.62 }
  };

  /* ============================================================
   * 构图 / 投影常量
   * ============================================================ */
  const FOV = 42;
  const TAN_HALF = Math.tan(FOV * 0.5 * DEG);
  const REF_ASPECT = 16 / 9;
  const NEB_SX = 0.648;        // 星云脊线中心屏幕 x
  const NEB_SY = 0.470;        // 星云脊线中心屏幕 y
  const D_REF = 1000;          // 主体参考深度
  const CAM_TRAVEL = 330;      // 相机推进距离
  const LEFT_EDGE = 0.455;     // 小于它的区域按 leftFade 压暗

  // 屏幕 x/y → 世界坐标（d 为深度）
  function sxToWorldX(sx, d) { return (sx - 0.5) * 2 * TAN_HALF * REF_ASPECT * d; }
  function syToWorldY(sy, d) { return (0.5 - sy) * 2 * TAN_HALF * d; }

  /* ============================================================
   * 纹理（全部程序化，禁止外部资源）
   * ============================================================ */
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

  /* 柔云纹理：150 个远小于贴图的小气团叠加 + 椭圆径向遮罩。
     对比 COSMOS.tex.cloudTexture（团块过大，放大后会出现散景圆斑），
     这个版本放大到 1000px 仍是连续柔和的云，适合做巨大星云层。 */
  function softCloudTexture(size, blobs, squish, seedOff) {
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
    // 椭圆径向遮罩：四边 alpha 严格为 0，任何缩放都不会露出矩形边
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
    return finish(new THREE.CanvasTexture(c));
  }

  /* 丝状纹理：沿水平方向蜿蜒的细长暗带（用于暗尘埃 / 前景薄雾）。
     同样是「椭圆遮罩 + 清边」，不会有硬边。 */
  function filamentTexture(size) {
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
        // 两端渐隐，中间实
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
    return finish(new THREE.CanvasTexture(c));
  }

  /* ============================================================
   * 点精灵 shader
   * ============================================================ */

  // —— 气团（星云体积感）：大、暗、柔 ——
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

  // —— 新生星点 / 前景恒星：小而锐，带闪烁 ——
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

  // —— 十字星芒（星团里最亮的那几颗）——
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

  // —— 前景尘埃：柔和圆斑，NormalBlending 遮挡 ——
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
    '  // 太靠近镜头时淡出，避免糊满屏幕',
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

  // —— 星云本体：fbm 体积着色（连续丝状云 + 暗尘沟，没有 sprite 边）——
  const NEBULA_FS = [
    'varying vec2 vUv;',
    'uniform float uTime;',
    'uniform vec2 uCenter;',
    'uniform vec2 uScale;',
    'uniform float uSeed;',
    'uniform float uGain;',
    'uniform float uP;',
    COSMOS.GLSL.noise,
    COSMOS.GLSL.fbm,
    'void main () {',
    '  vec2 p = (vUv - uCenter) / uScale;',
    '  float ca = 0.34, sa = 0.34;',
    '  vec2 q = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);',
    '  q.y *= 0.86;',
    '  float t = uTime * 0.018 + uSeed;',
    // 大尺度 warp：两次低频 fbm 作为位移场
    '  vec3 c1 = vec3(q * 1.35, t * 0.70);',
    '  float wa = fbm(c1, 4, 2.03, 0.55);',
    '  float wb = fbm(c1 + vec3(13.7, 5.3, 2.1), 4, 2.03, 0.55);',
    '  vec2 q2 = q * 2.35 + vec2(wa, wb) * 0.95;',
    // 骨架：ridged 湍流 → 细丝（1-|b| 在 b≈0 处出现亮脊）
    '  float b = fbm(vec3(q2, t * 1.20), 5, 2.05, 0.52);',
    '  float fil = 1.0 - abs(b);',
    '  float g = fbm(vec3(q2 * 3.4 + 7.1, t * 2.10), 3, 2.20, 0.50);',
    '  float filD = pow(clamp(fil, 0.0, 1.0), 2.60);',
    // 大尺度云团本体：这是「星云有体积」的关键，细丝只是上面的纹理
    '  float nlow = fbm(vec3(q * 1.05 + 3.3, t * 0.40), 4, 2.02, 0.55);',
    '  float mass = smoothstep(0.00, 0.80, nlow * 0.5 + 0.5);',
    '  float dens = mass * 0.95 + filD * 1.05 * (0.30 + 0.90 * mass);',
    // 中心聚焦（范围更大，让云团占据右半屏而不是一个小点）
    '  float r = length((q + vec2(wa, wb) * 0.30) * vec2(0.95, 1.00));',
    '  float core = exp(-pow(r * 0.80, 2.35));',
    '  dens *= core;',
    // 暗尘沟：用 fbm 做软边乘法，没有硬色块
    '  float lane = smoothstep(0.38, 0.66, fbm(vec3(q * 1.60 + 21.3, t * 0.80), 3, 2.10, 0.50));',
    '  dens *= mix(0.08, 1.0, lane);',
    '  dens = pow(clamp(dens, 0.0, 2.2), 1.18) * 1.28;',
    // 颜色：Hα 粉 / OIII 青 / 紫，最亮的丝偏青白与暖白
    '  vec3 cH = vec3(0.800, 0.080, 0.215);',
    '  vec3 cO = vec3(0.050, 0.320, 0.430);',
    '  vec3 cV = vec3(0.240, 0.100, 0.520);',
    '  vec3 col = mix(cH, cO, smoothstep(-0.35, 0.55, b * 1.2 + g * 0.45 + mass * 0.20) * 0.55);',
    '  col = mix(col, cV, smoothstep(0.60, 1.15, r) * 0.55);',
    '  col += vec3(0.26, 0.54, 0.70) * smoothstep(0.58, 0.96, fil) * (1.0 - lane) * 0.80;',
    '  col += vec3(0.90, 0.76, 0.66) * smoothstep(1.20, 3.20, dens) * 0.42;',
    // 左侧 45% 留黑给文字，右侧留安全边距
    '  float leftFade = smoothstep(0.33, 0.57, vUv.x);',
    '  float rightFade = 1.0 - smoothstep(0.87, 1.03, vUv.x);',
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
   * stage
   * ============================================================ */
  function nebulaStage(ctx) {
    const isLow = ctx.quality === 'low';
    const aspect0 = ctx.aspect || REF_ASPECT;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, aspect0, 1, 8000);
    camera.position.set(0, 0, 0);

    const disposables = [];
    function keep(o) { disposables.push(o); return o; }

    /* -------- 纹理 -------- */
    const texCloud = keep(softCloudTexture(isLow ? 512 : 1024, isLow ? 110 : 170, 0.62, 0));
    const texFil = keep(filamentTexture(isLow ? 512 : 768));
    const texGlow = COSMOS.tex.glowTexture(256);   // 共享工具里已经是干净的高斯光晕

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

    /* -------- 分组：星云主体（resize 时整体平移以保持构图） -------- */
    const nebGroup = new THREE.Group();
    scene.add(nebGroup);

    /* -------- 1a. 星云本体：两层 fbm 体积平面（连续丝云，p 推进时被放大） -------- */
    const NEB_LAYERS = [
      { d: 980, seed: 3.7, gain: 1.50, sx: 0.40, sy: 0.35 },
      { d: 1380, seed: 9.1, gain: 0.63, sx: 0.33, sy: 0.28 }
    ];
    const nebPlanes = [];
    for (let i = 0; i < NEB_LAYERS.length; i++) {
      const L = NEB_LAYERS[i];
      const geo = keep(new THREE.PlaneGeometry(1, 1));
      const mat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector2(NEB_SX, NEB_SY) },
          uScale: { value: new THREE.Vector2(L.sx, L.sy) },
          uSeed: { value: L.seed },
          uGain: { value: L.gain * TUNE.gasGain },
          uP: { value: 0 }
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

    /* 两片全屏 fbm 是本章最大开销（每像素约 23 次噪声）。低分辨率离屏渲染 + 隔帧重渲再加法合成，
       片元开销 ÷6 左右；星云本身缓慢漂移，上采样后肉眼无差。 */
    const planeLayer = keep(COSMOS.util.makeLowResLayer({
      planes: nebPlanes.map(function (pl) { return pl.mesh; }),
      scene: scene,
      camera: camera,
      renderer: ctx.renderer,
      scale: isLow ? 0.3 : 0.4,
      every: isLow ? 3 : 2,
      renderOrder: 0
    }));

    // 让平面在 p=0 时正好铺满视锥
    function sizePlanes(aspect) {
      const a = aspect && aspect > 0.1 ? aspect : REF_ASPECT;
      for (let i = 0; i < nebPlanes.length; i++) {
        const pl = nebPlanes[i];
        const hh = 2 * TAN_HALF * pl.d * 1.02;
        pl.mesh.scale.set(hh * a, hh, 1);
      }
    }

    /* -------- 1. 星云骨架：一组在屏幕空间扇开的丝状脊线 -------- */
    // 星云不是一团雾，而是「脊线 + 暗尘沟 + 电离区」的结构。
    // 所有云层与气团都沿这些脊线分布，天然形成丝状纹理。
    const N_SPINE = isLow ? 5 : 8;
    const SPINES = [];
    for (let i = 0; i < N_SPINE; i++) {
      const v = N_SPINE === 1 ? 0.5 : i / (N_SPINE - 1);
      SPINES.push({
        cx: NEB_SX + (U.rand() - 0.5) * 0.17,
        cy: NEB_SY + (U.rand() - 0.5) * 0.20,
        th: -0.92 + 1.84 * v + (U.rand() - 0.5) * 0.34,   // 屏幕角（弧度，sy 向下）
        len: 0.26 + U.rand() * 0.38,                       // 屏幕宽度占比
        cv: (U.rand() - 0.5) * 0.55,                       // 弯曲度
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

    /* -------- 1b. 星云主体：沿脊线的细长柔云（低 opacity 多层叠加） -------- */
    // 三色（线性空间，明度压低、饱和度中等 → 自然的 Hα / OIII / 紫）
    const GAS_COLORS = [
      [0.440, 0.105, 0.175],   // Hα 深品红
      [0.075, 0.265, 0.320],   // OIII 青
      [0.200, 0.085, 0.400]    // 紫
    ];
    const gasSprites = [];
    const gasP = [];
    const gasSeeds = [];
    const N_GAS = isLow ? 6 : 10;

    for (let i = 0; i < N_GAS; i++) {
      const sp = SPINES[i % N_SPINE];
      const u = 0.20 + U.rand() * 0.64;
      const p3 = spineAt(sp, u);
      const px3 = p3.x, py3 = p3.y, pz3 = p3.z, pd = p3.d;
      // 脊线在该深度下的世界长度
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
      // sprite 的 rotation 是「屏幕空间逆时针」，屏幕 y 向下 → 取 -th
      const rot0 = -sp.th + (U.rand() - 0.5) * 0.16;
      sp2.material.rotation = rot0;
      nebGroup.add(sp2);

      const side = (sp.cx < LEFT_EDGE ? TUNE.leftFade : 1.0);
      const baseOpacity = (0.036 + U.rand() * 0.050) * side * TUNE.gasGain;

      gasSprites.push(sp2);
      gasP.push({
        bx: px3, by: py3,
        baseOpacity: baseOpacity,
        phase: U.rand() * Math.PI * 2,
        speed: 0.09 + U.rand() * 0.15,
        drift: 6 + U.rand() * 16,
        driftRate: 0.030 + U.rand() * 0.040,
        rot0: rot0,
        rotAmp: 0.010 + U.rand() * 0.022
      });
      gasSeeds.push({ x: px3, y: py3, z: pz3, w: w, h: h, r: r, g: g, b: b, ci: ci });
    }

    /* -------- 2. 星云体积：气团点精灵沿脊线成丝（避免大块散景圆斑） -------- */
    const N_WISP = isLow ? 13000 : 30000;
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
        // 垂直于脊线的偏移（近似高斯：三次均匀采样求和）
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
        // 径向衰减：离开星云主体的气团迅速变暗，避免在黑底上出现孤立小圆点
        const dx = (p3.sx - NEB_SX) / 0.44;
        const dy = (p3.sy - NEB_SY) / 0.38;
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

      const mat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 0.86 * TUNE.wispGain }
        },
        vertexShader: WISP_VS,
        fragmentShader: WISP_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = 3;
      pts.frustumCulled = false;
      nebGroup.add(pts);
      wispPoints = pts;
    }

    /* -------- 3. 暗尘埃带：7 条丝状遮挡 -------- */
    const dustSprites = [];
    const dustP = [];
    const N_DUST = isLow ? 5 : 8;
    for (let i = 0; i < N_DUST; i++) {
      const u = (i + 0.5) / N_DUST;
      const sx = NEB_SX + (u - 0.5) * 0.42 + (U.rand() - 0.5) * 0.12;
      const sy = NEB_SY + (u - 0.5) * 0.34 + (U.rand() - 0.5) * 0.16;
      const d = 520 + U.rand() * 420;                 // 在星云主体之前
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
        baseOpacity: (0.16 + U.rand() * 0.16) * TUNE.dustGain,
        phase: U.rand() * Math.PI * 2,
        speed: 0.06 + U.rand() * 0.10,
        rot0: sp.material.rotation,
        rotAmp: 0.02 + U.rand() * 0.035,
        bx: sp.position.x, by: sp.position.y,
        drift: 5 + U.rand() * 12
      });
    }

    /* -------- 4. 恒星形成区（4 处） -------- */
    // 屏幕坐标锚定：主体偏右，左侧留给文字
    const REGIONS = [
      { sx: 0.612, sy: 0.600, d: 860, spread: 15, tint: 1 },   // 主星团（青白）
      { sx: 0.756, sy: 0.432, d: 1040, spread: 19, tint: 2 },   // 紫
      { sx: 0.545, sy: 0.392, d: 1160, spread: 13, tint: 0 },   // 品红
      { sx: 0.706, sy: 0.716, d: 760, spread: 21, tint: 1 }     // 近景（青）
    ];
    const regionGlows = [];
    const regionCores = [0, 0, 0, 0];
    const regionPos = [];      // 每个星团的世界坐标（给星点撒点用）
    const REGION_COLORS = [
      [1.30, 0.52, 0.74],   // Hα 粉红
      [0.62, 1.15, 1.34],   // 青白
      [0.86, 0.60, 1.45]    // 紫
    ];

    for (let i = 0; i < REGIONS.length; i++) {
      const rg = REGIONS[i];
      const x = sxToWorldX(rg.sx, rg.d);
      const y = syToWorldY(rg.sy, rg.d);
      const z = -rg.d;
      regionPos.push({ x: x, y: y, z: z, d: rg.d, spread: rg.spread });
      const c = REGION_COLORS[rg.tint];

      // 被照亮的云（星团周围的电离氢区）
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

      // 外晕
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

      // HDR 光核（>1.0，交给后处理泛光晕开）
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

      // 暖色内芯
      const warm = keep(new THREE.SpriteMaterial({
        map: texGlow,
        color: new THREE.Color().setRGB(2.6, 1.75, 1.05),
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
        litBase: 0.155 * TUNE.regionGain,
        haloBase: 0.050 * TUNE.regionGain,
        coreBase: 0.78 * TUNE.regionGain,
        warmBase: 0.70 * TUNE.regionGain,
        phase: U.rand() * Math.PI * 2,
        speed: 0.22 + U.rand() * 0.3
      });
      // 星团亮度随 p 点亮（scroll 进入本章时逐渐点燃）
      regionCores[i] = i * 0.16;
    }

    /* -------- 4b. 新生星点：密集亮点 -------- */
    const N_NEW = isLow ? 1000 : 2200;
    {
      const pos = new Float32Array(N_NEW * 3);
      const col = new Float32Array(N_NEW * 3);
      const siz = new Float32Array(N_NEW);
      const pha = new Float32Array(N_NEW);
      let k = 0;
      for (let i = 0; i < N_NEW; i++) {
        const ri = i % REGIONS.length;
        const rp = regionPos[ri];
        // 高斯团：星团中心更密
        const a = U.rand() * Math.PI * 2;
        const rad = Math.pow(U.rand(), 1.7) * rp.spread * 3.4;
        const jx = Math.cos(a) * rad;
        const jy = Math.sin(a) * rad * 0.92;
        const jz = (U.rand() - 0.5) * rp.spread * 2.4;
        pos[k * 3] = rp.x + jx;
        pos[k * 3 + 1] = rp.y + jy;
        pos[k * 3 + 2] = rp.z + jz;
        const bright = 0.35 + Math.pow(U.rand(), 2.4) * 2.6;
        const warmStar = U.rand() < 0.22;
        col[k * 3] = (warmStar ? 1.35 : 0.85) * bright;
        col[k * 3 + 1] = (warmStar ? 1.12 : 1.05) * bright;
        col[k * 3 + 2] = (warmStar ? 0.82 : 1.55) * bright;
        siz[k] = 1.0 + Math.pow(U.rand(), 2.0) * 3.2;
        pha[k] = U.rand();
        k++;
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -1000), 2200);
      const mat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: TUNE.starGain }
        },
        vertexShader: STAR_VS,
        fragmentShader: STAR_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = 9;
      pts.frustumCulled = false;
      nebGroup.add(pts);
      newStarPoints = pts;
    }

    /* -------- 4c. 十字星芒：每个星团 3 颗最亮成员 -------- */
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
          col[k * 3] = 0.95 * bright;
          col[k * 3 + 1] = 1.05 * bright;
          col[k * 3 + 2] = 1.40 * bright;
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
      const mat = keep(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 0.9 * TUNE.regionGain }
        },
        vertexShader: FLARE_VS,
        fragmentShader: FLARE_FS,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = 12;
      pts.frustumCulled = false;
      nebGroup.add(pts);
      flarePoints = pts;
    }

    /* -------- 5. 前景恒星：2600 颗细小闪烁 -------- */
    const N_FG = isLow ? 1300 : 2600;
    {
      const pos = new Float32Array(N_FG * 3);
      const col = new Float32Array(N_FG * 3);
      const siz = new Float32Array(N_FG);
      const pha = new Float32Array(N_FG);
      for (let i = 0; i < N_FG; i++) {
        // 分布在相机前方一个扁平的盒子里（比星云更近）
        const sx = U.rand();
        const sy = U.rand();
        const d = 160 + U.rand() * 520;
        pos[i * 3] = sxToWorldX(sx, d);
        pos[i * 3 + 1] = syToWorldY(sy, d);
        pos[i * 3 + 2] = -d;
        // 左侧压暗，保证文字可读
        const dim = sx < LEFT_EDGE ? TUNE.leftFade : 1.0;
        const bright = (0.10 + Math.pow(U.rand(), 2.6) * 0.95) * dim * TUNE.fgStarGain;
        const warm = U.rand() < 0.30;
        col[i * 3] = (warm ? 1.20 : 0.86) * bright;
        col[i * 3 + 1] = (warm ? 1.02 : 1.00) * bright;
        col[i * 3 + 2] = (warm ? 0.78 : 1.35) * bright;
        siz[i] = 1.1 + Math.pow(U.rand(), 2.2) * 3.4;
        pha[i] = U.rand();
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -400), 1400);
      const mat = keep(new THREE.ShaderMaterial({
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
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = 14;
      pts.frustumCulled = false;
      scene.add(pts);           // 前景层不随星云分组平移
      fgStarPoints = pts;
    }

    /* -------- 6. 前景尘埃：大而暗的团块，p 推进时掠过镜头 -------- */
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
        alp[i] = (0.05 + U.rand() * 0.13) * TUNE.fgDustGain;
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -300), 1400);
      const mat = keep(new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 1.0 } },
        vertexShader: FDUST_VS,
        fragmentShader: FDUST_FS,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: false
      }));
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = 16;
      pts.frustumCulled = false;
      scene.add(pts);
      fgDustPoints = pts;
    }

    /* -------- 布局：按视口比例平移星云组，保持右侧构图 -------- */
    const baseShiftX = (NEB_SX - 0.5) * 2 * TAN_HALF * REF_ASPECT * D_REF;
    function layout(aspect) {
      if (!(aspect > 0.1)) return;
      const want = (NEB_SX - 0.5) * 2 * TAN_HALF * aspect * D_REF;
      nebGroup.position.x = want - baseShiftX;
    }
    layout(aspect0);

    /* -------- resize / dispose -------- */
    function resize(w, h) {
      const aspect = w / Math.max(h, 1);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      layout(aspect);
      sizePlanes(aspect);
      const pr = Math.min(ctx.pixelRatio || 1, 2);
      wispPoints.material.uniforms.uPixelRatio.value = pr;
      newStarPoints.material.uniforms.uPixelRatio.value = pr;
      flarePoints.material.uniforms.uPixelRatio.value = pr;
      fgStarPoints.material.uniforms.uPixelRatio.value = pr;
      fgDustPoints.material.uniforms.uPixelRatio.value = pr;
    }

    function dispose() {
      for (let i = 0; i < disposables.length; i++) {
        const d = disposables[i];
        if (d && typeof d.dispose === 'function') d.dispose();
      }
      disposables.length = 0;
    }

    /* -------- update -------- */
    const camTarget = new THREE.Vector3(0, 0, -CAM_TRAVEL);
    let first = true;

    function update(t, dt, p) {
      const q = p === undefined ? 0 : U.clamp(p, 0, 1);
      const e = U.ease.inOutCubic(q);

      // 相机：极缓推进 + 横摇 + 轻微滚转（全部用 t 和 p 共同驱动）
      camera.position.z = -CAM_TRAVEL * e;
      camera.position.x = Math.sin(t * 0.037) * 13.0 + Math.sin(t * 0.0141) * 7.0;
      camera.position.y = Math.cos(t * 0.031) * 8.5;
      camera.rotation.z = -0.028 + Math.sin(t * 0.024) * 0.013;
      camera.rotation.y = Math.sin(t * 0.019) * 0.022 + e * 0.02;
      camera.rotation.x = Math.cos(t * 0.017) * 0.010;
      camera.updateMatrixWorld();

      // 星云本体平面：时间演化
      for (let i = 0; i < nebPlanes.length; i++) {
        const pl = nebPlanes[i];
        pl.mat.uniforms.uTime.value = t;
        pl.mat.uniforms.uP.value = q;
      }
      /* uniform 更新完再离屏渲染，避免半分辨率层落后一帧 */
      planeLayer.render();

      // 星云云层：漂移 + 呼吸 + 缓慢自转
      for (let i = 0; i < N_GAS; i++) {
        const a = gasP[i];
        const s = gasSprites[i];
        const ph = a.phase;
        s.position.x = a.bx + Math.sin(t * a.driftRate + ph) * a.drift;
        s.position.y = a.by + Math.cos(t * a.driftRate * 0.83 + ph * 1.7) * a.drift * 0.62;
        s.material.opacity = a.baseOpacity * (0.76 + 0.24 * Math.sin(t * a.speed + ph));
        s.material.rotation = a.rot0 + Math.sin(t * 0.043 + ph) * a.rotAmp;
      }

      // 暗尘埃：只做轻微呼吸与转动
      for (let i = 0; i < N_DUST; i++) {
        const a = dustP[i];
        const s = dustSprites[i];
        s.material.opacity = a.baseOpacity * (0.84 + 0.16 * Math.sin(t * a.speed + a.phase));
        s.material.rotation = a.rot0 + Math.sin(t * 0.031 + a.phase) * a.rotAmp;
        s.position.x = a.bx + Math.sin(t * 0.019 + a.phase) * a.drift;
        s.position.y = a.by + Math.cos(t * 0.015 + a.phase) * a.drift * 0.6;
      }

      // 恒星形成区：呼吸 + 随 p 逐渐点亮
      const ignite = U.smoothstep(0.05, 0.62, q);
      for (let i = 0; i < regionGlows.length; i++) {
        const r = regionGlows[i];
        const ign = U.clamp(ignite * 1.25 - regionCores[i], 0, 1);
        const pulse = 0.90 + 0.10 * Math.sin(t * r.speed + r.phase);
        r.lit.material.opacity = r.litBase * ign * pulse;
        r.halo.material.opacity = r.haloBase * ign * pulse;
        r.core.material.opacity = r.coreBase * ign * (0.94 + 0.06 * Math.sin(t * r.speed * 1.7 + r.phase));
        r.warm.material.opacity = r.warmBase * ign * pulse;
      }

      // shader 时间
      wispPoints.material.uniforms.uTime.value = t;
      newStarPoints.material.uniforms.uTime.value = t;
      flarePoints.material.uniforms.uTime.value = t;
      fgStarPoints.material.uniforms.uTime.value = t;

      // 前景尘埃：越往后越少（掠过镜头后淡出），避免末段糊屏
      fgDustPoints.material.uniforms.uOpacity.value = 1.0 - 0.78 * e;

      if (first) {
        first = false;
        // 首帧就把 opacity 设到位，避免进入本章时闪一下
        for (let i = 0; i < N_GAS; i++) gasSprites[i].material.opacity = gasP[i].baseOpacity;
        for (let i = 0; i < N_DUST; i++) dustSprites[i].material.opacity = dustP[i].baseOpacity;
      }
    }

    return {
      scene: scene,
      camera: camera,
      update: update,
      resize: resize,
      dispose: dispose,
      bloom: TUNE.bloom
    };
  }

  COSMOS.registerStage('deepfield', nebulaStage);
  COSMOS.registerStage('nebula', nebulaStage);

  /* 上面 registerStage 内部引用的可变引用（提升到闭包作用域，避免每帧属性查找链过长） */
  var wispPoints = null;
  var newStarPoints = null;
  var flarePoints = null;
  var fgStarPoints = null;
  var fgDustPoints = null;
})(window.COSMOS = window.COSMOS || {});
