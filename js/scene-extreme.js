/* ============================================================
 * COSMOS ATLAS v2 · 08 极端宇宙（EXTREME UNIVERSE）
 * ------------------------------------------------------------
 * 三种"看不见的宇宙"：
 *   gravity     引力波  —— 双黑洞绕转 + 时空网格四极涟漪 + 应变滑杆
 *   darkmatter  暗物质  —— 螺旋星系（核球/臂/星族/电离氢区）
 *                          + NFW 暗物质晕与子晕 + 引力透镜弧
 *                          + 等密度参考环；M200 质量滑杆联动晕尺度与转速
 *   darkenergy  暗能量  —— 宇宙网（节点–丝–场星系）
 *                          + 固定参考环 + 尺度因子膨胀 + 红移着色
 *
 * 状态：COSMOS.state.extreme = {
 *   mode: 'gravity' | 'darkmatter' | 'darkenergy',
 *   strain: 1e-22 – 1e-18,   // 引力波应变
 *   scaleFactor: 1 – 3,      // 宇宙尺度因子 a（1 = 今天，> 1 表示再膨胀）
 *   dmHalo: true|false,      // 暗物质晕 / 透镜弧可见
 *   dmMass: 0.6 – 3.0        // 暗物质晕质量 M200，单位 10^12 太阳质量
 * }
 * widget 写，场景读；场景检测到外部变化后同步并广播。
 *
 * 切换：三组场景预建，切换只改透明度；相机距离三模式统一（13.0），
 * 交叉淡化互补（op 之和恒为 1），没有推镜与总亮度跳变。
 * 性能：粒子约 8 万（high），draw call 约 16。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var THREE = window.THREE;
  if (!COSMOS || !THREE) return;

  var U = COSMOS.util;
  var TAU = Math.PI * 2;

  /* ---------------- 全局状态 ---------------- */
  COSMOS.state = COSMOS.state || {};
  var EX = COSMOS.state.extreme = COSMOS.state.extreme || {};
  if (EX.mode !== 'darkmatter' && EX.mode !== 'darkenergy') EX.mode = 'gravity';
  if (!isFinite(EX.strain)) EX.strain = 1e-21;
  if (!isFinite(EX.scaleFactor)) EX.scaleFactor = 1;
  if (EX.dmHalo === undefined) EX.dmHalo = true;
  if (EX.dmLens === undefined) EX.dmLens = true;
  if (!isFinite(EX.dmMass)) EX.dmMass = 2.0;

  /* ---------------- 参数 ---------------- */
  var CFG = {
    fov: 42,
    near: 0.1,
    far: 3400,

    yaw0: 0.42,
    pitch0: 0.50,
    pitchMax: 1.20,

    // 三模式共用同一相机距离：切换时不再推镜
    dist: 13.0,
    zoomMin: 7.0,
    zoomMax: 26.0,
    zoomDefault: 1,

    autoSpin: 0.022,
    dragYaw: 0.0036,
    dragPitch: 0.0030,
    inertiaTau: 0.085,

    // 视点左移 → 主体落在画面右中部，避开左侧文案栏
    lookX: -1.10,
    lookY: 0.02,

    fade: 5.0,           // 模式交叉淡化速率（约 0.45s 收尾）
    haloFade: 4.0,       // 暗物质晕显示/隐藏稍慢
    starCount: 4200,

    dm: { diskR: 2.35, haloR: 4.60 },
    de: { webR: 3.35 }
  };

  var QSCALE = { high: 1, medium: 0.72, low: 0.48 };

  /* ---------------- 点精灵 shader ---------------- */
  // 一套 shader 覆盖全部粒子：膨胀（暗能量）、晕缩放（暗物质）、红移着色。
  // 各材质用 uniform 关闭自己不用的效果（uExpansion=1 / uHaloScale=1 / uRedshift=0）。
  var POINT_VERT = [
    'uniform float uTime;',
    'uniform float uPixelRatio;',
    'uniform float uSize;',
    'uniform float uExpansion;',
    'uniform float uHaloScale;',
    'uniform float uRedshift;',
    'attribute vec3 aColor;',
    'attribute float aSize;',
    'attribute float aPhase;',
    'attribute float aAlpha;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vec3 p = position;',
    '  p *= uExpansion;',
    '  p.xz *= uHaloScale;',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float tw = 0.88 + 0.12 * sin(uTime * 0.8 + aPhase * 53.0);',
    '  float d = max(-mv.z, 0.9);',
    '  float ps = aSize * uSize * uPixelRatio * 34.0 / d * (0.92 + 0.16 * tw);',
    '  gl_PointSize = min(ps, 240.0);',
    '  float rr = length(p.xz) * 0.88 + abs(p.y) * 0.62;',
    '  float red = smoothstep(1.6, 7.2, rr) * uRedshift;',
    '  vec3 hot = vec3(1.00, 0.50, 0.30) * (0.55 + 0.45 * aColor.r);',
    '  vColor = mix(aColor, hot, red * 0.85);',
    '  vAlpha = aAlpha;',
    '}'
  ].join('\n');

  var POINT_FRAG = [
    'uniform float uOpacity;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'void main() {',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float d = length(c) * 2.0;',
    '  float a = 1.0 - smoothstep(0.12, 1.0, d);',
    '  a *= a;',
    '  float al = a * vAlpha * uOpacity;',
    '  if (al < 0.004) discard;',
    '  gl_FragColor = vec4(vColor, al);',
    '}'
  ].join('\n');

  /* ---------------- 工具 ---------------- */
  var _g1 = 0;
  function gauss() {
    if (_g1 !== 0) { var v = _g1; _g1 = 0; return v; }
    var u = 0, w = 0;
    while (u === 0) u = U.rand();
    while (w === 0) w = U.rand();
    var r = Math.sqrt(-2 * Math.log(u));
    _g1 = r * Math.sin(TAU * w);
    return r * Math.cos(TAU * w);
  }

  function randDir() {
    var z = U.rand() * 2 - 1;
    var ph = U.rand() * TAU;
    var s = Math.sqrt(Math.max(0, 1 - z * z));
    return { x: Math.cos(ph) * s, y: z, z: Math.sin(ph) * s };
  }

  function makeBuffers(n) {
    return {
      n: n,
      pos: new Float32Array(n * 3),
      col: new Float32Array(n * 3),
      size: new Float32Array(n),
      phase: new Float32Array(n),
      alpha: new Float32Array(n)
    };
  }

  function toGeometry(b) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(b.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(b.size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(b.phase, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(b.alpha, 1));
    return g;
  }

  function put(b, i, x, y, z, r, g, bl, sz, ph, al) {
    b.pos[i * 3] = x; b.pos[i * 3 + 1] = y; b.pos[i * 3 + 2] = z;
    b.col[i * 3] = r; b.col[i * 3 + 1] = g; b.col[i * 3 + 2] = bl;
    b.size[i] = sz; b.phase[i] = ph; b.alpha[i] = al;
  }

  function makePointMaterial(opt) {
    opt = opt || {};
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 0 },
        uSize: { value: opt.size || 1 },
        uExpansion: { value: 1 },
        uHaloScale: { value: 1 },
        uRedshift: { value: 0 }
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });
  }

  function setMatOpacity(mat, o) {
    if (mat.uniforms && mat.uniforms.uOpacity) mat.uniforms.uOpacity.value = o;
    else mat.opacity = o;
  }

  function makeGlowSprite(color, scale, opacity) {
    var tex = COSMOS.tex.glowTexture(128, '#ffffff', 'rgba(255,255,255,0)');
    var mat = new THREE.SpriteMaterial({
      map: tex,
      color: color,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      opacity: opacity || 0
    });
    var sp = new THREE.Sprite(mat);
    sp.scale.set(scale, scale, 1);
    return sp;
  }

  // 圆环合并成一组线段（3 个环 = 1 个 draw call）
  function ringSegments(radii, n, plane) {
    var segs = radii.length * n;
    var arr = new Float32Array(segs * 6);
    var k = 0;
    for (var r = 0; r < radii.length; r++) {
      var rad = radii[r];
      for (var i = 0; i < n; i++) {
        var a0 = (i / n) * TAU;
        var a1 = ((i + 1) / n) * TAU;
        var x0, y0, z0, x1, y1, z1;
        if (plane === 'xy') {
          x0 = Math.cos(a0) * rad; y0 = Math.sin(a0) * rad; z0 = 0;
          x1 = Math.cos(a1) * rad; y1 = Math.sin(a1) * rad; z1 = 0;
        } else {
          x0 = Math.cos(a0) * rad; y0 = 0; z0 = Math.sin(a0) * rad;
          x1 = Math.cos(a1) * rad; y1 = 0; z1 = Math.sin(a1) * rad;
        }
        arr[k++] = x0; arr[k++] = y0; arr[k++] = z0;
        arr[k++] = x1; arr[k++] = y1; arr[k++] = z1;
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  // NFW 半径采样：M(<r) ∝ ln(1+x) − x/(1+x)，二分反解
  function nfwRadius(u, rs, rMax) {
    var xMax = rMax / rs;
    var mMax = Math.log(1 + xMax) - xMax / (1 + xMax);
    var target = U.clamp(u, 1e-5, 0.99999) * mMax;
    var lo = 1e-4, hi = rMax, mid = 0, mm = 0;
    for (var k = 0; k < 26; k++) {
      mid = (lo + hi) * 0.5;
      var x = mid / rs;
      mm = Math.log(1 + x) - x / (1 + x);
      if (mm < target) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /* ============================================================
   * 引力波：时空网格 + 双黑洞（保持 v2 既有表现，仅适配统一机位）
   * ============================================================ */
  function buildGravityGrid() {
    var xMin = -7.9, xMax = 7.9, zMin = -6.2, zMax = 6.2, step = 0.40;
    var nx = Math.round((xMax - xMin) / step);
    var nz = Math.round((zMax - zMin) / step);
    var vals = [];
    var ix, iz, x, z;
    for (iz = 0; iz <= nz; iz++) {
      z = zMin + iz * step;
      for (ix = 0; ix < nx; ix++) {
        x = xMin + ix * step;
        vals.push(x, 0, z, x + step, 0, z);
      }
    }
    for (ix = 0; ix <= nx; ix++) {
      x = xMin + ix * step;
      for (iz = 0; iz < nz; iz++) {
        z = zMin + iz * step;
        vals.push(x, 0, z, x, 0, z + step);
      }
    }
    var arr = new Float32Array(vals.length);
    arr.set(vals);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  var GRID_VERT = [
    'uniform float uTime;',
    'uniform float uPhase;',
    'uniform float uAmp;',
    'uniform float uWell;',
    'uniform vec2 uBH1;',
    'uniform vec2 uBH2;',
    'varying float vH;',
    'varying float vR;',
    'void main() {',
    '  vec3 p = position;',
    '  float r = length(p.xz);',
    '  float phi = atan(p.z, p.x);',
    '  float h = uAmp * exp(-r * 0.20);',
    '  p.y = h * cos(2.0 * (phi - uPhase));',
    '  float d1 = length(p.xz - uBH1);',
    '  float d2 = length(p.xz - uBH2);',
    '  p.y -= uWell * (1.0 / (1.0 + d1 * d1 * 6.0) + 1.0 / (1.0 + d2 * d2 * 6.0));',
    '  p.y -= 0.30 / (1.0 + r * r * 0.10);',
    '  vH = p.y;',
    '  vR = r;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var GRID_FRAG = [
    'uniform float uOpacity;',
    'varying float vH;',
    'varying float vR;',
    'void main() {',
    '  float fade = 1.0 - smoothstep(5.4, 9.4, vR);',
    '  float crest = 0.55 + 0.85 * clamp(vH * 1.5 + 0.5, 0.0, 1.0);',
    '  vec3 col = vec3(0.40, 0.68, 1.12) * crest;',
    '  gl_FragColor = vec4(col, uOpacity * fade * 0.40);',
    '}'
  ].join('\n');

  /* ============================================================
   * 暗物质：螺旋星系盘
   *  - 对数螺旋双臂（密度波近似），臂内为年轻蓝白星族与电离氢区
   *  - 臂间为较暗的老年暖黄星族；内侧因尘埃消光偏红
   *  - 薄盘 + 少量厚盘；星团聚集造成的颗粒感
   * ============================================================ */
  function buildDmDisk(scale) {
    var n = Math.max(1400, Math.round(26000 * scale));
    var b = makeBuffers(n);
    var R0 = 0.26, RMAX = CFG.dm.diskR, Rd = 0.60, ARMS = 2, K = 2.05;

    for (var i = 0; i < n; i++) {
      var r = 0, guard = 0;
      do {
        r = R0 - Rd * Math.log(1 - U.rand() * 0.975);
        guard++;
      } while (r > RMAX && guard < 40);
      if (r > RMAX) r = R0 + U.rand() * (RMAX - R0) * 0.5;

      var t = (r - R0) / (RMAX - R0);
      var arm = i % ARMS;
      var armTheta = arm * Math.PI + K * Math.log(Math.max(r, R0) / R0) + 0.25;
      var inArm = U.rand() < 0.68;
      var spread = 0.075 + 0.125 * t;
      var th;
      if (inArm) {
        // 25% 的臂内粒子收紧到臂心，形成星团状的颗粒感
        th = armTheta + gauss() * (U.rand() < 0.25 ? spread * 0.35 : spread);
      } else {
        th = U.rand() * TAU;
      }

      var x = Math.cos(th) * r + gauss() * 0.018;
      var z = Math.sin(th) * r + gauss() * 0.018;
      var hz = 0.020 + 0.014 * (1 - t);
      var y = gauss() * hz;
      if (U.rand() < 0.07) y = gauss() * 0.085;

      var cr, cg, cb, sz, al;
      if (inArm && U.rand() < 0.055) {
        // HII 电离氢区：Hα 656nm，红粉色，成团
        var hl = 0.78 + 0.30 * U.rand();
        cr = 1.00 * hl; cg = 0.42 * hl; cb = 0.52 * hl;
        sz = 2.0 + 2.0 * U.rand();
        al = 0.70 + 0.20 * U.rand();
      } else if (inArm) {
        // 年轻蓝白星族
        var bl = 0.55 + 0.45 * U.rand();
        cr = 0.60 * bl; cg = 0.76 * bl; cb = 1.00 * bl;
        sz = 0.90 + 1.30 * U.rand();
        al = 0.46 + 0.28 * U.rand();
      } else {
        // 臂间老年暖黄星族，亮度低，形成臂间暗区
        var ol = 0.26 + 0.22 * U.rand();
        cr = 1.00 * ol; cg = 0.82 * ol; cb = 0.56 * ol;
        sz = 0.50 + 0.70 * U.rand();
        al = 0.12 + 0.14 * U.rand();
      }

      // 尘埃消光红化：越靠内越偏暖
      if (r < 1.35) {
        var redden = 1 - 0.30 * (1 - r / 1.35);
        cg *= redden;
        cb *= redden * 0.94;
      }
      // 少量明亮星团
      if (U.rand() < 0.03) sz *= 1.9;
      // 内区臂间的尘埃带：压暗，让螺旋臂有"沟"
      if (!inArm && r < 1.15) al *= 0.42 + 0.58 * (r / 1.15);

      put(b, i, x, y, z, cr, cg, cb, sz, U.rand(), al);
    }
    return toGeometry(b);
  }

  /* ---------------- 暗物质：核球（Sérsic 近似，n≈3.2） ---------------- */
  function buildDmBulge(scale) {
    var n = Math.max(900, Math.round(5200 * scale));
    var b = makeBuffers(n);
    var Re = 0.26, nn = 3.2;

    for (var i = 0; i < n; i++) {
      var rr = 0, tries = 0;
      do {
        rr = U.rand() * 1.30;
        tries++;
      } while (U.rand() > Math.exp(-3.1 * Math.pow(rr / Re, 1 / nn)) && tries < 40);

      var d = randDir();
      var yy = d.y * 0.60;
      var k = U.clamp(rr / 1.05, 0, 1);
      var lum = 0.72 + 0.28 * U.rand();
      put(b, i,
        d.x * rr, yy * rr, d.z * rr,
        1.00 * lum, (0.82 - 0.16 * k) * lum, (0.56 - 0.20 * k) * lum,
        0.65 + 1.10 * U.rand(), U.rand(), 0.22 + 0.16 * U.rand());
    }
    // 核心亮核：少量大而亮的点
    for (var j = 0; j < 6; j++) {
      var idx = (n - 1) - j;
      if (idx < 0) break;
      var dd = randDir();
      var kr = Math.pow(U.rand(), 1.6) * 0.10;
      put(b, idx, dd.x * kr, dd.y * kr * 0.7, dd.z * kr,
        1.00, 0.90, 0.70, 2.2 + U.rand() * 2.6, U.rand(), 0.42);
    }
    return toGeometry(b);
  }

  /* ---------------- 暗物质：NFW 晕（弥散蓝雾 + 子晕团块） ---------------- */
  function buildDmHalo(scale) {
    var n = Math.max(1000, Math.round(17000 * scale));
    var b = makeBuffers(n);
    var rMax = CFG.dm.haloR, rs = 1.15;

    for (var i = 0; i < n; i++) {
      var r = nfwRadius(U.rand(), rs, rMax);
      var d = randDir();
      var k = Math.pow(1 - r / rMax, 1.15);
      var lum = 0.12 + 0.40 * k;
      put(b, i,
        d.x * r, d.y * r, d.z * r,
        0.30 * lum, 0.42 * lum, 0.90 * lum,
        2.4 + 3.2 * U.rand(), U.rand(),
        0.016 + 0.036 * k + 0.010 * U.rand());
    }
    return toGeometry(b);
  }

  function buildDmSubhalos(scale) {
    var per = Math.max(120, Math.round(360 * scale));
    var centers = 9;
    var b = makeBuffers(per * centers);
    var idx = 0;
    for (var c = 0; c < centers; c++) {
      var dir = randDir();
      var R = 1.25 + U.rand() * 2.15;
      var cx = dir.x * R, cy = dir.y * R * 0.75, cz = dir.z * R;
      var sig = 0.055 + U.rand() * 0.10;
      for (var j = 0; j < per; j++) {
        var rr = nfwRadius(U.rand(), sig * 0.55, sig * 4.2);
        var dd = randDir();
        var lum = 0.45 + 0.55 * U.rand();
        put(b, idx++,
          cx + dd.x * rr, cy + dd.y * rr, cz + dd.z * rr,
          0.45 * lum, 0.62 * lum, 1.00 * lum,
          1.8 + 2.4 * U.rand(), U.rand(), 0.06 + 0.13 * U.rand());
      }
    }
    return toGeometry(b);
  }

  /* ---------------- 暗物质：引力透镜弧（背景星系被拉长） ---------------- */
  function buildDmLensArcs(scale) {
    var arcs = 16;
    var per = Math.max(20, Math.round(72 * scale));
    var b = makeBuffers(arcs * per);
    var idx = 0;
    for (var a = 0; a < arcs; a++) {
      var th0 = U.rand() * TAU;
      var R = 2.7 + U.rand() * 1.0;
      var span = 0.26 + U.rand() * 0.36;
      for (var j = 0; j < per; j++) {
        var t = per > 1 ? j / (per - 1) : 0.5;
        var th = th0 - span * 0.5 + span * t;
        var rr = R + gauss() * 0.025;
        var lum = 0.60 + 0.40 * Math.sin(Math.PI * t);
        put(b, idx++,
          Math.cos(th) * rr, gauss() * 0.16, Math.sin(th) * rr,
          0.55 * lum, 0.72 * lum, 1.00 * lum,
          1.2 + 1.4 * U.rand(), U.rand(),
          0.16 + 0.22 * Math.sin(Math.PI * t));
      }
    }
    return toGeometry(b);
  }

  /* ============================================================
   * 暗能量：宇宙网（节点–丝–场星系）
   *  - 节点：泊松盘采样，团簇状分布（亮黄白，老年星系群）
   *  - 丝：近邻节点连线，沿线撒点（蓝白，密度回升）
   *  - 场：稀疏背景星系（暗蓝）
   * ============================================================ */
  function buildDeWeb(scale) {
    var i, j, k;
    var R = CFG.de.webR;

    // —— 节点：泊松盘近似（拒绝采样保证间距）
    var mains = [];
    var subs = [];
    function farFrom(p, arr, minD) {
      for (var m = 0; m < arr.length; m++) {
        var q = arr[m];
        var dxx = p.x - q.x, dyy = p.y - q.y, dzz = p.z - q.z;
        if (dxx * dxx + dyy * dyy + dzz * dzz < minD * minD) return false;
      }
      return true;
    }
    var guard;
    for (i = 0; i < 26; i++) {
      guard = 0;
      while (guard++ < 160) {
        var dm = randDir();
        var rm = 0.55 + Math.pow(U.rand(), 0.62) * (R - 0.7);
        var pm = { x: dm.x * rm, y: dm.y * rm * 0.86, z: dm.z * rm };
        if (farFrom(pm, mains, 0.64) && farFrom(pm, subs, 0.42)) { mains.push(pm); break; }
      }
    }
    for (i = 0; i < 40; i++) {
      guard = 0;
      while (guard++ < 160) {
        var ds = randDir();
        var rs2 = 0.45 + Math.pow(U.rand(), 0.55) * (R - 0.55);
        var ps = { x: ds.x * rs2, y: ds.y * rs2 * 0.86, z: ds.z * rs2 };
        if (farFrom(ps, mains, 0.36) && farFrom(ps, subs, 0.34)) { subs.push(ps); break; }
      }
    }

    // —— 丝：每个主节点连最近 2 个，去重
    var edges = [];
    var seen = {};
    for (i = 0; i < mains.length; i++) {
      var cand = [];
      for (j = 0; j < mains.length; j++) {
        if (i === j) continue;
        var a1 = mains[i], b1 = mains[j];
        var dx1 = a1.x - b1.x, dy1 = a1.y - b1.y, dz1 = a1.z - b1.z;
        cand.push({ j: j, d: Math.sqrt(dx1 * dx1 + dy1 * dy1 + dz1 * dz1) });
      }
      cand.sort(function (p, q) { return p.d - q.d; });
      for (k = 0; k < Math.min(2, cand.length); k++) {
        if (cand[k].d > 2.15) continue;
        var lo = Math.min(i, cand[k].j), hi = Math.max(i, cand[k].j);
        var key = lo + '_' + hi;
        if (seen[key]) continue;
        seen[key] = 1;
        edges.push([lo, hi]);
      }
    }

    // —— 统计总量后一次性分配
    var nMain = Math.max(60, Math.round(240 * scale));
    var nSub = Math.max(30, Math.round(110 * scale));
    var nFil = Math.max(40, Math.round(180 * scale));
    var nField = Math.max(1200, Math.round(8000 * scale));
    var total = mains.length * (nMain + 2) + subs.length * nSub + edges.length * nFil + nField;
    var b = makeBuffers(total);
    var idx = 0;

    // 主节点团簇
    for (i = 0; i < mains.length; i++) {
      var c0 = mains[i];
      var sigM = 0.085 + U.rand() * 0.055;
      for (j = 0; j < nMain; j++) {
        var rr = Math.abs(gauss()) * sigM;
        var dd = randDir();
        var kk = U.clamp(rr / (sigM * 2.6), 0, 1);
        var lum = 0.55 + 0.45 * (1 - kk);
        put(b, idx++,
          c0.x + dd.x * rr, c0.y + dd.y * rr, c0.z + dd.z * rr,
          1.00 * lum, (0.88 - 0.16 * kk) * lum, (0.68 - 0.18 * kk) * lum,
          0.85 + 1.15 * U.rand(), U.rand(), 0.17 + 0.23 * U.rand());
      }
      // 团簇亮核
      for (j = 0; j < 1; j++) {
        var dr = randDir();
        var kr = sigM * 0.28;
        put(b, idx++,
          c0.x + dr.x * kr, c0.y + dr.y * kr, c0.z + dr.z * kr,
          1.00, 0.92, 0.74, 5.0 + U.rand() * 3.0, U.rand(), 0.58);
      }
    }
    // 次节点
    for (i = 0; i < subs.length; i++) {
      var c1 = subs[i];
      var sigS = 0.065 + U.rand() * 0.05;
      for (j = 0; j < nSub; j++) {
        var rr2 = Math.abs(gauss()) * sigS;
        var dd2 = randDir();
        var l2 = 0.45 + 0.45 * (1 - U.clamp(rr2 / (sigS * 2.6), 0, 1));
        put(b, idx++,
          c1.x + dd2.x * rr2, c1.y + dd2.y * rr2, c1.z + dd2.z * rr2,
          0.98 * l2, 0.80 * l2, 0.58 * l2,
          0.75 + 0.95 * U.rand(), U.rand(), 0.15 + 0.22 * U.rand());
      }
    }
    // 丝
    for (i = 0; i < edges.length; i++) {
      var pA = mains[edges[i][0]], pB = mains[edges[i][1]];
      var vx = pB.x - pA.x, vy = pB.y - pA.y, vz = pB.z - pA.z;
      var vlen = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      // 随机单位向量去掉平行分量 → 垂直抖动方向
      var ux = U.rand() * 2 - 1, uy = U.rand() * 2 - 1, uz = U.rand() * 2 - 1;
      var dot = (ux * vx + uy * vy + uz * vz) / (vlen * vlen);
      ux -= vx * dot; uy -= vy * dot; uz -= vz * dot;
      var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      var sigF = 0.05 + U.rand() * 0.05;
      for (j = 0; j < nFil; j++) {
        var tt = (j + U.rand()) / nFil;
        var wob = gauss() * sigF * Math.sin(Math.PI * tt);
        var bx = pA.x + vx * tt + ux * wob;
        var by = pA.y + vy * tt + uy * wob;
        var bz = pA.z + vz * tt + uz * wob;
        var lf = 0.44 + 0.46 * U.rand();
        put(b, idx++, bx, by, bz,
          0.58 * lf, 0.74 * lf, 1.00 * lf,
          0.85 + 0.85 * U.rand(), U.rand(), 0.38 + 0.40 * U.rand());
      }
    }
    // 场星系
    for (i = 0; i < nField; i++) {
      var rr3 = Math.cbrt(U.rand()) * R;
      var dd3 = randDir();
      var l3 = 0.30 + 0.34 * U.rand();
      put(b, idx++,
        dd3.x * rr3, dd3.y * rr3 * 0.9, dd3.z * rr3,
        0.40 * l3, 0.52 * l3, 0.82 * l3,
        0.65 + 0.65 * U.rand(), U.rand(), 0.13 + 0.22 * U.rand());
    }
    return toGeometry(b);
  }

  /* ============================================================
   * 舞台
   * ============================================================ */
  COSMOS.registerStage('extreme', function (ctx) {
    if (!ctx) return null;

    var q = ctx.quality || COSMOS.QUALITY || 'high';
    var scale = QSCALE[q] || 1;
    var input = ctx.input || {};
    var mqReduce = (window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);

    var scene = new THREE.Scene();
    var camera = U.makeCamera(CFG.fov, ctx.aspect || 1);
    camera.near = CFG.near;
    camera.far = CFG.far;
    camera.updateProjectionMatrix();

    var disposables = [];

    // ---------- 组容器 ----------
    var G = {
      gravity: { group: new THREE.Group(), mats: [], op: 0 },
      darkmatter: { group: new THREE.Group(), mats: [], op: 0 },
      darkenergy: { group: new THREE.Group(), mats: [], op: 0 }
    };
    scene.add(G.gravity.group);
    scene.add(G.darkmatter.group);
    scene.add(G.darkenergy.group);

    /* ============ 1) 引力波 ============ */
    var gridGeo = buildGravityGrid();
    var gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: 0 },
        uAmp: { value: 0.5 },
        uWell: { value: 0.55 },
        uBH1: { value: new THREE.Vector2(1.4, 0) },
        uBH2: { value: new THREE.Vector2(-1.4, 0) },
        uOpacity: { value: 0 }
      },
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });
    var grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.frustumCulled = false;
    grid.position.y = -1.05;
    G.gravity.group.add(grid);
    G.gravity.mats.push(gridMat);
    disposables.push(gridGeo, gridMat);

    var bhA = new THREE.Group();
    var bhB = new THREE.Group();
    var glowA = makeGlowSprite(0xfff0d8, 1.05);
    var glowB = makeGlowSprite(0xffe8c8, 1.05);
    bhA.add(glowA);
    bhB.add(glowB);

    function makePhotonRing() {
      var n = 64;
      var arr = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU;
        arr[i * 3] = Math.cos(a) * 0.24;
        arr[i * 3 + 1] = Math.sin(a) * 0.24;
        arr[i * 3 + 2] = 0;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      var m = new THREE.LineBasicMaterial({
        color: 0xffe9c8, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      var l = new THREE.LineLoop(g, m);
      l.frustumCulled = false;
      return { line: l, mat: m, geo: g };
    }
    var ringA = makePhotonRing();
    var ringB = makePhotonRing();
    bhA.add(ringA.line);
    bhB.add(ringB.line);
    G.gravity.group.add(bhA);
    G.gravity.group.add(bhB);
    G.gravity.mats.push(ringA.mat, ringB.mat, glowA.material, glowB.material);
    disposables.push(ringA.geo, ringA.mat, ringB.geo, ringB.mat);

    /* ============ 2) 暗物质 ============ */
    var dmDiskGrp = new THREE.Group();   // 盘 + 核球（同向旋转）
    var dmHaloGrp = new THREE.Group();   // 晕 + 子晕（反向慢转）
    var dmArcGrp = new THREE.Group();    // 透镜弧（背景，固定）
    G.darkmatter.group.add(dmDiskGrp);
    G.darkmatter.group.add(dmHaloGrp);
    G.darkmatter.group.add(dmArcGrp);

    var dmDiskGeo = buildDmDisk(scale);
    var dmDiskMat = makePointMaterial({ size: 1.0 });
    var dmDisk = new THREE.Points(dmDiskGeo, dmDiskMat);
    dmDisk.frustumCulled = false;
    dmDiskGrp.add(dmDisk);
    G.darkmatter.mats.push(dmDiskMat);
    disposables.push(dmDiskGeo, dmDiskMat);

    var dmBulgeGeo = buildDmBulge(scale);
    var dmBulgeMat = makePointMaterial({ size: 1.0 });
    var dmBulge = new THREE.Points(dmBulgeGeo, dmBulgeMat);
    dmBulge.frustumCulled = false;
    dmDiskGrp.add(dmBulge);
    G.darkmatter.mats.push(dmBulgeMat);
    disposables.push(dmBulgeGeo, dmBulgeMat);

    var dmHaloGeo = buildDmHalo(scale);
    var dmHaloMat = makePointMaterial({ size: 1.1 });
    var dmHalo = new THREE.Points(dmHaloGeo, dmHaloMat);
    dmHalo.frustumCulled = false;
    dmHaloGrp.add(dmHalo);
    G.darkmatter.mats.push(dmHaloMat);
    disposables.push(dmHaloGeo, dmHaloMat);

    // 弥散晕雾：三层大光斑叠成"看不见的云"（比大点云省填充率）
    var dmGlow = [];
    var dmGlowDef = [[0x5b78d8, 1.55, 0.072], [0x4c66c8, 2.60, 0.046], [0x3f56b4, 3.95, 0.030]];
    for (var gd = 0; gd < dmGlowDef.length; gd++) {
      var sp = makeGlowSprite(dmGlowDef[gd][0], dmGlowDef[gd][1]);
      sp.userData.baseOpacity = dmGlowDef[gd][2];
      dmHaloGrp.add(sp);
      dmGlow.push(sp);
    }

    var dmSubGeo = buildDmSubhalos(scale);
    var dmSubMat = makePointMaterial({ size: 1.0 });
    var dmSub = new THREE.Points(dmSubGeo, dmSubMat);
    dmSub.frustumCulled = false;
    dmHaloGrp.add(dmSub);
    G.darkmatter.mats.push(dmSubMat);
    disposables.push(dmSubGeo, dmSubMat);

    var dmArcGeo = buildDmLensArcs(scale);
    var dmArcMat = makePointMaterial({ size: 1.0 });
    var dmArcs = new THREE.Points(dmArcGeo, dmArcMat);
    dmArcs.frustumCulled = false;
    dmArcGrp.add(dmArcs);
    G.darkmatter.mats.push(dmArcMat);
    disposables.push(dmArcGeo, dmArcMat);

    // 晕的等密度参考环（说明"晕到哪里为止"）
    var dmRingGeo = ringSegments([1.55, 3.05, 4.42], 80, 'xz');
    var dmRingMat = new THREE.LineBasicMaterial({
      color: 0x2c4a9e, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    var dmRings = new THREE.LineSegments(dmRingGeo, dmRingMat);
    dmRings.frustumCulled = false;
    dmHaloGrp.add(dmRings);
    G.darkmatter.mats.push(dmRingMat);
    disposables.push(dmRingGeo, dmRingMat);

    // 核球光晕（单 sprite，负责"发亮的核心"）
    var dmCoreGlow = makeGlowSprite(0xffe0b0, 1.15);
    dmDiskGrp.add(dmCoreGlow);
    G.darkmatter.mats.push(dmCoreGlow.material);

    // 星系组整体放大 1.22：同一相机距离下让盘与晕的细节铺满画面（相机仍三模式统一，切换不推镜）
    G.darkmatter.group.scale.setScalar(1.22);
    G.darkenergy.group.scale.setScalar(1.10);

    /* ============ 3) 暗能量 ============ */
    var deWebGeo = buildDeWeb(scale);
    var deWebMat = makePointMaterial({ size: 1.0 });
    var deWeb = new THREE.Points(deWebGeo, deWebMat);
    deWeb.frustumCulled = false;
    G.darkenergy.group.add(deWeb);
    G.darkenergy.mats.push(deWebMat);
    disposables.push(deWebGeo, deWebMat);

    // 固定参考环：星系穿环飞出，膨胀才看得见
    var deRingGeo = ringSegments([1.15, 2.25, 3.30], 72, 'xz');
    var deRingMat = new THREE.LineBasicMaterial({
      color: 0x5c86ff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    var deRings = new THREE.LineSegments(deRingGeo, deRingMat);
    deRings.frustumCulled = false;
    G.darkenergy.group.add(deRings);
    G.darkenergy.mats.push(deRingMat);
    disposables.push(deRingGeo, deRingMat);

    // 观测者标记（我们在这里）
    var deMark = makeGlowSprite(0xbfd4ff, 0.52);
    G.darkenergy.group.add(deMark);
    G.darkenergy.mats.push(deMark.material);

    // 背景星野
    var stars = COSMOS.builders.makeStarfield({
      count: Math.round(CFG.starCount * (q === 'low' ? 0.5 : 1)),
      rMin: 420, rMax: 1500
    });
    scene.add(stars);

    /* ---------------- 相机状态 ---------------- */
    var yaw = CFG.yaw0;
    var pitch = CFG.pitch0;
    var zoomMul = 1;
    var distCur = CFG.dist;
    var curMode = EX.mode;
    var vYaw = 0, vPitch = 0;
    var gOrbit = 0;
    var dmOrbit = 0;
    var deOrbit = 0;
    var haloVis = 1;      // 晕显隐过渡
    var lensVis = 1;      // 透镜弧显隐（跟随晕）
    var massNorm = (U.clamp(EX.dmMass, 0.6, 3.0) - 0.6) / 2.4;
    var expansion = 1;
    var spin = 0;
    var spinHold = 0;
    var resetT = 0;
    var aspectNow = ctx.aspect || 1;
    var localT = 0;

    var _camPos = new THREE.Vector3();
    var _fwd = new THREE.Vector3();
    var _right = new THREE.Vector3();
    var _up = new THREE.Vector3();
    var _look = new THREE.Vector3();
    var _worldUp = new THREE.Vector3(0, 1, 0);

    function syncMode(silent) {
      var m = EX.mode;
      if (m !== 'darkmatter' && m !== 'darkenergy') m = 'gravity';
      if (m === curMode) return;
      curMode = m;
      EX.mode = m;
      if (!silent) COSMOS.emit('extreme:mode', { mode: m });
    }

    function placeCamera() {
      var ya = yaw + spin;
      var cy = Math.cos(pitch);
      var sy = Math.sin(pitch);
      var cyw = Math.cos(ya);
      var syw = Math.sin(ya);

      _fwd.set(syw * cy, sy, cyw * cy);
      _camPos.copy(_fwd).multiplyScalar(distCur);
      camera.position.copy(_camPos);

      _fwd.multiplyScalar(-1);
      _right.crossVectors(_fwd, _worldUp).normalize();
      _up.crossVectors(_right, _fwd).normalize();

      // 三模式同一视点偏移，切换时镜头不摆
      _look.set(0, CFG.lookY, 0)
        .addScaledVector(_right, CFG.lookX)
        .addScaledVector(_up, 0);
      camera.lookAt(_look);
    }

    var pr0 = (ctx.renderer && ctx.renderer.getPixelRatio) ? ctx.renderer.getPixelRatio()
      : (ctx.pixelRatio || window.devicePixelRatio || 1);
    function setPixelRatio(p) {
      dmDiskMat.uniforms.uPixelRatio.value = p;
      dmBulgeMat.uniforms.uPixelRatio.value = p;
      dmHaloMat.uniforms.uPixelRatio.value = p;
      dmSubMat.uniforms.uPixelRatio.value = p;
      dmArcMat.uniforms.uPixelRatio.value = p;
      deWebMat.uniforms.uPixelRatio.value = p;
      stars.material.uniforms.uPixelRatio.value = p;
    }
    setPixelRatio(pr0);

    // 初始透明度
    for (var gk in G) {
      G[gk].op = gk === curMode ? 1 : 0;
      for (var mi = 0; mi < G[gk].mats.length; mi++) setMatOpacity(G[gk].mats[mi], G[gk].op);
      G[gk].group.visible = G[gk].op > 0.004;
    }
    // 暗物质模式初始值
    dmDiskMat.uniforms.uHaloScale.value = 1;
    dmBulgeMat.uniforms.uHaloScale.value = 1;
    dmArcMat.uniforms.uHaloScale.value = 1;
    dmHaloMat.uniforms.uHaloScale.value = 0.78 + 0.30 * massNorm;
    dmSubMat.uniforms.uHaloScale.value = 0.78 + 0.30 * massNorm;
    // 暗能量模式初始值
    deWebMat.uniforms.uExpansion.value = 1;
    deWebMat.uniforms.uRedshift.value = 1.05;
    placeCamera();

    /* ---------------- 更新 ---------------- */
    function update(t, dt, p) {
      if (!isFinite(t)) t = 0;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.1) dt = 0.1;
      if (!isFinite(p)) p = 0;
      p = U.clamp(p, 0, 1);
      localT += dt;

      var reduced = !!(mqReduce && mqReduce.matches) || !!ctx.reduceMotion;

      // 外部改了 mode
      if (EX.mode !== curMode) syncMode(false);

      // 模式切换：三组亮度互补交叉淡化（op 之和保持 1，总亮度不跳）
      for (var gk2 in G) {
        var target = gk2 === curMode ? 1 : 0;
        G[gk2].op = U.damp(G[gk2].op, target, CFG.fade, dt);
        if (Math.abs(G[gk2].op - target) < 0.002) G[gk2].op = target;
        for (var mi2 = 0; mi2 < G[gk2].mats.length; mi2++) setMatOpacity(G[gk2].mats[mi2], G[gk2].op);
        G[gk2].group.visible = G[gk2].op > 0.004;
      }

      var clock = reduced ? t * 0.3 : t;
      stars.material.uniforms.uTime.value = clock * 0.6;
      stars.position.copy(camera.position);

      /* ---- 输入：拖拽 / 惯性 / 键盘 / 缩放 ---- */
      var dragging = !!input.dragging && !!input.down && !input.uiTarget;
      var kk = input.keys || {};

      if (dragging) {
        var dYaw = -input.dx * CFG.dragYaw;
        var dPitch = input.dy * CFG.dragPitch;
        yaw += dYaw;
        pitch = U.clamp(pitch + dPitch, -CFG.pitchMax, CFG.pitchMax);
        vYaw = U.clamp(dYaw / Math.max(dt, 0.012), -14, 14);
        vPitch = U.clamp(dPitch / Math.max(dt, 0.012), -14, 14);
        spinHold = 0.9;
        resetT = 0;
      } else {
        if (vYaw !== 0) {
          yaw += vYaw * dt;
          vYaw *= Math.exp(-dt / CFG.inertiaTau);
          if (Math.abs(vYaw) < 0.012) vYaw = 0;
        }
        if (vPitch !== 0) {
          pitch = U.clamp(pitch + vPitch * dt, -CFG.pitchMax, CFG.pitchMax);
          vPitch *= Math.exp(-dt / CFG.inertiaTau);
          if (Math.abs(vPitch) < 0.012) vPitch = 0;
        }
      }

      var ky = (kk.ArrowLeft || kk.a ? 1 : 0) - (kk.ArrowRight || kk.d ? 1 : 0);
      if (ky !== 0) { yaw += ky * 1.25 * dt; spinHold = 0.6; }
      var kp = (kk.w ? 1 : 0) - (kk.s ? 1 : 0);
      if (kp !== 0) {
        pitch = U.clamp(pitch + kp * 0.7 * dt, -CFG.pitchMax, CFG.pitchMax);
        spinHold = 0.6;
      }
      if (kk['1']) { EX.mode = 'gravity'; syncMode(false); }
      else if (kk['2']) { EX.mode = 'darkmatter'; syncMode(false); }
      else if (kk['3']) { EX.mode = 'darkenergy'; syncMode(false); }

      var zoomKey = (kk['+'] || kk['='] ? 1 : 0) - (kk['-'] ? 1 : 0);
      if (zoomKey !== 0) zoomMul *= Math.exp(-zoomKey * 0.85 * dt);
      if (input.wheelCtrl) zoomMul *= Math.exp(input.wheelCtrl * 0.0009);
      if (input.pinch) zoomMul *= Math.exp(-input.pinch * 1.15);
      zoomMul = U.clamp(zoomMul, 0.55, 2.2);

      // 复位过渡
      if (resetT > 0) {
        resetT -= dt;
        yaw = U.damp(yaw, CFG.yaw0, 14, dt);
        pitch = U.damp(pitch, CFG.pitch0, 14, dt);
        zoomMul = U.damp(zoomMul, CFG.zoomDefault, 14, dt);
        if (resetT <= 0) {
          yaw = CFG.yaw0; pitch = CFG.pitch0; zoomMul = CFG.zoomDefault;
        }
      }

      /* ============ 模式内容（三组都持续更新，切回时状态连续） ============ */
      var opG = G.gravity.op, opDm = G.darkmatter.op, opDe = G.darkenergy.op;

      // ---- 引力波 ----
      orbitG:
      {
        gOrbit += (reduced ? 0.30 : 0.62) * dt;
        var omega = gOrbit * 2.0;
        var ca = Math.cos(gOrbit), sa = Math.sin(gOrbit);
        var bhDist = 1.35;
        var by = 0.55;

        bhA.position.set(ca * bhDist, by, sa * bhDist);
        bhB.position.set(-ca * bhDist, by, -sa * bhDist);
        ringA.line.quaternion.copy(camera.quaternion);
        ringB.line.quaternion.copy(camera.quaternion);

        gridMat.uniforms.uPhase.value = omega;
        gridMat.uniforms.uTime.value = clock;
        gridMat.uniforms.uBH1.value.set(ca * bhDist, sa * bhDist);
        gridMat.uniforms.uBH2.value.set(-ca * bhDist, -sa * bhDist);

        var strain = isFinite(EX.strain) ? U.clamp(EX.strain, 1e-22, 1e-18) : 1e-21;
        var amp = 0.10 + 0.90 * (Math.log(strain / 1e-22) / Math.LN10 / 4);
        gridMat.uniforms.uAmp.value = U.clamp(amp, 0.10, 1.0);

        glowA.material.opacity = 0.75 * opG;
        glowB.material.opacity = 0.75 * opG;
        ringA.mat.opacity = 0.85 * opG;
        ringB.mat.opacity = 0.85 * opG;
      }

      // ---- 暗物质 ----
      {
        var massNow = isFinite(EX.dmMass) ? U.clamp(EX.dmMass, 0.6, 3.0) : 2.0;
        var mn = (massNow - 0.6) / 2.4;
        if (mn !== massNorm) massNorm = U.damp(massNorm, mn, 6, dt);
        var haloScale = 0.78 + 0.30 * massNorm;

        // 角速度：晕越重，外围转得越快（与旋转曲线同向）
        dmOrbit += (reduced ? 0.075 : 0.15) * (1 + 0.45 * massNorm) * dt;
        dmDiskGrp.rotation.y = dmOrbit;
        dmHaloGrp.rotation.y = -dmOrbit * 0.16;
        dmArcGrp.rotation.y = 0;

        var haloOn = EX.dmHalo === false ? 0 : 1;
        var lensOn = (EX.dmLens === false || EX.dmHalo === false) ? 0 : 1;
        haloVis = U.damp(haloVis, haloOn, CFG.haloFade, dt);
        lensVis = U.damp(lensVis, lensOn, CFG.haloFade * 0.85, dt);

        dmHaloMat.uniforms.uHaloScale.value = haloScale;
        dmSubMat.uniforms.uHaloScale.value = haloScale;
        dmHaloMat.uniforms.uOpacity.value = opDm * haloVis;
        dmSubMat.uniforms.uOpacity.value = opDm * haloVis;
        for (var dg = 0; dg < dmGlow.length; dg++) {
          dmGlow[dg].material.opacity = dmGlow[dg].userData.baseOpacity * opDm * haloVis;
        }
        dmArcMat.uniforms.uOpacity.value = opDm * lensVis;
        dmRingMat.opacity = 0.22 * opDm * haloVis;
        dmCoreGlow.material.opacity = 0.20 * opDm;
        dmHalo.visible = haloVis > 0.004;
        dmSub.visible = haloVis > 0.004;
        for (var dg2 = 0; dg2 < dmGlow.length; dg2++) dmGlow[dg2].visible = haloVis > 0.004;
        dmArcs.visible = lensVis > 0.004;
        dmRings.visible = haloVis > 0.004;
        dmDiskMat.uniforms.uOpacity.value = opDm;
        dmBulgeMat.uniforms.uOpacity.value = opDm;
        dmDiskMat.uniforms.uTime.value = clock;
        dmBulgeMat.uniforms.uTime.value = clock;
        dmHaloMat.uniforms.uTime.value = clock;
        dmSubMat.uniforms.uTime.value = clock;
        dmArcMat.uniforms.uTime.value = clock;
      }

      // ---- 暗能量 ----
      {
        var a = isFinite(EX.scaleFactor) ? U.clamp(EX.scaleFactor, 1, 3) : 1;
        expansion = a;
        deOrbit += (reduced ? 0.02 : 0.045) * dt;
        deWeb.rotation.y = deOrbit;
        deWebMat.uniforms.uExpansion.value = a;
        deWebMat.uniforms.uRedshift.value = 1.05;
        deWebMat.uniforms.uOpacity.value = opDe;
        deWebMat.uniforms.uTime.value = clock;
        deRingMat.opacity = 0.46 * opDe;
        deMark.material.opacity = 0.55 * opDe;
      }

      // —— 自动极慢绕行（reduceMotion 时停）
      if (spinHold > 0) spinHold -= dt;
      if (!reduced && !dragging && spinHold <= 0) spin += CFG.autoSpin * dt;

      // —— 相机距离：三模式统一，无推镜
      var targetDist = U.clamp(CFG.dist * zoomMul, CFG.zoomMin, CFG.zoomMax);
      distCur = U.damp(distCur, targetDist, 6.5, dt);
      placeCamera();
    }

    function resize(w, h) {
      var a = (w || 1) / Math.max(h || 1, 1);
      aspectNow = isFinite(a) && a > 0 ? a : 1;
      U.fitCamera(camera, CFG.fov, aspectNow);
      camera.updateProjectionMatrix();
      var p = (ctx.renderer && ctx.renderer.getPixelRatio) ? ctx.renderer.getPixelRatio()
        : (ctx.pixelRatio || window.devicePixelRatio || 1);
      setPixelRatio(p);
      placeCamera();
    }

    function enter() {
      vYaw = 0;
      vPitch = 0;
    }

    function leave() {
      vYaw = 0;
      vPitch = 0;
      spinHold = 1.2;
    }

    function reset() {
      vYaw = 0;
      vPitch = 0;
      spinHold = 1.2;
      resetT = 0.45;
      EX.mode = 'gravity';
      EX.strain = 1e-21;
      EX.scaleFactor = 1;
      EX.dmHalo = true;
      EX.dmLens = true;
      EX.dmMass = 2.0;
      if (EX.mode !== curMode) syncMode(false);
      COSMOS.emit('extreme:reset');
    }

    function dispose() {
      for (var i = 0; i < disposables.length; i++) {
        if (disposables[i] && disposables[i].dispose) disposables[i].dispose();
      }
      disposables.length = 0;
      glowA.material.dispose();
      glowB.material.dispose();
      dmCoreGlow.material.dispose();
      deMark.material.dispose();
      scene.remove(stars);
      if (stars.geometry) stars.geometry.dispose();
      scene.clear();
      G.gravity.group = G.darkmatter.group = G.darkenergy.group = null;
    }

    return {
      scene: scene,
      camera: camera,
      update: update,
      resize: resize,
      enter: enter,
      leave: leave,
      dispose: dispose,
      reset: reset,
      bloom: { strength: 0.62, threshold: 0.93 }
    };
  });
})(window.COSMOS = window.COSMOS || {});
