/* ============================================================
 * 06 星系碰撞 · GALAXY COLLISION — 3D 场景（P4）
 *
 * 契约：artifacts/p4-contract.md §3–§5
 * 单位：kpc / Myr / M☉（1 AU ≠ 这里的世界单位；本场景 1 世界单位 = 1 kpc）
 * 物理：COSMOS.galaxyModel（两核有质量 + 1.2 万无质量恒星，限制性 N 体）
 * 渲染：两核加法发光 + 单个 Points 恒星（预建 BufferGeometry）
 *       + 2–3 层 ghost 轨迹（show.trails）+ 速度着色（show.velocity）
 *       + #coll-labels 两个 DOM 标签（show.names）
 * 相机：球坐标 yaw/pitch/dist，拖拽 1:1 + 惯性、滚轮、方向键、Esc
 * 事件：8Hz collision:tick、collision:ready、collision:cmd 全类型
 * 性能：draw call ≤ 12、三角 ≤ 5 万、high ≥ 50fps、update 内禁止 new
 * 风格：IIFE + 'use strict' + ES5（var/function），中文注释，零网络/ESM/addons
 * ============================================================ */
(function () {
  'use strict';

  var CO = window.COSMOS;
  if (!CO) { return; }
  var U = CO.util || {};
  var TDEG = Math.PI / 180;

  /* ---------------------------------------------------------- 常量 */

  var TAU = Math.PI * 2;
  var PITCH_MIN = 0.05;
  var PITCH_MAX = 1.52;
  var DIST_MIN = 12;
  var DIST_MAX = 900;
  var TICK = 0.125;              /* 8Hz 事件节流 */
  var STAR_CAP = 12000;          /* 恒星上限（low 画质减半） */
  var GHOST_LAYERS = 3;          /* 核轨迹 ghost 层数 */
  var GHOST_POINTS = 36;         /* 每层每核采样点数 */
  var GHOST_HIST = 200;          /* 核位置历史环形缓冲长度（每核） */
  var GHOST_STEP = [2, 4, 7];    /* 各层取历史点的间隔（越大越"旧"） */
  var GHOST_OPACITY = [0.62, 0.40, 0.22];
  var VIEW_SHIFT_X = 0.055;      /* 画面中心右移，避开左栏文案（视觉验收：1280 下星系居中偏右） */
  var VIEW_SHIFT_Y = -0.02;
  /* 个别场景的取景偏移覆盖：bullseye 的环占地小、且要避开左栏文案，需右移更多；
     其余场景沿用默认 VIEW_SHIFT_X，避免 collide/passer 的伴星系被右栏控制台压住。 */
  var SCENE_SHIFT = {
    bullseye: -0.03
  };
  /* 每场景默认相机距离（kpc）：按 1280×720 下盘面/环的目标像素跨度校准，
     不做一刀切；分享深链传入的 cam.dist 优先于这里。 */
  var SCENE_FRAMING = {
    collide: 85,
    custom: 81,
    passer: 78,
    retrograde: 73,
    bullseye: 52,
    spiral: 38
  };
  /* 场景专用相机角度覆盖：未列出的沿用模型 meta.camera。
     bullseye 的盘面在 x-y 平面（法线 +z），必须沿 +z 看（face-on）才能看到
     「穿心成环」，而模型自带相机是俯视盘边，所以这里强制覆盖。 */
  var SCENE_CAM = {
    bullseye: { yaw: 0.1, pitch: 0.16 }
  };
  var CAM_LAMBDA = 8;            /* 相机 damp 速率 */
  var VEL_MIN = 0.9;             /* 速度着色下限（km/s 量级归一化前） */

  /* ---------------------------------------------------------- 小工具 */

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function damp(cur, target, lambda, dt) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  }

  /* 平滑阶跃（与 GLSL smoothstep 同语义） */
  function smoothstepF(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function T(zh, en) {
    if (CO.i18n && typeof CO.i18n.T === 'function') { return CO.i18n.T(zh, en); }
    return zh;
  }

  function fmtMyr(v) {
    var a = Math.abs(v || 0);
    if (a >= 1000) { return (v / 1000).toFixed(2) + ' Gyr'; }
    return Math.round(v || 0) + ' Myr';
  }

  /* ---------------------------------------------------------- 程序化纹理 */

  /* 加法发光贴图：中心亮、外缘平滑衰减（核球辉光/星点用） */
  function makeGlowTexture(size, inner, outer) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(clamp(inner, 0.02, 0.9), 'rgba(255,255,255,.92)');
    g.addColorStop(clamp(outer, 0.1, 0.99), 'rgba(255,255,255,.20)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* 星点着色器：点大小随距离衰减、加法混合、圆形软边 */
  var STAR_VS = [
    'attribute vec3 aColor;',
    'varying vec3 vColor;',
    'uniform float uPixelRatio;',
    'uniform float uSize;',
    'void main() {',
    '  vColor = aColor;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = clamp(uSize * uPixelRatio * (360.0 / max(-mv.z, 1.0)), 1.0 * uPixelRatio, 2.2 * uPixelRatio);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var STAR_FS = [
    'varying vec3 vColor;',
    'uniform float uOpacity;',
    'void main() {',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float d = dot(c, c);',
    '  if (d > 0.25) { discard; }',
    '  float a = smoothstep(0.25, 0.0, d) * uOpacity;',
    '  gl_FragColor = vec4(vColor * a * 1.35, 1.0);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------- 物理模型兜底
   * 正式模型由 ephem 交付（COSMOS.galaxyModel）。模型缺失时用本兜底保持画面可跑：
   * 两核圆轨道互转 + 恒星受两核引力的限制性积分（足够展示桥/尾形态，非验收口径）。
   * ---------------------------------------------------------- */

  var FALLBACK_MODEL = (function () {
    var G = 4.5e-12;

    function mulberry32(seed) {
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /* 场景定义（与契约 §2 的 6 场景一致；时间尺度默认 10 Myr/秒） */
    var SCENES = {
      collide: {
        id: 'collide', name: '双旋碰撞', en: 'Two spirals collide',
        duration: 400, timeScale: 10,
        camera: { yaw: 0.6, pitch: 0.9, dist: 120 },
        A: { mass: 1e11, disk: 11, spin: 1, lean: 0 },
        B: { mass: 1e11, disk: 8, spin: 1, lean: 0 },
        approach: 9
      },
      custom: {
        id: 'custom', name: '自设碰撞', en: 'Set up your own',
        duration: 400, timeScale: 10,
        camera: { yaw: 0.6, pitch: 0.9, dist: 120 },
        A: { mass: 1e11, disk: 11, spin: 1, lean: 0 },
        B: { mass: 5e10, disk: 9, spin: 1, lean: 0 },
        approach: 12
      },
      passer: {
        id: 'passer', name: '小星系掠过', en: 'A small galaxy passes by',
        duration: 400, timeScale: 10,
        camera: { yaw: 0.6, pitch: 0.9, dist: 110 },
        A: { mass: 1e11, disk: 11, spin: 1, lean: 0 },
        B: { mass: 3e10, disk: 8, spin: 1, lean: 0 },
        approach: 14
      },
      retrograde: {
        id: 'retrograde', name: '逆向掠过', en: 'The same pass, against the spin',
        duration: 400, timeScale: 10,
        camera: { yaw: 0.6, pitch: 0.9, dist: 110 },
        A: { mass: 1e11, disk: 11, spin: 1, lean: 0 },
        B: { mass: 3e10, disk: 8, spin: -1, lean: 0 },
        approach: 14
      },
      bullseye: {
        id: 'bullseye', name: '穿心成环', en: 'A bullseye makes a ring',
        duration: 260, timeScale: 10,
        camera: { yaw: 0.5, pitch: 1.15, dist: 70 },
        A: { mass: 1e11, disk: 11, spin: 1, lean: 0 },
        B: { mass: 0.5e11, disk: 8, spin: 1, lean: 0 },
        approach: 0.5
      },
      spiral: {
        id: 'spiral', name: '螺旋缠绕', en: 'A spiral winds up',
        duration: 300, timeScale: 5,
        camera: { yaw: 0.4, pitch: 1.25, dist: 46 },
        A: { mass: 1e11, disk: 11, spin: 1, lean: 0 },
        B: null,
        approach: 0
      }
    };

    function sceneList(id) {
      if (id && SCENES[id]) { return SCENES[id]; }
      var out = [];
      for (var k in SCENES) { if (SCENES.hasOwnProperty(k)) { out.push(SCENES[k]); } }
      return out;
    }

    /* 指数盘 + 双螺旋臂 + 噪声的恒星分布，速度取圆轨道速度 */
    function makeDisk(out, off, count, radius, massEnc, spin, lean, rand) {
      var i, r, th, rn, arm, armPhase, rnd, cx, cy;
      var sinL = Math.sin(lean * TDEG), cosL = Math.cos(lean * TDEG);
      for (i = 0; i < count; i++) {
        rn = rand();
        r = radius * (0.16 + 0.84 * Math.sqrt(rn));
        th = rand() * TAU;
        /* 两条对数螺旋臂：40% 的恒星向臂附近聚拢 */
        if (rand() < 0.42) {
          arm = rand() < 0.5 ? 0 : 1;
          armPhase = Math.log(Math.max(r, 0.4) / 1.6) * 2.6 + arm * Math.PI + th * 0.12;
          th = armPhase + (rand() - 0.5) * 0.55;
        } else {
          th += (rand() - 0.5) * 0.9;
        }
        var v = Math.sqrt(Math.max(G * massEnc * (r / radius), 1e-30) / Math.max(r, 0.4));
        var x = Math.cos(th) * r;
        var z = Math.sin(th) * r;
        /* 顺/逆自旋：切向速度反向；倾角绕 x 轴抬升 */
        var vx = -Math.sin(th) * v * spin;
        var vz = Math.cos(th) * v * spin;
        var yy = (rand() - 0.5) * 0.22 * r;
        out[off + i * 3] = x;
        out[off + i * 3 + 1] = yy * cosL + z * sinL;
        out[off + i * 3 + 2] = z * cosL - yy * sinL;
        out.vel[off + i * 3] = vx;
        out.vel[off + i * 3 + 1] = (rand() - 0.5) * 0.02;
        out.vel[off + i * 3 + 2] = vz;
      }
    }

    function buildScene(id, params) {
      var def = SCENES[id] || SCENES.collide;
      var p = params || {};
      var count = Math.max(1200, Math.min(STAR_CAP, Math.round(p.count || STAR_CAP)));
      var nA = def.B ? Math.round(count * 0.58) : count;
      var nB = count - nA;
      var rand = mulberry32(def.id === 'custom' ? 7 : (def.id.length * 131 + 17));
      var massA = 1e11;
      var massB = def.B ? (def.B.mass || 3e10) : 0;
      var diskA = def.A.disk;
      var diskB = def.B ? def.B.disk : 0;

      var pos = new Float32Array(count * 3);
      var vel = new Float32Array(count * 3);
      var box = { pos: pos, vel: vel };

      makeDisk(box, 0, nA, diskA, massA, def.A.spin, def.A.lean, rand);
      if (nB > 0) {
        makeDisk(box, nA * 3, nB, diskB, massB, def.B.spin, def.B.lean, rand);
      }

      /* 伴星系摆到引力中心附近（接近轨迹起点），沿 +x 方向落向主星系 */
      var approach = def.approach;
      var sep = Math.max(approach + diskA + diskB, approach * 2 + 4);
      var cores = [];
      cores.push({
        id: 'A', mass: massA, radiusKpc: 3.2,
        pos: [0, 0, 0],
        vel: [0, 0, 0]
      });
      if (def.B) {
        var vRel = Math.sqrt(G * (massA + massB) / Math.max(sep, 6)) * 0.72;
        cores.push({
          id: 'B', mass: massB, radiusKpc: 2.2,
          pos: [sep, 0, 0.35 * sep],
          vel: [0, 0, -vRel]
        });
        /* 把伴星系恒星搬到 B 核附近 */
        var i;
        for (i = nA; i < count; i++) {
          pos[i * 3] += sep;
          pos[i * 3 + 2] += 0.35 * sep;
          vel[i * 3 + 2] += -vRel;
        }
      } else {
        /* 单星系：主核固定，恒星在盘内绕转（顺行） */
        cores[0].fixed = true;
      }

      var sim = {
        id: def.id,
        params: p,
        cores: cores,
        stars: { count: count, pos: pos, vel: vel },
        camera: def.camera,
        timeScale: def.timeScale,
        duration: def.duration,
        meta: { baselineEnergy: 0 }
      };
      sim.meta.baselineEnergy = FALLBACK_MODEL.energy(sim);
      return sim;
    }

    function coreStep(sim, dt) {
      var cores = sim.cores;
      var a = cores[0], b = cores[1];
      if (!b) { return; }
      var dx = b.pos[0] - a.pos[0];
      var dy = b.pos[1] - a.pos[1];
      var dz = b.pos[2] - a.pos[2];
      var r2 = dx * dx + dy * dy + dz * dz + 1.2 * 1.2;
      var inv = 1 / Math.sqrt(r2);
      var f = G * inv * inv * inv;
      if (!a.fixed) {
        a.vel[0] += f * b.mass * dx * dt * 0.5;
        a.vel[1] += f * b.mass * dy * dt * 0.5;
        a.vel[2] += f * b.mass * dz * dt * 0.5;
        a.pos[0] += a.vel[0] * dt;
        a.pos[1] += a.vel[1] * dt;
        a.pos[2] += a.vel[2] * dt;
        a.vel[0] += f * b.mass * dx * dt * 0.5;
        a.vel[1] += f * b.mass * dy * dt * 0.5;
        a.vel[2] += f * b.mass * dz * dt * 0.5;
      }
      b.vel[0] -= f * a.mass * dx * dt * 0.5;
      b.vel[1] -= f * a.mass * dy * dt * 0.5;
      b.vel[2] -= f * a.mass * dz * dt * 0.5;
      b.pos[0] += b.vel[0] * dt;
      b.pos[1] += b.vel[1] * dt;
      b.pos[2] += b.vel[2] * dt;
      b.vel[0] -= f * a.mass * dx * dt * 0.5;
      b.vel[1] -= f * a.mass * dy * dt * 0.5;
      b.vel[2] -= f * a.mass * dz * dt * 0.5;
    }

    function starStep(sim, dt) {
      var cores = sim.cores;
      var a = cores[0], b = cores[1];
      var pos = sim.stars.pos, vel = sim.stars.vel, n = sim.stars.count;
      var ax = a.pos[0], ay = a.pos[1], az = a.pos[2];
      var bx = b ? b.pos[0] : 0, by = b ? b.pos[1] : 0, bz = b ? b.pos[2] : 0;
      var am = a.mass, bm = b ? b.mass : 0;
      var i, x, y, z, dx, dy, dz, r2, inv, f, gx, gy, gz;
      for (i = 0; i < n; i++) {
        x = pos[i * 3]; y = pos[i * 3 + 1]; z = pos[i * 3 + 2];
        dx = ax - x; dy = ay - y; dz = az - z;
        r2 = dx * dx + dy * dy + dz * dz + 1.44;
        inv = 1 / Math.sqrt(r2);
        f = G * am * inv * inv * inv;
        gx = f * dx; gy = f * dy; gz = f * dz;
        if (b) {
          dx = bx - x; dy = by - y; dz = bz - z;
          r2 = dx * dx + dy * dy + dz * dz + 1.44;
          inv = 1 / Math.sqrt(r2);
          f = G * bm * inv * inv * inv;
          gx += f * dx; gy += f * dy; gz += f * dz;
        }
        /* 速度 Verlet（先半踢、漂移、再半踢，近似） */
        vel[i * 3] += gx * dt;
        vel[i * 3 + 1] += gy * dt;
        vel[i * 3 + 2] += gz * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
    }

    function step(sim, dtMyr) {
      if (!dtMyr) { return; }
      var steps = 1;
      var dt = dtMyr;
      var sub = Math.abs(dtMyr) / 1.2;
      steps = clamp(Math.ceil(sub), 1, 6);
      dt = dtMyr / steps;
      for (var s = 0; s < steps; s++) {
        coreStep(sim, dt);
        starStep(sim, dt);
      }
    }

    function coreDistance(sim) {
      var a = sim.cores[0], b = sim.cores[1];
      if (!b) { return 0; }
      var dx = b.pos[0] - a.pos[0];
      var dy = b.pos[1] - a.pos[1];
      var dz = b.pos[2] - a.pos[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function energy(sim) {
      var a = sim.cores[0], b = sim.cores[1];
      var e = 0.5 * a.mass * (a.vel[0] * a.vel[0] + a.vel[1] * a.vel[1] + a.vel[2] * a.vel[2]);
      if (b) {
        e += 0.5 * b.mass * (b.vel[0] * b.vel[0] + b.vel[1] * b.vel[1] + b.vel[2] * b.vel[2]);
        var dx = b.pos[0] - a.pos[0];
        var dy = b.pos[1] - a.pos[1];
        var dz = b.pos[2] - a.pos[2];
        e -= G * a.mass * b.mass / Math.sqrt(dx * dx + dy * dy + dz * dz + 1.44);
      }
      return e;
    }

    return {
      version: '0-fallback',
      G: G,
      sceneList: sceneList,
      buildScene: buildScene,
      step: step,
      coreDistance: coreDistance,
      energy: energy,
      formatMyr: fmtMyr
    };
  })();

  /* 正式模型优先；缺失时暂时使用兜底（契约 API 同名同形） */
  function pickModel() {
    var m = CO.galaxyModel;
    if (m && typeof m.buildScene === 'function' && typeof m.step === 'function') { return m; }
    return FALLBACK_MODEL;
  }

  /* ---------------------------------------------------------- 舞台 */

  CO.registerStage('collision', function (ctx) {
    var sol = CO.state && CO.state.collision;
    /* 若 boot 尚未初始化（早期 / 独立测试），自行补一个默认状态 */
    if (!sol) {
      sol = {
        scene: 'collide', paused: false, speed: 1, myr: 0,
        params: { ratio: 1, approach: 9, spinA: 1, spinB: 1, leanA: 0, leanB: 0 },
        show: { trails: true, velocity: false, names: true },
        cam: { yaw: 0.6, pitch: 0.9, dist: 120 },
        stats: { count: 0, coreDist: 0, energyPct: 0 },
        ver: 0
      };
      if (CO.state) { CO.state.collision = sol; }
    }
    if (!sol.params) { sol.params = { ratio: 1, approach: 9, spinA: 1, spinB: 1, leanA: 0, leanB: 0 }; }
    if (!sol.show) { sol.show = { trails: true, velocity: false, names: true }; }
    if (!sol.cam) { sol.cam = { yaw: 0.6, pitch: 0.9, dist: 120 }; }
    if (!sol.stats) { sol.stats = { count: 0, coreDist: 0, energyPct: 0 }; }
    if (typeof sol.ver !== 'number') { sol.ver = 0; }

    var MODEL = pickModel();
    var isLow = ctx.quality === 'low';
    var width = ctx.width || 1280;
    var height = ctx.height || 720;
    var aspect = effectiveAspect();
    var pr = Math.min(ctx.pixelRatio || 1, 2);

    var scn = new THREE.Scene();
    var camera = U.makeCamera ? U.makeCamera(50, aspect) : new THREE.PerspectiveCamera(50, aspect, 0.01, 6000);
    camera.near = 0.05;
    camera.far = 4000;
    camera.updateProjectionMatrix();

    /* 共享几何/材质资源 */
    var glowTex = makeGlowTexture(128, 0.16, 0.55);
    var coreGeo = new THREE.SphereGeometry(1, isLow ? 12 : 20, isLow ? 8 : 14);

    var coreGroup = new THREE.Group();
    scn.add(coreGroup);

    /* 恒星 Points（单 draw call）：预建几何，position/color 都是动态属性 */
    var starCount = 0;
    var starGeo = new THREE.BufferGeometry();
    var posAttr = new THREE.BufferAttribute(new Float32Array(STAR_CAP * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    var colAttr = new THREE.BufferAttribute(new Float32Array(STAR_CAP * 3), 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    starGeo.setAttribute('position', posAttr);
    starGeo.setAttribute('aColor', colAttr);
    starGeo.setDrawRange(0, 0);
    var starMat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: pr },
        uSize: { value: isLow ? 1.8 : 2.0 },
        uOpacity: { value: 1.0 }
      },
      vertexShader: STAR_VS,
      fragmentShader: STAR_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var starPoints = new THREE.Points(starGeo, starMat);
    starPoints.frustumCulled = false;
    starPoints.renderOrder = 3;
    scn.add(starPoints);

    /* ghost 轨迹：每层一个 Points（两层核的历史位置采样），低亮度加法 */
    var ghostGroup = new THREE.Group();
    scn.add(ghostGroup);
    var ghostLayers = [];
    var gi;
    for (gi = 0; gi < GHOST_LAYERS; gi++) {
      var ghGeo = new THREE.BufferGeometry();
      var ghPos = new THREE.BufferAttribute(new Float32Array(GHOST_POINTS * 2 * 3), 3);
      ghPos.setUsage(THREE.DynamicDrawUsage);
      ghGeo.setAttribute('position', ghPos);
      ghGeo.setDrawRange(0, GHOST_POINTS * 2);
      var ghMat = new THREE.PointsMaterial({
        map: glowTex,
        color: new THREE.Color(ghostColorOf(gi)),
        size: isLow ? 2.2 : 2.8,
        sizeAttenuation: true,
        transparent: true,
        opacity: GHOST_OPACITY[gi],
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      var gh = new THREE.Points(ghGeo, ghMat);
      gh.frustumCulled = false;
      gh.renderOrder = 2;
      ghostGroup.add(gh);
      ghostLayers.push({ points: gh, geo: ghGeo, pos: ghPos, mat: ghMat });
    }

    function ghostColorOf(layer) {
      return layer === 0 ? 0x9fc4ff : (layer === 1 ? 0x7a9fd6 : 0x6d7fa8);
    }

    /* 核位置历史环形缓冲（每核一组；ghost 各层按不同间隔取样） */
    var histA = new Float32Array(GHOST_HIST * 3);
    var histB = new Float32Array(GHOST_HIST * 3);
    var histHead = 0;
    var histCount = 0;

    /* 核视觉：发光球 + 大/小两层辉光 sprite */
    var coreViews = [];
    var coreViewA = null;

    /* DOM 标签层 */
    var labelsRoot = null;
    var labelsA = null;
    var labelsB = null;
    var labelNames = { A: T('主星系', 'Main galaxy'), B: T('伴星系', 'Companion') };

    /* 状态与相机 */
    var sim = null;
    var baselineEnergy = 0;
    var camCur = { yaw: 0.6, pitch: 0.9, dist: 120 };
    var center = new THREE.Vector3();
    var target = new THREE.Vector3();
    var _v1 = new THREE.Vector3();
    var _v2 = new THREE.Vector3();
    var _v3 = new THREE.Vector3();
    var _m1 = new THREE.Matrix4();
    var vy = 0;
    var vp = 0;
    var dragging = false;
    var dragX = 0;
    var dragY = 0;
    var hoverId = null;
    var cursorKind = '';
    var tickAcc = 0;
    var elapsed = 0;
    var lastVer = -1;
    var lastScene = '';
    var started = false;
    var offList = [];

    /* 事件 payload（预建复用） */
    var tickPayload = {
      myr: 0, paused: false, speed: 1, count: 0,
      challenge: null, coreDist: 0, energyPct: 0
    };

    /* 速度着色用的临时色 */
    var _col = new THREE.Color();
    var baseCol = new Float32Array(STAR_CAP * 3);

    /* ------------------------------------------------------ 视图偏移 */

    function effectiveAspect() {
      var w = ctx.width || 1280;
      var h = ctx.height || 720;
      return w / Math.max(h, 1);
    }

    function isNarrow() {
      return width < 860;
    }

    /* 画面中心右移（左栏文案 ≈43vw），y 略向下：与 gravity 场景一致的做法 */
    function applyViewShift(w, h) {
      if (!camera || typeof camera.setViewOffset !== 'function') { return; }
      if (isNarrow()) {
        camera.setViewOffset(w, h, 0, -h * 0.03, w, h);
      } else {
        var ax = (SCENE_SHIFT[sol.scene] != null) ? SCENE_SHIFT[sol.scene] : VIEW_SHIFT_X;
        camera.setViewOffset(w, h, w * ax, h * VIEW_SHIFT_Y, w, h);
      }
      camera.updateProjectionMatrix();
    }

    /* ------------------------------------------------------ 标签层 */

    function ensureLabels() {
      if (labelsRoot && labelsRoot.parentNode) { return; }
      var existing = document.getElementById('coll-labels');
      labelsRoot = existing || document.createElement('div');
      labelsRoot.id = 'coll-labels';
      labelsRoot.setAttribute('aria-hidden', 'true');
      labelsRoot.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;overflow:hidden;';
      if (!existing && document.body) { document.body.appendChild(labelsRoot); }
      labelsA = createLabelEl('A');
      labelsB = createLabelEl('B');
    }

    function createLabelEl(kind) {
      var el = document.createElement('span');
      el.className = 'coll-label';
      el.style.cssText = 'position:absolute;left:0;top:0;padding:2px 8px;border:1px solid rgba(255,255,255,.22);' +
        'background:rgba(0,0,0,.55);color:#fff;font:600 11px/1.5 Inter,"PingFang SC","Microsoft YaHei",sans-serif;' +
        'white-space:nowrap;will-change:transform;';
      el.textContent = kind === 'A' ? labelNames.A : labelNames.B;
      if (labelsRoot) { labelsRoot.appendChild(el); }
      return el;
    }

    function disposeLabels() {
      if (labelsA && labelsA.parentNode) { labelsA.parentNode.removeChild(labelsA); }
      if (labelsB && labelsB.parentNode) { labelsB.parentNode.removeChild(labelsB); }
      labelsA = null;
      labelsB = null;
      if (labelsRoot && labelsRoot.parentNode) { labelsRoot.parentNode.removeChild(labelsRoot); }
      labelsRoot = null;
    }

    /* ------------------------------------------------------ 核视觉 */

    function coreVisualRadius(rec) {
      return Math.max(rec.radiusKpc || 2.0, 1.1);
    }

    function coreColorOf(rec) {
      return rec.id === 'B' ? 0xbcd8ff : 0xffe6b0;
    }

    function disposeCoreViews() {
      var i, j, view, obj;
      for (i = 0; i < coreViews.length; i++) {
        view = coreViews[i];
        for (j = 0; j < view.objects.length; j++) {
          obj = view.objects[j];
          if (obj.material) {
            if (obj.material.map && obj.material.map !== glowTex) { obj.material.map.dispose(); }
            obj.material.dispose();
          }
          if (obj.geometry && obj.geometry !== coreGeo) { obj.geometry.dispose(); }
          coreGroup.remove(obj);
        }
      }
      coreViews = [];
    }

    function buildCoreViews() {
      disposeCoreViews();
      if (!sim) { return; }
      var i, rec, r, mesh, halo, inner, view;
      for (i = 0; i < sim.cores.length; i++) {
        rec = sim.cores[i];
        r = coreVisualRadius(rec);
        view = { rec: rec, objects: [], pos: new THREE.Vector3(), halo: null, inner: null, mesh: null, haloBase: r * 6.2, innerBase: r * 2.2 };
        mesh = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
          color: coreColorOf(rec),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        }));
        mesh.scale.set(r, r, r);
        coreGroup.add(mesh);
        view.objects.push(mesh);
        view.mesh = mesh;
        halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex,
          color: coreColorOf(rec),
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        }));
        halo.scale.set(r * 6.2, r * 6.2, 1);
        coreGroup.add(halo);
        view.objects.push(halo);
        view.halo = halo;
        inner = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xffffff,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        }));
        inner.scale.set(r * 2.2, r * 2.2, 1);
        coreGroup.add(inner);
        view.objects.push(inner);
        view.inner = inner;
        coreViews.push(view);
      }
    }

    /* 核发光近相机淡出：dCam<26 kpc 完全隐藏、26–46 kpc 渐入、>46 kpc 不变。
       bullseye 180 Myr 时伴星系朝相机飞来（实测伴星系核到相机约 27 kpc，
       6.2×r 的 halo sprite 仍会膨胀成约 180px 大亮球压住环），按实测距离设阈值。 */
    function updateCoreFade() {
      var i, view, rec, dx, dy, dz, dCam, fade, k;
      for (i = 0; i < coreViews.length; i++) {
        view = coreViews[i];
        rec = view.rec;
        dx = camera.position.x - rec.pos[0];
        dy = camera.position.y - rec.pos[1];
        dz = camera.position.z - rec.pos[2];
        dCam = Math.sqrt(dx * dx + dy * dy + dz * dz);
        fade = smoothstepF(26, 46, dCam);
        k = 0.35 + 0.65 * fade;
        if (view.mesh) { view.mesh.material.opacity = fade; }
        if (view.halo) {
          view.halo.material.opacity = 0.34 * fade;
          view.halo.scale.set(view.haloBase * k, view.haloBase * k, 1);
        }
        if (view.inner) {
          view.inner.material.opacity = 0.72 * fade;
          view.inner.scale.set(view.innerBase * k, view.innerBase * k, 1);
        }
      }
    }

    /* ------------------------------------------------------ 星星同步 */

    function syncStars() {
      if (!sim) { return; }
      var pos = sim.stars.pos;
      if (posAttr.array !== pos) {
        posAttr.array = pos;
        posAttr.needsUpdate = true;
      } else if (!sol.paused) {
        posAttr.needsUpdate = true;
      }
    }

    /* 基础色：内圈亮白、外圈偏蓝（重建时写一次） */
    function writeBaseColors() {
      if (!sim) { return; }
      var pos = sim.stars.pos;
      var n = starCount;
      var i, x, y, z, rr, b;
      for (i = 0; i < n; i++) {
        x = pos[i * 3]; y = pos[i * 3 + 1]; z = pos[i * 3 + 2];
        rr = Math.sqrt(x * x + y * y + z * z) / 11;
        b = clamp(1.15 - rr * 0.6, 0.45, 1.0);
        baseCol[i * 3] = b * 0.90;
        baseCol[i * 3 + 1] = b * 0.95;
        baseCol[i * 3 + 2] = b * 1.0;
        colAttr.array[i * 3] = baseCol[i * 3];
        colAttr.array[i * 3 + 1] = baseCol[i * 3 + 1];
        colAttr.array[i * 3 + 2] = baseCol[i * 3 + 2];
      }
      colAttr.needsUpdate = true;
    }

    /* 速度着色：慢=深蓝，中=白，快=橙红（8Hz 刷新即可） */
    function writeVelocityColors() {
      if (!sim) { return; }
      var vel = sim.stars.vel;
      var n = starCount;
      var i, sp, minV = 1e30, maxV = -1e30;
      for (i = 0; i < n; i++) {
        sp = Math.sqrt(vel[i * 3] * vel[i * 3] + vel[i * 3 + 1] * vel[i * 3 + 1] + vel[i * 3 + 2] * vel[i * 3 + 2]);
        if (sp < minV) { minV = sp; }
        if (sp > maxV) { maxV = sp; }
      }
      var range = Math.max(maxV - minV, 1e-6);
      var t, r, g, b;
      for (i = 0; i < n; i++) {
        sp = Math.sqrt(vel[i * 3] * vel[i * 3] + vel[i * 3 + 1] * vel[i * 3 + 1] + vel[i * 3 + 2] * vel[i * 3 + 2]);
        t = clamp((sp - minV) / range, 0, 1);
        if (t < 0.5) {
          var k = t * 2;
          r = 0.10 + 0.45 * k;
          g = 0.22 + 0.55 * k;
          b = 0.85 + 0.15 * k;
        } else {
          var k2 = (t - 0.5) * 2;
          r = 0.55 + 0.45 * k2;
          g = 0.77 - 0.17 * k2;
          b = 1.0 - 0.72 * k2;
        }
        colAttr.array[i * 3] = r;
        colAttr.array[i * 3 + 1] = g;
        colAttr.array[i * 3 + 2] = b;
      }
      colAttr.needsUpdate = true;
    }

    function refreshColors() {
      if (!sim) { return; }
      if (sol.show && sol.show.velocity) { writeVelocityColors(); }
      else {
        for (var i = 0; i < starCount * 3; i++) { colAttr.array[i] = baseCol[i]; }
        colAttr.needsUpdate = true;
      }
    }

    /* ------------------------------------------------------ 历史与 ghost */

    function resetHistory() {
      histHead = 0;
      histCount = 0;
      var i;
      for (i = 0; i < GHOST_HIST * 3; i++) { histA[i] = 0; histB[i] = 0; }
      for (i = 0; i < ghostLayers.length; i++) {
        ghostLayers[i].geo.setDrawRange(0, 0);
      }
    }

    function pushHistory() {
      if (!sim) { return; }
      var a = sim.cores[0];
      var b = sim.cores[1] || a;
      histHead = (histHead + 1) % GHOST_HIST;
      histA[histHead * 3] = a.pos[0];
      histA[histHead * 3 + 1] = a.pos[1];
      histA[histHead * 3 + 2] = a.pos[2];
      histB[histHead * 3] = b.pos[0];
      histB[histHead * 3 + 1] = b.pos[1];
      histB[histHead * 3 + 2] = b.pos[2];
      if (histCount < GHOST_HIST) { histCount++; }
    }

    function syncGhost() {
      var showTrails = !sol.show || sol.show.trails !== false;
      ghostGroup.visible = !!showTrails;
      if (!showTrails || !sim) { return; }
      var li, s, ki, layer, arr, hist, back, idx, p, maxBack;
      for (li = 0; li < GHOST_LAYERS; li++) {
        layer = ghostLayers[li];
        arr = layer.pos.array;
        p = 0;
        for (ki = 0; ki < 2; ki++) {
          hist = ki === 0 ? histA : histB;
          maxBack = Math.min(GHOST_POINTS * GHOST_STEP[li], Math.max(histCount - 1, 0));
          for (s = 0; s < GHOST_POINTS; s++) {
            back = Math.min((s + 1) * GHOST_STEP[li], maxBack);
            idx = (histHead - back + GHOST_HIST * 2) % GHOST_HIST;
            arr[p] = hist[idx * 3];
            arr[p + 1] = hist[idx * 3 + 1];
            arr[p + 2] = hist[idx * 3 + 2];
            p += 3;
          }
        }
        layer.geo.setDrawRange(0, GHOST_POINTS * 2);
        layer.pos.needsUpdate = true;
      }
    }

    /* ------------------------------------------------------ 标签更新 */

    function projectToScreen(pos, out) {
      _v1.set(pos[0], pos[1], pos[2]).project(camera);
      out.x = (_v1.x * 0.5 + 0.5) * width;
      out.y = (-_v1.y * 0.5 + 0.5) * height;
      out.visible = _v1.z > -1 && _v1.z < 1;
      return out;
    }

    var _scrA = { x: 0, y: 0, visible: false };
    var _scrB = { x: 0, y: 0, visible: false };

    function placeLabel(el, scr, offset, offsetY) {
      if (!el) { return; }
      if (!scr.visible || scr.x < -80 || scr.x > width + 80 || scr.y < -40 || scr.y > height + 40) {
        el.style.display = 'none';
        return;
      }
      var x = clamp(scr.x + (offset || 14), 8, width - 150);
      var y = clamp(scr.y - 12 + (offsetY || 0), 8, height - 28);
      el.style.display = 'block';
      el.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    }

    function updateLabels() {
      var show = !sol.show || sol.show.names !== false;
      if (!labelsA || !labelsB) { return; }
      if (!show || !sim) {
        labelsA.style.display = 'none';
        labelsB.style.display = 'none';
        return;
      }
      var nameA = T('主星系', 'Main galaxy');
      var nameB = T('伴星系', 'Companion');
      if (labelsA.textContent !== nameA) { labelsA.textContent = nameA; }
      if (labelsB.textContent !== nameB) { labelsB.textContent = nameB; }
      projectToScreen(sim.cores[0].pos, _scrA);
      var close = false;
      if (sim.cores[1]) {
        projectToScreen(sim.cores[1].pos, _scrB);
        /* 两核靠近（穿心、并合期）时标签会挤在一起，上下错开 */
        close = _scrA.visible && _scrB.visible &&
          Math.abs(_scrA.x - _scrB.x) < 130 && Math.abs(_scrA.y - _scrB.y) < 50;
      }
      placeLabel(labelsA, _scrA, 14, close ? -14 : 0);
      if (sim.cores[1]) {
        placeLabel(labelsB, _scrB, 14, close ? 26 : 0);
      } else {
        labelsB.style.display = 'none';
      }
    }

    /* ------------------------------------------------------ 场景重建 */

    function buildParams() {
      var p = sol.params || {};
      return {
        ratio: p.ratio === 0.5 || p.ratio === 0.25 ? p.ratio : 1,
        approach: p.approach === 6 || p.approach === 20 ? p.approach : 9,
        spinA: p.spinA === -1 ? -1 : 1,
        spinB: p.spinB === -1 ? -1 : 1,
        leanA: p.leanA === 30 || p.leanA === 60 ? p.leanA : 0,
        leanB: p.leanB === 30 || p.leanB === 60 ? p.leanB : 0,
        count: isLow ? Math.round(STAR_CAP / 2) : STAR_CAP
      };
    }

    /* 总能量：兼容模型返回数字或 {kinetic,potential,total} 对象 */
    function totalEnergy() {
      if (!sim) { return 0; }
      var e = MODEL.energy(sim);
      if (e && typeof e.total === 'number') { return e.total; }
      return isFinite(e) ? +e : 0;
    }

    function rebuildSim() {
      MODEL = pickModel();
      var p = buildParams();
      sim = MODEL.buildScene(sol.scene, p);
      if (!sim || !sim.cores || !sim.stars) { sim = null; return; }
      starCount = Math.min(sim.stars.count, STAR_CAP);
      starGeo.setAttribute('position', new THREE.BufferAttribute(sim.stars.pos, 3));
      posAttr = starGeo.getAttribute('position');
      posAttr.setUsage(THREE.DynamicDrawUsage);
      starGeo.setDrawRange(0, starCount);
      writeBaseColors();
      refreshColors();
      baselineEnergy = (sim.meta && isFinite(sim.meta.baselineEnergy)) ? sim.meta.baselineEnergy : totalEnergy();
      resetHistory();
      buildCoreViews();
      updateLabels();
      hoverId = null;
      if (sol.stats) {
        sol.stats.count = starCount;
        sol.stats.coreDist = MODEL.coreDistance(sim);
        sol.stats.energyPct = 0;
      }
      lastScene = sol.scene;
      lastVer = sol.ver;
    }

    /* 切换场景 / 参数变化：重置到起点并预热重建 */
    function loadScene(id, silent) {
      var meta = null;
      var list = MODEL.sceneList ? MODEL.sceneList() : null;
      if (list && typeof list.length === 'number') {
        var i;
        for (i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === id) { meta = list[i]; break; }
        }
      }
      if (!meta) { id = 'collide'; }
      sol.scene = id;
      sol.myr = 0;
      sol.ver++;
      rebuildSim();
      if (meta && meta.camera) {
        var camOv = SCENE_CAM[id];
        sol.cam.yaw = camOv ? camOv.yaw : (+meta.camera.yaw || 0.6);
        sol.cam.pitch = clamp(camOv ? camOv.pitch : (+meta.camera.pitch || 0.9), PITCH_MIN, PITCH_MAX);
        sol.cam.dist = clamp(SCENE_FRAMING[id] || ((+meta.camera.dist || 120) * 0.85), DIST_MIN, DIST_MAX);
        camCur.yaw = sol.cam.yaw;
        camCur.pitch = sol.cam.pitch;
        camCur.dist = sol.cam.dist;
      }
      /* 场景可能改取景偏移（bullseye 右移更多），切换后立即生效 */
      applyViewShift(width, height);
      if (!silent) { emitReady(); }
    }

    function emitReady() {
      CO.emit('collision:ready', {
        scene: sol.scene,
        count: starCount,
        duration: (sim && sim.duration) || 0
      });
    }

    /* ------------------------------------------------------ 相机 */

    function syncCamFromState() {
      if (!sol.cam) { sol.cam = { yaw: 0.6, pitch: 0.9, dist: 120 }; }
      camCur.yaw = +sol.cam.yaw || 0;
      camCur.pitch = clamp(+sol.cam.pitch || 0.9, PITCH_MIN, PITCH_MAX);
      camCur.dist = clamp(+sol.cam.dist || 120, DIST_MIN, DIST_MAX);
    }

    function placeCamera() {
      var cp = Math.cos(camCur.pitch);
      camera.position.set(
        center.x + Math.sin(camCur.yaw) * cp * camCur.dist,
        center.y + Math.sin(camCur.pitch) * camCur.dist,
        center.z + Math.cos(camCur.yaw) * cp * camCur.dist
      );
      camera.lookAt(center);
      camera.updateMatrixWorld();
    }

    /* ------------------------------------------------------ 时间推进 tick */

    function emitTick() {
      if (!sim) { return; }
      var e = totalEnergy();
      var ePct = baselineEnergy ? ((e - baselineEnergy) / Math.abs(baselineEnergy)) * 100 : 0;
      tickPayload.myr = +(+sol.myr).toFixed(2);
      tickPayload.paused = !!sol.paused;
      tickPayload.speed = +sol.speed || 0;
      tickPayload.count = starCount;
      tickPayload.challenge = null;
      tickPayload.coreDist = +MODEL.coreDistance(sim).toFixed(2);
      tickPayload.energyPct = isFinite(ePct) ? +ePct.toFixed(2) : 0;
      if (sol.stats) {
        sol.stats.count = starCount;
        sol.stats.coreDist = tickPayload.coreDist;
        sol.stats.energyPct = tickPayload.energyPct;
      }
      if (sol.show && sol.show.velocity) { writeVelocityColors(); }
      CO.emit('collision:tick', tickPayload);
    }

    /* ------------------------------------------------------ 命令处理 */

    function validSceneId(id) {
      if (!id || typeof id !== 'string') { return false; }
      var list = MODEL.sceneList ? MODEL.sceneList() : null;
      if (list && typeof list.length === 'number') {
        var i;
        for (i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === id) { return true; }
        }
      }
      return id === 'collide' || id === 'custom' || id === 'passer' ||
        id === 'retrograde' || id === 'bullseye' || id === 'spiral';
    }

    function onCmd(msg) {
      if (!msg || typeof msg !== 'object') { return; }
      var t = msg.type;
      if (!t) { return; }

      if (t === 'scene') {
        if (validSceneId(msg.id)) {
          loadScene(msg.id, false);
          syncCamFromState();
        }
        return;
      }
      if (t === 'params') {
        if (msg.params && typeof msg.params === 'object') {
          var P = msg.params;
          if (P.ratio === 1 || P.ratio === 0.5 || P.ratio === 0.25) { sol.params.ratio = P.ratio; }
          if (P.approach === 6 || P.approach === 12 || P.approach === 20) { sol.params.approach = P.approach; }
          if (P.spinA === 1 || P.spinA === -1) { sol.params.spinA = P.spinA; }
          if (P.spinB === 1 || P.spinB === -1) { sol.params.spinB = P.spinB; }
          if (P.leanA === 0 || P.leanA === 30 || P.leanA === 60) { sol.params.leanA = P.leanA; }
          if (P.leanB === 0 || P.leanB === 30 || P.leanB === 60) { sol.params.leanB = P.leanB; }
          sol.myr = 0;
          sol.ver++;
          rebuildSim();
          emitTick();
        }
        return;
      }
      if (t === 'pause') { sol.paused = !sol.paused; emitTick(); return; }
      if (t === 'paused') { sol.paused = !!msg.paused; emitTick(); return; }
      if (t === 'speed') {
        var sp = parseFloat(msg.speed);
        if (isFinite(sp)) { sol.speed = clamp(sp, -4, 4); emitTick(); }
        return;
      }
      if (t === 'step') {
        var d1 = parseFloat(msg.deltaMyr != null ? msg.deltaMyr : msg.dir);
        if (!isFinite(d1)) { d1 = 1; }
        advanceDaysBy(d1);
        return;
      }
      if (t === 'deltaMyr') {
        var d2 = parseFloat(msg.deltaMyr);
        if (isFinite(d2)) { advanceDaysBy(d2); }
        return;
      }
      if (t === 'reset') { reset(); return; }
      if (t === 'show') {
        if (msg.show && typeof msg.show === 'object') {
          ['trails', 'velocity', 'names'].forEach(function (k) {
            if (typeof msg.show[k] === 'boolean') { sol.show[k] = msg.show[k]; }
          });
        }
        if (typeof msg.key === 'string' && typeof msg.on === 'boolean' &&
          (msg.key === 'trails' || msg.key === 'velocity' || msg.key === 'names')) {
          sol.show[msg.key] = msg.on;
        }
        refreshColors();
        syncGhost();
        updateLabels();
        emitTick();
        return;
      }
      if (t === 'camera') {
        if (msg.camera && typeof msg.camera === 'object') {
          if (isFinite(parseFloat(msg.camera.yaw))) { sol.cam.yaw = parseFloat(msg.camera.yaw); }
          if (isFinite(parseFloat(msg.camera.pitch))) { sol.cam.pitch = clamp(parseFloat(msg.camera.pitch), PITCH_MIN, PITCH_MAX); }
          if (isFinite(parseFloat(msg.camera.dist))) { sol.cam.dist = clamp(parseFloat(msg.camera.dist), DIST_MIN, DIST_MAX); }
        }
        syncCamFromState();
        return;
      }
      if (t === 'zoom') {
        var dir = parseFloat(msg.dir);
        var delta = parseFloat(msg.delta);
        if (isFinite(dir) && dir !== 0) {
          sol.cam.dist = clamp(sol.cam.dist * (dir > 0 ? 0.86 : 1.16), DIST_MIN, DIST_MAX);
        } else if (isFinite(delta)) {
          sol.cam.dist = clamp(sol.cam.dist * Math.exp(delta * 0.0012), DIST_MIN, DIST_MAX);
        }
        syncCamFromState();
        return;
      }
      if (t === 'shareReq') {
        CO.emit('collision:shareReq');
        return;
      }
      /* 未知类型静默忽略 */
    }

    /* 暂停下单步/倒放推进（不改变 paused 状态） */
    function advanceDaysBy(dMyr) {
      if (!sim) { return; }
      var total = sol.myr + dMyr;
      if (total < 0) { dMyr = -sol.myr; total = 0; }
      if (total > sim.duration) { dMyr = sim.duration - sol.myr; total = sim.duration; }
      if (dMyr) {
        MODEL.step(sim, dMyr);
        sol.myr = total;
      }
      emitTick();
    }

    /* ------------------------------------------------------ 相机输入 */

    function updateCameraInput(dt) {
      var inp = ctx.input;
      if (!inp) { return; }
      var keys = inp.keys || {};
      var k;

      if (inp.dragging && !inp.uiTarget) {
        var ddx = inp.dx || 0, ddy = inp.dy || 0;
        sol.cam.yaw -= ddx * 0.0042;
        sol.cam.pitch = clamp(sol.cam.pitch + ddy * 0.0032, PITCH_MIN, PITCH_MAX);
        vy = -ddx * 0.0042 / Math.max(dt, 0.001);
        vp = ddy * 0.0032 / Math.max(dt, 0.001);
        camCur.yaw = sol.cam.yaw;
        camCur.pitch = sol.cam.pitch;
      } else if (vy !== 0 || vp !== 0) {
        sol.cam.yaw += vy * dt;
        sol.cam.pitch = clamp(sol.cam.pitch + vp * dt, PITCH_MIN, PITCH_MAX);
        var k = Math.exp(-dt * 3.2);
        vy *= k; vp *= k;
        if (Math.abs(vy) < 1e-4) { vy = 0; }
        if (Math.abs(vp) < 1e-4) { vp = 0; }
      }

      if (inp.wheel) {
        sol.cam.dist = clamp(sol.cam.dist * Math.exp(inp.wheel * 0.0012), DIST_MIN, DIST_MAX);
      }
      if (inp.wheelCtrl) {
        sol.cam.dist = clamp(sol.cam.dist * (1 + inp.wheelCtrl * 0.0006), DIST_MIN, DIST_MAX);
      }
      if (inp.pinch) {
        sol.cam.dist = clamp(sol.cam.dist / (1 + inp.pinch * 0.6), DIST_MIN, DIST_MAX);
      }

      var rotSpeed = 0.9;
      if (keys['ArrowLeft'] || keys['a'] || keys['A']) { sol.cam.yaw += rotSpeed * dt; }
      if (keys['ArrowRight'] || keys['d'] || keys['D']) { sol.cam.yaw -= rotSpeed * dt; }
      if (keys['ArrowUp'] || keys['w'] || keys['W'] || keys['q'] || keys['Q']) {
        sol.cam.pitch = clamp(sol.cam.pitch + 0.55 * dt, PITCH_MIN, PITCH_MAX);
      }
      if (keys['ArrowDown'] || keys['s'] || keys['S'] || keys['e'] || keys['E']) {
        sol.cam.pitch = clamp(sol.cam.pitch - 0.55 * dt, PITCH_MIN, PITCH_MAX);
      }
      if (keys['+'] || keys['=']) { sol.cam.dist = clamp(sol.cam.dist * Math.exp(-dt * 1.8), DIST_MIN, DIST_MAX); }
      if (keys['-'] || keys['_']) { sol.cam.dist = clamp(sol.cam.dist * Math.exp(dt * 1.8), DIST_MIN, DIST_MAX); }
    }

    /* ------------------------------------------------------ update */

    function update(t, dt) {
      if (!started || !sim) { return; }
      dt = clamp(dt || 0.016, 0.001, 0.12);
      elapsed = t || (elapsed + dt);

      /* 外部（深链/UI）改了 scene/ver：下一帧重建（预热，不在交互中编译） */
      if (sol.ver !== lastVer || sol.scene !== lastScene) {
        rebuildSim();
        syncCamFromState();
      }

      /* 时间推进：模型 timeScale 决定 1 真实秒 = N Myr，speed 为倍率（可负） */
      if (!sol.paused && sol.speed) {
        var dMyr = dt * (sim.timeScale || 10) * sol.speed;
        var total = sol.myr + dMyr;
        if (total < 0) { dMyr = -sol.myr; total = 0; sol.paused = true; }
        if (total > sim.duration) { dMyr = sim.duration - sol.myr; total = sim.duration; sol.paused = true; }
        if (dMyr) {
          MODEL.step(sim, dMyr);
          sol.myr = total;
        }
      }

      /* 星星位置/颜色 */
      syncStars();
      /* 核位置 */
      var i, j, view, rec;
      for (i = 0; i < coreViews.length; i++) {
        view = coreViews[i];
        rec = view.rec;
        _v2.set(rec.pos[0], rec.pos[1], rec.pos[2]);
        for (j = 0; j < view.objects.length; j++) {
          view.objects[j].position.copy(_v2);
        }
      }
      /* 轨迹历史与 ghost */
      pushHistory();
      syncGhost();

      /* 相机输入与平滑 */
      updateCameraInput(dt);
      syncCamFromState();
      camCur.yaw = damp(camCur.yaw, sol.cam.yaw, CAM_LAMBDA, dt);
      camCur.pitch = clamp(damp(camCur.pitch, sol.cam.pitch, CAM_LAMBDA, dt), PITCH_MIN, PITCH_MAX);
      camCur.dist = damp(camCur.dist, sol.cam.dist, CAM_LAMBDA * 0.8, dt);
      centerTarget.set(0, 0, 0);
      if (sim.cores.length > 1) {
        _v3.set(
          (sim.cores[0].pos[0] + sim.cores[1].pos[0]) * 0.5,
          (sim.cores[0].pos[1] + sim.cores[1].pos[1]) * 0.5,
          (sim.cores[0].pos[2] + sim.cores[1].pos[2]) * 0.5
        );
        centerTarget.copy(_v3);
      }
      center.lerp(centerTarget, 1 - Math.exp(-dt * 2.4));
      placeCamera();
      updateCoreFade();

      /* 标签投影（每帧） */
      updateLabels();

      /* 8Hz 事件 */
      tickAcc += dt;
      if (tickAcc >= TICK) {
        tickAcc = 0;
        emitTick();
      }
    }

    /* ------------------------------------------------------ 生命周期 */

    var centerTarget = new THREE.Vector3();

    function resize(w, h) {
      width = w || width;
      height = h || height;
      aspect = width / Math.max(height, 1);
      if (U.fitCamera) {
        U.fitCamera(camera, 50, aspect);
      } else {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      applyViewShift(width, height);
      placeCamera();
    }

    function enter() {
      started = true;
      ensureLabels();
      applyViewShift(width, height);
      syncCamFromState();
      placeCamera();
      refreshColors();
      syncGhost();
      updateLabels();
      if (ctx.renderer && ctx.renderer.domElement) {
        ctx.renderer.domElement.style.cursor = 'grab';
      }
      emitReady();
    }

    function leave() {
      if (ctx.renderer && ctx.renderer.domElement) {
        ctx.renderer.domElement.style.cursor = '';
      }
      if (labelsA) { labelsA.style.display = 'none'; }
      if (labelsB) { labelsB.style.display = 'none'; }
    }

    /* 是否通过分享/深链进入（?c= / ?cscene=）：此时 state 里的 myr/cam 优先于默认相机 */
    function hasShareQuery() {
      try {
        if (typeof location === 'undefined' || !location.search) { return false; }
        var q = new URLSearchParams(location.search);
        return !!(q.get('c') || q.get('cscene'));
      } catch (e) {
        return false;
      }
    }

    var resetting = false;

    function reset() {
      if (resetting) { return; }
      resetting = true;
      sol.paused = true;
      sol.speed = 1;
      sol.myr = 0;
      sol.show = { trails: true, velocity: false, names: true };
      loadScene(sol.scene || 'collide', true);
      syncCamFromState();
      camCur.yaw = sol.cam.yaw;
      camCur.pitch = sol.cam.pitch;
      camCur.dist = sol.cam.dist;
      vy = 0; vp = 0;
      refreshColors();
      syncGhost();
      updateLabels();
      emitReady();
      emitTick();
      resetting = false;
    }

    function onCosmosReset() {
      /* boot 的 Esc 先调用 stage.reset() 再广播：已是复位态则不重复 */
      if (sol.myr === 0 && sol.paused) { return; }
      reset();
    }

    function dispose() {
      var i;
      for (i = 0; i < offList.length; i++) {
        if (typeof offList[i] === 'function') { offList[i](); }
      }
      offList = [];
      disposeCoreViews();
      disposeLabels();
      var j;
      for (j = 0; j < ghostLayers.length; j++) {
        ghostLayers[j].geo.dispose();
        ghostLayers[j].mat.dispose();
      }
      ghostLayers = [];
      starGeo.dispose();
      starMat.dispose();
      coreGeo.dispose();
      glowTex.dispose();
      if (scn) { scn.clear(); }
    }

    /* ------------------------------------------------------ 初始化 */

    ensureLabels();
    applyViewShift(width, height);
    syncCamFromState();
    camCur.yaw = sol.cam.yaw;
    camCur.pitch = sol.cam.pitch;
    camCur.dist = sol.cam.dist;
    if (hasShareQuery()) {
      /* 分享/深链恢复：按 state 重建模拟并快进到 state.myr，保留分享的相机与显示开关 */
      rebuildSim();
      syncCamFromState();
      camCur.yaw = sol.cam.yaw;
      camCur.pitch = sol.cam.pitch;
      camCur.dist = sol.cam.dist;
      if (sim && sol.myr > 0) { MODEL.step(sim, sol.myr); }
      syncStars();
    } else {
      loadScene(sol.scene || 'collide', true);
    }
    placeCamera();
    refreshColors();
    syncGhost();
    updateLabels();
    started = true;
    offList.push(CO.on('collision:cmd', onCmd));
    offList.push(CO.on('cosmos:reset', onCosmosReset));

    return {
      scene: scn,
      camera: camera,
      arrowKeys: true,
      handlesSpace: true,
      bloom: 0.85,
      update: update,
      resize: resize,
      enter: enter,
      leave: leave,
      reset: reset,
      dispose: dispose
    };
  });
})(window.COSMOS = window.COSMOS || {});
