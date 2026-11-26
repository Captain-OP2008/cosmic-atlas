/* ============================================================
 * COSMOS ATLAS · 06 章 星系碰撞 · 限制性 N 体物理内核
 * ------------------------------------------------------------
 * 纯计算、无场景层 / 无外部依赖 / 无网络：Toomre 1972 风格的限制性
 * N 体。两个大质量核互相牛顿引力（软化 1.2 kpc）；1.2 万颗无质量恒星只受两核
 * 引力、彼此不施力（限制性 N 体）。KDK leapfrog 积分，步长 0.2 Myr 量级，
 * 近核时按最近核距自适应缩短。
 *
 * 单位：kpc / Myr / M☉
 *   G = 4.5e-12 kpc³/(M☉·Myr²)
 *   1 kpc/Myr ≈ 977.8 km/s（对照：太阳绕银心约 220 km/s ≈ 0.225 kpc/Myr）
 *   主星系 A：1e11 M☉，盘半径 11 kpc，核软化长度 1.2 kpc
 *
 * 时间：默认 1 真实秒 = 10 Myr（独立螺旋场景 5 Myr/s）；速度档由 scene/UI 控制。
 * 场景定义见 SCENES；`buildScene(id, params, opts)` 返回可积分的 sim。
 *
 * sim 结构（契约 §3）：
 *   { id, params, cores:[{id,mass,pos:[x,y,z],vel:[...],radiusKpc}],
 *     stars:{count, pos:Float32Array(3n), vel:Float32Array(3n), owner:Uint8Array(n)},
 *     camera:{yaw,pitch,dist}, timeScale, duration, myr, meta:{baselineEnergy,...} }
 *   stars.owner 为附加信息：0 = 主星系恒星，1 = 伴星系恒星（换色/统计用）。
 *   camera：yaw 绕 +y 轴弧度，pitch 为相对盘面的仰角弧度，dist 单位 kpc。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var G = 4.5e-12;              /* kpc³ / (M☉·Myr²) */
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;
  var DEFAULT_COUNT = 12000;
  var M_A = 1e11;               /* 主星系质量 M☉ */
  var R_A = 11;                 /* 主星系盘半径 kpc */
  var EPS_CORE = 1.2;           /* 核软化长度 kpc（恒星受力同用此软化） */
  var EPS_STAR = EPS_CORE;
  var DT_MAX = 0.2;             /* 最大积分步长 Myr */
  var TAN_PITCH = Math.tan(20 * DEG); /* 对数螺旋臂 pitch 角 */
  var R_IN = 2.0;               /* 旋臂起始半径 kpc */
  var ARM_SCATTER = 0.20;       /* 旋臂角向散布 rad */

  /* ---------------- 小型数学工具 ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function copyPos(p) { return [p[0], p[1], p[2]]; }

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* mulberry32：确定性伪随机，保证同参数场景可复现 */
  function makeRng(seedStr) {
    var a = hashString(String(seedStr));
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Box-Muller 标准正态（rnd 用 1-u 避免 log(0)） */
  function gauss(rnd) {
    var u = 1 - rnd();
    var v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  /* 软化核势下的圆速度：恒星实际只感受核的点质量（软化 ε），
   * a = G·M·r/(r²+ε²)^{3/2} → v = sqrt(G·M·r²/(r²+ε²)^{3/2})。
   * r≫ε 时退化为开普勒 sqrt(GM/r)，r≪ε 时 v∝r（均匀核）。 */
  function circularSpeed(mass, r, eps) {
    var e2 = eps * eps;
    var r2 = Math.max(r * r, 1e-6);
    return Math.sqrt(G * mass * r2 / Math.pow(r2 + e2, 1.5));
  }

  /* ---------------- 场景定义 ---------------- */
  /* 固定场景的 params 同时是默认值；custom 的 params 由菜单给出。 */
  var SCENES = [
    {
      id: 'collide',
      name: '双旋碰撞',
      en: 'Two spirals collide',
      desc: '等质量双星系以 9 kpc 的最近距离顺行掠过，潮汐桥与尾在第一次近核后展开。',
      duration: 400,
      timeScale: 10,
      startPaused: false,
      camera: { yaw: 0.6, pitch: 0.9, dist: 120 },
      params: { ratio: 1, approach: 9, spinA: 1, spinB: 1, leanA: 0, leanB: 0 }
    },
    {
      id: 'custom',
      name: '自设碰撞',
      en: 'Set up your own',
      desc: '质量比、最近距离、自旋方向、盘倾角四个菜单自由组合，改动即从零重建。',
      duration: 400,
      timeScale: 10,
      startPaused: false,
      camera: { yaw: 0.6, pitch: 0.9, dist: 130 },
      params: { ratio: 1, approach: 12, spinA: 1, spinB: 1, leanA: 0, leanB: 0 },
      options: {
        ratio: [1, 0.5, 0.25],
        approach: [6, 12, 20],
        spinA: [1, -1],
        spinB: [1, -1],
        leanA: [0, 30, 60],
        leanB: [0, 30, 60]
      }
    },
    {
      id: 'passer',
      name: '小星系掠过',
      en: 'A small galaxy passes by',
      desc: '0.3 倍质量的小星系从 14 kpc 外顺行掠过，被拖出细长潮汐尾。',
      duration: 400,
      timeScale: 10,
      startPaused: false,
      camera: { yaw: 0.95, pitch: 0.7, dist: 130 },
      params: { ratio: 0.3, approach: 14, spinA: 1, spinB: 1, leanA: 0, leanB: 0 }
    },
    {
      id: 'retrograde',
      name: '逆向掠过',
      en: 'The same pass, against the spin',
      desc: '同一条路径、同一质量，只把伴星系自旋反向：逆向盘更难被潮汐撕开。',
      duration: 400,
      timeScale: 10,
      startPaused: false,
      camera: { yaw: 0.95, pitch: 0.7, dist: 130 },
      params: { ratio: 0.3, approach: 14, spinA: 1, spinB: -1, leanA: 0, leanB: 0 }
    },
    {
      id: 'bullseye',
      name: '穿心成环',
      en: 'A bullseye makes a ring',
      desc: '伴星系沿主星系盘面法线恒速穿心（偏心 0.5 kpc、0.45 kpc/Myr），径向冲量清空盘心并把恒星聚到 5–10 kpc 的环上：约 90 Myr 起可辨，盘心空旷、环峰清晰。',
      duration: 250,
      timeScale: 10,
      startPaused: false,
      camera: { yaw: 0.4, pitch: 1.35, dist: 105 },
      /* 等质量伴星：只有 ≈1:1 的穿心才能把 1–3 kpc 内盘清空（0.2–0.5 质量比
       * 只留下 ~1.5–2.5× 的密度起伏，形不成环，实测见 tools/galaxy-test.js 第 7 节）。 */
      params: { ratio: 1, approach: 0.5, spinA: 1, spinB: 1, leanA: 0, leanB: 0 },
      /* 直线穿越参数（只被 bullseye 分支读取）：
       * speed 为 +z 初始速度 kpc/Myr；impact 为盘面内偏心 kpc；z0 为起点离盘面距离。
       * A 核固定于原点、B 核以 prescribed 方式恒速运动（不做引力积分），故该场景
       * 的核能量不守恒，energy() 只统计自由核，UI 显示 0.00%。 */
      flyby: { speed: 0.45, impact: 0.5, z0: 30 }
    },
    {
      id: 'spiral',
      name: '螺旋缠绕',
      en: 'A spiral winds up',
      desc: '单星系独处，差动旋转把两条旋臂在几圈内越缠越紧，最终卷成细环。',
      duration: 400,
      timeScale: 5,
      startPaused: false,
      camera: { yaw: 0.5, pitch: 1.2, dist: 100 },
      params: { ratio: 1, approach: 0, spinA: 1, spinB: 1, leanA: 0, leanB: 0 }
    }
  ];

  function sceneById(id) {
    for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return SCENES[i];
    return null;
  }

  /* sceneList() → 全部场景；sceneList(id) → 单个场景定义；未知 id → null */
  function sceneList(id) {
    if (id === undefined || id === null) return SCENES.slice();
    var def = sceneById(id);
    return def ? def : null;
  }

  function nearest(allowed, v) {
    var best = allowed[0], bestD = Infinity;
    for (var i = 0; i < allowed.length; i++) {
      var d = Math.abs(Number(v) - allowed[i]);
      if (isFinite(d) && d < bestD) { bestD = d; best = allowed[i]; }
    }
    return best;
  }

  /* custom 菜单只允许离散档位；非法/缺省值一律回落到合法档位 */
  function normalizeCustom(params) {
    var p = params || {};
    return {
      ratio: nearest([1, 0.5, 0.25], p.ratio === undefined ? 1 : p.ratio),
      approach: nearest([6, 12, 20], p.approach === undefined ? 12 : p.approach),
      spinA: Number(p.spinA) < 0 ? -1 : 1,
      spinB: Number(p.spinB) < 0 ? -1 : 1,
      leanA: nearest([0, 30, 60], p.leanA === undefined ? 0 : p.leanA),
      leanB: nearest([0, 30, 60], p.leanB === undefined ? 0 : p.leanB)
    };
  }

  /* 初始两核轨道：无软化抛物线，近核距 = approach（软化解会让实际略大） */
  function orbitInit(MA, MB, approach) {
    var mu = G * (MA + MB);
    var q = Math.max(approach, 0.05);
    var d0 = q < 3 ? 30 : q + 36;      /* 起始分离 kpc */
    var h = Math.sqrt(mu * 2 * q);     /* 抛物线 p = 2q */
    var vy = h / d0;
    var vr = Math.sqrt(Math.max(0, 2 * mu / d0 - vy * vy));
    return {
      d0: d0,
      rel: [d0, 0, 0],
      vrel: [-vr, vy, 0]
    };
  }

  /* ---------------- 恒星盘生成 ---------------- */
  /* 把 count 颗无质量恒星写进 stars 的 [offset, offset+count) 区间。
   * rnd 序列只由盘的几何决定（不含自旋），因此 passer / retrograde 两场景
   * 除了速度方向之外逐位相同，便于做受控对照。 */
  function fillDisk(stars, offset, count, gal, corePos, coreVel, ownerId) {
    var pos = stars.pos, vel = stars.vel, own = stars.owner;
    var hR = gal.radius / 4;
    var lean = gal.leanDeg * DEG;
    var cosL = Math.cos(lean), sinL = Math.sin(lean);
    var rnd = gal.rnd;
    for (var j = 0; j < count; j++) {
      var idx = (offset + j) * 3;
      var r;
      do { r = -hR * Math.log(1 - rnd()); } while (r > gal.radius);
      if (r < 0.6) r = 0.6;

      var theta;
      if (rnd() < 0.14) {
        theta = rnd() * TAU;                       /* 场星 */
      } else {
        var arm = rnd() < 0.5 ? 0 : Math.PI;       /* 两条对数螺旋臂 */
        theta = arm + Math.log(r / R_IN) / TAN_PITCH + ARM_SCATTER * gauss(rnd);
        if (rnd() < 0.10) theta += 0.55 * gauss(rnd);  /* 结块噪声 */
      }

      var z = 0.30 * gauss(rnd);                   /* 薄盘厚度 */
      var dx = r * Math.cos(theta);
      var dy = r * Math.sin(theta);

      var vc = circularSpeed(gal.mass, r, EPS_CORE);
      var vx = -Math.sin(theta) * vc * gal.spin;
      var vy = Math.cos(theta) * vc * gal.spin;
      var dis = 0.02 * vc;
      vx += dis * gauss(rnd);
      vy += dis * gauss(rnd);
      var vz = 0.02 * vc * gauss(rnd);

      /* 绕 x 轴倾斜盘面（位置与速度同步旋转） */
      var py = dy * cosL - z * sinL;
      var pz = dy * sinL + z * cosL;
      var qy = vy * cosL - vz * sinL;
      var qz = vy * sinL + vz * cosL;

      pos[idx] = corePos[0] + dx;
      pos[idx + 1] = corePos[1] + py;
      pos[idx + 2] = corePos[2] + pz;
      vel[idx] = coreVel[0] + vx;
      vel[idx + 1] = coreVel[1] + qy;
      vel[idx + 2] = coreVel[2] + qz;
      own[offset + j] = ownerId;
    }
  }

  function makeSimShell(id, params, def, count) {
    return {
      id: id,
      params: params,
      cores: [],
      stars: {
        count: count,
        pos: new Float32Array(count * 3),
        vel: new Float32Array(count * 3),
        owner: new Uint8Array(count)
      },
      camera: { yaw: def.camera.yaw, pitch: def.camera.pitch, dist: def.camera.dist },
      timeScale: def.timeScale,
      duration: def.duration,
      myr: 0,
      meta: {
        baselineEnergy: 0,
        dtMax: DT_MAX,
        epsCore: EPS_CORE,
        epsStar: EPS_STAR,
        radiusA: R_A,
        radiusB: 0,
        countA: count,
        countB: 0,
        seed: ''
      }
    };
  }

  /* ---------------- 构建场景 ---------------- */
  function buildScene(id, params, opts) {
    var def = sceneById(id);
    if (!def) return null;

    var p = (def.id === 'custom') ? normalizeCustom(params) : {
      ratio: def.params.ratio,
      approach: def.params.approach,
      spinA: def.params.spinA,
      spinB: def.params.spinB,
      leanA: def.params.leanA,
      leanB: def.params.leanB
    };

    var count = DEFAULT_COUNT;
    if (opts && opts.count !== undefined) count = Number(opts.count);
    else if (params && params.count !== undefined) count = Number(params.count);
    count = clamp(Math.round(isFinite(count) ? count : DEFAULT_COUNT), 400, 24000);

    var ratio = (def.id === 'spiral') ? 1 : p.ratio;
    var MA = M_A;
    var MB = MA * ratio;
    var radiusB = (def.id === 'spiral') ? 0 : (ratio >= 1 ? 11 : (ratio >= 0.3 ? 9 : 8));
    var leanA = p.leanA;
    var leanB = p.leanB;

    /* 盘几何决定随机种子（刻意不含自旋：顺行/逆行对照组逐位同分布） */
    var seed = 'g|' + ratio + '|' + leanA + '|' + leanB + '|' + radiusB + '|' + R_A + '|' + count;
    var rnd = makeRng(seed);

    var sim = makeSimShell(id, p, def, count);
    sim.meta.radiusB = radiusB;
    sim.meta.seed = seed;

    if (def.id === 'spiral') {
      /* 单星系：核静止在原点，只有 A 盘 */
      sim.cores.push({ id: 'a', mass: MA, pos: [0, 0, 0], vel: [0, 0, 0], radiusKpc: EPS_CORE });
      fillDisk(sim.stars, 0, count,
        { mass: MA, radius: R_A, spin: p.spinA, leanDeg: leanA, rnd: rnd },
        sim.cores[0].pos, sim.cores[0].vel, 0);
      sim.meta.countA = count;
    } else if (def.id === 'bullseye') {
      /* 穿心成环：不用双质点抛物线（近核 1.9 kpc/Myr 的超快脉冲只会把盘炸散）。
       * A 核固定于原点、盘面 = x-y（法线 = +z）；小伴星系从 z = -z0 沿 +z 缓速
       * 直线穿心，径向冲量随半径缓变，盘面在 ~120 Myr 后聚成环。 */
      var fly = def.flyby || { speed: 0.25, impact: 0.5, z0: 22 };
      var impact = Math.abs(Number(fly.impact) || 0);
      var vz = Math.abs(Number(fly.speed) || 0.25);
      var z0 = Math.abs(Number(fly.z0) || 22);
      var posA = [0, 0, 0], velA = [0, 0, 0];
      var posB = [impact, 0, -z0], velB = [0, 0, vz];

      sim.cores.push({
        id: 'a', mass: MA, pos: posA, vel: velA,
        radiusKpc: EPS_CORE, fixed: true
      });
      sim.cores.push({
        id: 'b', mass: MB, pos: posB, vel: velB,
        radiusKpc: EPS_CORE * Math.pow(ratio, 1 / 3),
        prescribed: true            /* 恒速直线：不做引力积分（见 kickCores/drift） */
      });

      var nB2 = Math.round(count * ratio / (1 + ratio));
      var nA2 = count - nB2;
      fillDisk(sim.stars, 0, nA2,
        { mass: MA, radius: R_A, spin: p.spinA, leanDeg: leanA, rnd: rnd },
        posA, velA, 0);
      fillDisk(sim.stars, nA2, nB2,
        { mass: MB, radius: radiusB, spin: p.spinB, leanDeg: leanB, rnd: rnd },
        posB, velB, 1);
      sim.meta.countA = nA2;
      sim.meta.countB = nB2;
      sim.meta.flyby = { speed: vz, impact: impact, z0: z0 };
    } else {
      var orb = orbitInit(MA, MB, p.approach);
      var fA = MB / (MA + MB);
      var fB = MA / (MA + MB);
      var posA = [-fA * orb.rel[0], -fA * orb.rel[1], -fA * orb.rel[2]];
      var posB = [fB * orb.rel[0], fB * orb.rel[1], fB * orb.rel[2]];
      var velA = [-fA * orb.vrel[0], -fA * orb.vrel[1], -fA * orb.vrel[2]];
      var velB = [fB * orb.vrel[0], fB * orb.vrel[1], fB * orb.vrel[2]];

      sim.cores.push({ id: 'a', mass: MA, pos: posA, vel: velA, radiusKpc: EPS_CORE });
      sim.cores.push({
        id: 'b', mass: MB, pos: posB, vel: velB,
        radiusKpc: EPS_CORE * Math.pow(ratio, 1 / 3)
      });

      var nB = Math.round(count * ratio / (1 + ratio));
      var nA = count - nB;
      fillDisk(sim.stars, 0, nA,
        { mass: MA, radius: R_A, spin: p.spinA, leanDeg: leanA, rnd: rnd },
        posA, velA, 0);
      fillDisk(sim.stars, nA, nB,
        { mass: MB, radius: radiusB, spin: p.spinB, leanDeg: leanB, rnd: rnd },
        posB, velB, 1);
      sim.meta.countA = nA;
      sim.meta.countB = nB;
    }

    sim.meta.baselineEnergy = energy(sim);
    return sim;
  }

  /* ---------------- 加速度与积分（KDK leapfrog） ---------------- */
  /* 核间牛顿引力（软化 1.2 kpc）。`fixed: true` 的核（bullseye 的 A 核）不更新速度，
   * 只作为固定引力源；其余核按多体求和，n ≤ 2 时结果与两体公式一致。 */
  function kickCores(sim, hh) {
    var c = sim.cores, nc = c.length;
    if (nc < 2) return;
    for (var i = 0; i < nc; i++) {
      var ci = c[i];
      if (ci.fixed || ci.prescribed) continue;
      var ax = 0, ay = 0, az = 0;
      for (var j = 0; j < nc; j++) {
        if (j === i) continue;
        var cj = c[j];
        var dx = cj.pos[0] - ci.pos[0];
        var dy = cj.pos[1] - ci.pos[1];
        var dz = cj.pos[2] - ci.pos[2];
        var r2 = dx * dx + dy * dy + dz * dz + EPS_CORE * EPS_CORE;
        var inv = G * cj.mass / (r2 * Math.sqrt(r2));   /* G·m / (r²+ε²)^{3/2} */
        ax += dx * inv; ay += dy * inv; az += dz * inv;
      }
      ci.vel[0] += ax * hh; ci.vel[1] += ay * hh; ci.vel[2] += az * hh;
    }
  }

  function kickStars(sim, hh) {
    var c = sim.cores, nc = c.length;
    var stars = sim.stars;
    var pos = stars.pos, vel = stars.vel, n = stars.count;
    var x0 = c[0].pos[0], y0 = c[0].pos[1], z0 = c[0].pos[2];
    var gm0 = G * c[0].mass;
    var x1 = 0, y1 = 0, z1 = 0, gm1 = 0;
    if (nc > 1) {
      x1 = c[1].pos[0]; y1 = c[1].pos[1]; z1 = c[1].pos[2];
      gm1 = G * c[1].mass;
    }
    var eps2 = EPS_STAR * EPS_STAR;
    for (var i = 0; i < n; i++) {
      var k = i * 3;
      var px = pos[k], py = pos[k + 1], pz = pos[k + 2];
      var dx = px - x0, dy = py - y0, dz = pz - z0;
      var r2 = dx * dx + dy * dy + dz * dz + eps2;
      var inv = gm0 / (r2 * Math.sqrt(r2));
      var ax = -dx * inv, ay = -dy * inv, az = -dz * inv;
      if (nc > 1) {
        dx = px - x1; dy = py - y1; dz = pz - z1;
        r2 = dx * dx + dy * dy + dz * dz + eps2;
        inv = gm1 / (r2 * Math.sqrt(r2));
        ax -= dx * inv; ay -= dy * inv; az -= dz * inv;
      }
      vel[k] += ax * hh; vel[k + 1] += ay * hh; vel[k + 2] += az * hh;
    }
  }

  function drift(sim, h) {
    var c = sim.cores, i;
    for (i = 0; i < c.length; i++) {
      if (c[i].fixed) continue;
      c[i].pos[0] += c[i].vel[0] * h;
      c[i].pos[1] += c[i].vel[1] * h;
      c[i].pos[2] += c[i].vel[2] * h;
    }
    var pos = sim.stars.pos, vel = sim.stars.vel, n3 = sim.stars.count * 3;
    for (i = 0; i < n3; i++) pos[i] += vel[i] * h;
  }

  function substep(sim, h) {
    var half = h * 0.5;
    kickCores(sim, half);
    kickStars(sim, half);
    drift(sim, h);
    kickCores(sim, half);
    kickStars(sim, half);
  }

  /* step(sim, dtMyr)：原地推进，dt 可正可负（负 = 倒放）；返回 sim。
   * 每步按最近核距 clamp 子步长：dt = 0.2 · clamp(rMin/9, 0.35, 1) Myr。 */
  function step(sim, dtMyr) {
    if (!sim || !sim.cores || !sim.stars) return sim;
    var dt = Number(dtMyr);
    if (!isFinite(dt) || dt === 0) return sim;
    var remain = dt;
    var guard = 0;
    while (remain !== 0 && guard++ < 200000) {
      var rMin = coreDistance(sim);
      var scale = rMin > 0 ? clamp(rMin / 9, 0.35, 1) : 1;
      var hMax = sim.meta.dtMax * scale;
      var h = Math.abs(remain) < hMax ? remain : (dt > 0 ? hMax : -hMax);
      substep(sim, h);
      sim.myr += h;
      remain -= h;
      if (Math.abs(remain) < 1e-9) remain = 0;
    }
    return sim;
  }

  /* ---------------- 诊断量 ---------------- */
  function coreDistance(sim) {
    var c = sim && sim.cores;
    if (!c || c.length < 2) return 0;
    var dx = c[1].pos[0] - c[0].pos[0];
    var dy = c[1].pos[1] - c[0].pos[1];
    var dz = c[1].pos[2] - c[0].pos[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* 自由核（参与引力积分）的动能 + 势能，单位 M☉·kpc²/Myr²。
   * fixed / prescribed 核（bullseye 的 A、B 核）不受牛顿引力驱动，其动能与势能
   * 本来就不守恒，故不计入；本场景没有自由核，返回 0（UI 的 energyPct 于是为 0）。
   * 返回数值（与 scene 兜底模型口径一致）。
   * UI 的 "Energy change %" = (energy − meta.baselineEnergy)/|baselineEnergy|×100。 */
  function energy(sim) {
    var c = (sim && sim.cores) || [];
    var free = [], i, j, ke = 0, pe = 0;
    for (i = 0; i < c.length; i++) {
      if (c[i].fixed || c[i].prescribed) continue;
      free.push(c[i]);
    }
    for (i = 0; i < free.length; i++) {
      var m = free[i].mass, v = free[i].vel;
      ke += 0.5 * m * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    }
    for (i = 0; i < free.length; i++) {
      for (j = i + 1; j < free.length; j++) {
        var dx = free[j].pos[0] - free[i].pos[0];
        var dy = free[j].pos[1] - free[i].pos[1];
        var dz = free[j].pos[2] - free[i].pos[2];
        pe += -G * free[i].mass * free[j].mass /
          Math.sqrt(dx * dx + dy * dy + dz * dz + EPS_CORE * EPS_CORE);
      }
    }
    return ke + pe;
  }

  /* '123 Myr' / '1.2 Gyr'（负数保留符号，倒放时用） */
  function formatMyr(v) {
    var x = Number(v);
    if (!isFinite(x)) return '—';
    var sign = x < 0 ? '-' : '';
    var a = Math.abs(x);
    if (a >= 1000) return sign + (a / 1000).toFixed(1) + ' Gyr';
    return sign + Math.round(a) + ' Myr';
  }

  /* ---------------- 分享编码（与 boot.js 分享编码同格式） ---------------- */
  function b64urlEncode(str) {
    try {
      var b = (typeof btoa === 'function') ? btoa(unescape(encodeURIComponent(String(str)))) : '';
      return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return ''; }
  }

  function b64urlDecode(str) {
    try {
      var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return decodeURIComponent(escape(atob(s)));
    } catch (e) { return null; }
  }

  COSMOS.galaxyModel = {
    G: G,
    DEFAULT_COUNT: DEFAULT_COUNT,
    sceneList: sceneList,
    buildScene: buildScene,
    step: step,
    coreDistance: coreDistance,
    energy: energy,
    formatMyr: formatMyr,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode
  };
})(window.COSMOS = window.COSMOS || {});
