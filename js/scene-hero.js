/* ============================================================
 * COSMOS ATLAS · 序章「银河」(stage: hero) · v3 精细化
 * ------------------------------------------------------------
 * 视觉结构（由远及近 / 由虚到实）：
 *   0. 背景星野      COSMOS.builders.makeStarfield 9000 颗
 *   1. 近景星点      ~1500 颗细碎闪烁星尘（推进时产生视差）
 *   2. 银河弥散雾    大尺寸低亮度粒子 → 把旋臂连成连续的“乳白色银河带”
 *   3. 银河星点      核球（暖金，亮度梯度）+ 球状星团 + 4 条对数螺旋臂
 *                     （2 主 2 次，O/B/A/F 年轻蓝星为主）+ 薄/厚盘分层
 *   4. 尘埃带点云    沿旋臂内侧的暗红褐粒子（普通混合，压暗星点 → 暗缝）
 *   5. HII 区点云    旋臂上成团的粉红发射星云（电离氢区）
 *   6. 十字星芒      ~20 颗最亮一等星，独立 flare Points
 *   7. 气体 / 亮结   沿盘面辉光带 + 品红/青气云 + 大尺度暗尘埃云
 *
 * 关键设计：粒子分三个尺度
 *   - haze 层：size 1~4.2 世界单位、亮度 0.004~0.026，负责“连续发光”；
 *   - star 层：size 0.15~1.3 世界单位、亮度 0.02~1.0，负责“颗粒质感”；
 *   - dust/HII 层：尺寸 1~5 世界单位，负责“暗带”与“粉色发射区”的化学感。
 *   单层大粒子会糊成雾、单层小粒子会断成噪点，多层叠加才有银河感。
 *
 * 颜色来自恒星光谱型（3D 场景按物理着色，不套 UI 色板）：
 *   O/B (0.62,0.74,1.00) · A (0.80,0.88,1.00) · F (0.98,0.96,0.90)
 *   G (1.00,0.88,0.68) · K (1.00,0.72,0.46) · M (1.00,0.52,0.32)
 *   旋臂 = 年轻蓝星 + HII 粉红；臂间/核球 = G/K/M 老星。
 *
 * 构图：盘面滚转 15°（右端抬高）、倾斜 22.5°，亮核锚定视口
 *       (0.635, 0.435) 偏右上；左 42% 留给大标题，粒子亮度在左侧自动
 *       衰减（TUNE.leftFade），保证文字区通透。
 * 镜头：p 只做入场推镜（v3：约 2 秒内 0.10→0.86），之后稳定在航拍位。
 *       intro 自带 3 秒缓推；拖拽 yaw/pitch 全向环绕、松手惯性、双指/滚轮缩放；
 *       指针视差；点击核球俯冲 → overview。
 *
 * 亮度标定（重要）：后处理走 ACES + sRGB，线性 0.1 已显示为 ~39% 灰，
 * 因此银河“暗部粒子”必须压到 0.01~0.05，亮结 0.1~0.5，只有核球与
 * 一等星可以 > 1.0 走 HDR 泛光。集中调参见文件顶部 TUNE 对象。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  const U = COSMOS.util;
  const DEG = Math.PI / 180;

  /* ===================== 集中调参（改这里即可整体调节） ===================== */
  const TUNE = {
    bulgeGain: 1.30,     // 核球星点亮度
    armGain: 2.35,       // 旋臂星点亮度
    diskGain: 1.10,      // 盘面弥散星点亮度
    clusterGain: 1.90,   // 球状星团亮度
    hazeGain: 2.05,      // 银河弥散雾亮度（决定"银河带"是否连续）
    flareGain: 1.12,     // 十字星芒亮度
    coreHaze: 1.15,      // 核心光晕强度
    bandGain: 1.45,      // 盘面辉光带强度
    gasGain: 0.95,       // 品红/青气云强度
    dustGain: 1.15,      // 暗尘埃带强度（sprite 层）
    dustLaneGain: 0.85,  // 尘埃点云强度
    hiiGain: 1.00,       // HII 区点云强度
    knotGain: 1.05,      // 旋臂亮结（星团光斑）强度
    leftFade: 0.46       // 画面左侧亮度保留比例（越小文字区越干净）
  };

  /* ===================== 私有工具 ===================== */

  let _gaussSpare = null;
  function gauss() {
    if (_gaussSpare !== null) { const v = _gaussSpare; _gaussSpare = null; return v; }
    let u = 0, v = 0, s = 0;
    do {
      u = U.rand() * 2 - 1;
      v = U.rand() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    _gaussSpare = v * m;
    return u * m;
  }

  const _mixbuf = [0, 0, 0];
  function mix3(a, b, t) {
    _mixbuf[0] = a[0] + (b[0] - a[0]) * t;
    _mixbuf[1] = a[1] + (b[1] - a[1]) * t;
    _mixbuf[2] = a[2] + (b[2] - a[2]) * t;
    return _mixbuf;
  }

  /* 恒星光谱型颜色（线性空间，未乘亮度；见文件头注释） */
  const C_OBAF = [
    [0.62, 0.74, 1.00],   // O/B 蓝白
    [0.80, 0.88, 1.00],   // A
    [0.98, 0.96, 0.90],   // F
    [1.00, 0.88, 0.68],   // G
    [1.00, 0.72, 0.46],   // K
    [1.00, 0.52, 0.32],   // M
    [1.00, 0.44, 0.56]    // HII 粉红（电离氢区）
  ];
  const C_HII = [1.00, 0.43, 0.55];
  const C_HII_PURPLE = [0.88, 0.42, 0.82];
  const C_DUST_LANE = [0.155, 0.072, 0.040];

  /* 旋臂上年轻星：O/B/A/F 为主，少量 G/K 与 HII */
  function pickYoungColor() {
    const r = U.rand();
    if (r < 0.30) return C_OBAF[0];
    if (r < 0.57) return C_OBAF[1];
    if (r < 0.80) return C_OBAF[2];
    if (r < 0.92) return C_OBAF[3];
    return C_OBAF[4];
  }

  /* 盘面/核球老星：G/K/M 为主，少量 A/F */
  function pickOldColor() {
    const r = U.rand();
    if (r < 0.30) return C_OBAF[3];
    if (r < 0.66) return C_OBAF[4];
    if (r < 0.86) return C_OBAF[5];
    if (r < 0.94) return C_OBAF[2];
    return C_OBAF[1];
  }

  /* 暗尘埃纹理：椭圆径向渐变（四周边界 alpha 严格为 0）+ 内部细纤维起伏。*/
  function dustTexture(size, strands) {
    return COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      // 1) 纤维（横向蜿蜒的亮线，稍后整体乘遮罩）
      g.globalCompositeOperation = 'lighter';
      for (let s = 0; s < strands; s++) {
        const y0 = h * (0.40 + U.rand() * 0.20);
        const thick = h * (0.006 + U.rand() * 0.014);
        const amp = h * (0.012 + U.rand() * 0.040);
        const freq = 1.0 + U.rand() * 2.4;
        const ph = U.rand() * Math.PI * 2;
        const a0 = 0.10 + U.rand() * 0.16;
        const step = w * 0.008;
        for (let x = 0; x <= w; x += step) {
          const t = x / w;
          const fade = Math.pow(Math.sin(Math.PI * t), 0.8);
          if (fade <= 0.001) continue;
          const y = y0
            + Math.sin(t * Math.PI * 2.0 * freq + ph) * amp
            + Math.sin(t * Math.PI * 2.0 * (freq * 2.7) + ph * 1.7) * amp * 0.35;
          const rr = thick * (0.75 + U.rand() * 0.7);
          const aa = a0 * fade;
          const grd = g.createRadialGradient(x, y, 0, x, y, rr);
          grd.addColorStop(0, 'rgba(255,255,255,' + aa.toFixed(4) + ')');
          grd.addColorStop(0.55, 'rgba(255,255,255,' + (aa * 0.35).toFixed(4) + ')');
          grd.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grd;
          g.beginPath();
          g.arc(x, y, rr, 0, Math.PI * 2);
          g.fill();
        }
      }
      // 2) 椭圆径向遮罩（像素级严格归零）
      g.globalCompositeOperation = 'destination-in';
      const grd = g.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.5);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.45, 'rgba(255,255,255,0.88)');
      grd.addColorStop(0.75, 'rgba(255,255,255,0.42)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.save();
      g.translate(w * 0.5, h * 0.5);
      g.scale(1, 0.34);
      g.translate(-w * 0.5, -h * 0.5);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.restore();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,1)';
      g.fillRect(0, 0, w, 3);
      g.fillRect(0, h - 3, w, 3);
      g.fillRect(0, 0, 3, h);
      g.fillRect(w - 3, 0, 3, h);
      g.globalCompositeOperation = 'source-over';
    });
  }

  /* 柔和气体纹理：用大量「远小于整张贴图」的小气团叠加，再乘椭圆渐隐遮罩。*/
  function softCloudTexture(size) {
    return COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const n = 150;
      for (let i = 0; i < n; i++) {
        const a = U.rand() * Math.PI * 2;
        const rad = Math.pow(U.rand(), 0.55) * w * 0.40;
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad * 0.88;
        const r = w * (0.030 + U.rand() * 0.060);
        const amp = 0.055 + U.rand() * 0.130;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,' + amp.toFixed(4) + ')');
        grd.addColorStop(0.5, 'rgba(255,255,255,' + (amp * 0.42).toFixed(4) + ')');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'destination-in';
      const mask = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      mask.addColorStop(0, 'rgba(255,255,255,1)');
      mask.addColorStop(0.52, 'rgba(255,255,255,0.94)');
      mask.addColorStop(0.80, 'rgba(255,255,255,0.30)');
      mask.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = mask;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    });
  }

  /* ===================== 构图常量 ===================== */

  const FOV = 34;
  const GAL_R = 275;                    // 盘半径
  const TILT = 22.5 * DEG;              // 盘面倾斜（决定银河带的“厚度”）
  const ROLL = 15 * DEG;                // 画面内滚转（右端抬高）
  const COS_T = Math.cos(TILT), SIN_T = Math.sin(TILT);
  const COS_R = Math.cos(ROLL), SIN_R = Math.sin(ROLL);
  const CORE_SX = 0.635, CORE_SY = 0.435;

  const TAN_HALF = Math.tan(FOV * 0.5 * DEG);
  const HALF_W = 279;
  const REF_ASPECT = 1.78;
  const HALF_H_REF = HALF_W / REF_ASPECT;
  const CAM_DIST0 = HALF_W / (TAN_HALF * REF_ASPECT);
  const CORE_WX0 = (CORE_SX - 0.5) * 2 * HALF_W;
  const CORE_WY0 = (0.5 - CORE_SY) * 2 * HALF_H_REF;

  // 屏幕归一化坐标 → 以核心为原点的局部坐标（y 向上为正）
  function screenToLocalX(sx, z) {
    const depth = CAM_DIST0 - z;
    return (sx - 0.5) * 2 * TAN_HALF * depth * REF_ASPECT - CORE_WX0;
  }
  function screenToLocalY(sy, z) {
    const depth = CAM_DIST0 - z;
    return (0.5 - sy) * 2 * TAN_HALF * depth - CORE_WY0;
  }

  /* ===================== 场景 ===================== */

  COSMOS.registerStage('hero', function (ctx) {
    const quality = ctx.quality || 'high';
    const isLow = quality === 'low';
    const isMed = quality === 'medium';

    U.reseed(0xC05A05);

    const scene = new THREE.Scene();
    const camera = U.makeCamera(FOV, ctx.aspect);
    const pixelRatio = Math.min(ctx.pixelRatio || window.devicePixelRatio || 1, 2);

    /* ---------- 画质档位（high 合计 23.6 万粒子，low 约一半） ---------- */
    const N_BULGE = isLow ? 17000 : (isMed ? 27000 : 42000);
    const N_ARM = isLow ? 44000 : (isMed ? 69000 : 104000);
    const N_DISK = isLow ? 7000 : (isMed ? 11000 : 16000);
    const N_GLOB = isLow ? 1200 : (isMed ? 2000 : 3000);
    const N_HAZE = isLow ? 18000 : (isMed ? 30000 : 42000);
    const N_DUST = isLow ? 6000 : (isMed ? 9500 : 14000);
    const N_HII = isLow ? 1800 : (isMed ? 2800 : 4200);
    const N_GAL = N_BULGE + N_ARM + N_DISK + N_GLOB;
    const N_FLARE = isLow ? 10 : (isMed ? 14 : 20);
    const N_NEAR = isLow ? 700 : (isMed ? 1100 : 1500);
    const N_BG = isLow ? 5000 : (isMed ? 7000 : 9000);

    /* ============================================================
     * 1. 银河星点层（核球 + 旋臂 + 盘 + 球状星团）
     * ============================================================ */
    const gPos = new Float32Array(N_GAL * 3);
    const gCol = new Float32Array(N_GAL * 3);
    const gSize = new Float32Array(N_GAL);
    const gSeed = new Float32Array(N_GAL);
    let gi = 0;

    function pushDisk(x, y, z, r, g, b, size) {
      if (gi >= N_GAL) return;
      const ty = y * COS_T - z * SIN_T;
      const tz = y * SIN_T + z * COS_T;
      const i3 = gi * 3;
      gPos[i3] = x * COS_R - ty * SIN_R;
      gPos[i3 + 1] = x * SIN_R + ty * COS_R;
      gPos[i3 + 2] = tz;
      gCol[i3] = r; gCol[i3 + 1] = g; gCol[i3 + 2] = b;
      gSize[gi] = size;
      gSeed[gi] = U.rand();
      gi++;
    }

    /* ---------- 旋臂参数：2 条主臂 + 2 条次级臂 ---------- */
    const RB = 64;                        // 核球半径
    const R_IN = GAL_R * 0.075;
    const TAN_PITCH = Math.tan(13.6 * DEG);
    const ARMS = [
      { phase: 0.0, main: true, i: 0 },
      { phase: Math.PI, main: true, i: 1 },
      { phase: Math.PI * 0.52 + 0.36, main: false, i: 2 },
      { phase: Math.PI * 1.52 + 0.36, main: false, i: 3 }
    ];
    function pickArm() {
      const r = U.rand();
      if (r < 0.40) return ARMS[0];
      if (r < 0.80) return ARMS[1];
      if (r < 0.90) return ARMS[2];
      return ARMS[3];
    }

    /* 盘面坐标 (x,y,z) → 屏幕归一化坐标 [sx, sy] 与视深 tz */
    function diskToScreen(xd, yd, zd) {
      const ty = yd * COS_T - zd * SIN_T;
      const tz = yd * SIN_T + zd * COS_T;
      const lx = xd * COS_R - ty * SIN_R;
      const ly = xd * SIN_R + ty * COS_R;
      const depth = CAM_DIST0 - tz;
      return [
        0.5 + (lx + CORE_WX0) / (2 * TAN_HALF * depth * REF_ASPECT),
        0.5 - (ly + CORE_WY0) / (2 * TAN_HALF * depth),
        tz
      ];
    }

    /* ---------- 1a. 核球：中心密度骤增 + 亮度梯度（内白黄 → 外橙红） ---------- */
    for (let i = 0; i < N_BULGE; i++) {
      const rr = RB * Math.pow(U.rand(), 1.55);
      const th = U.rand() * Math.PI * 2;
      const xd = Math.cos(th) * rr;
      const zd = Math.sin(th) * rr;
      // 扁球：中心薄、外缘略厚
      const yd = gauss() * (1.5 + rr * 0.30);

      const hot = U.clamp(1 - rr / RB, 0, 1);
      const hot2 = hot * hot;
      // 核球梯度：内 0.25 白黄、0.25–0.6 金黄、外橙红
      let col;
      if (rr < RB * 0.25) col = mix3(C_OBAF[2], C_OBAF[3], rr / (RB * 0.25));
      else if (rr < RB * 0.62) col = mix3(C_OBAF[3], C_OBAF[4], (rr - RB * 0.25) / (RB * 0.37));
      else col = mix3(C_OBAF[4], C_OBAF[5], Math.min(1, (rr - RB * 0.62) / (RB * 0.38)));

      // 少量红巨星：大尺寸、偏红、偏亮（核球里真实存在）
      let b = (0.060 + Math.pow(U.rand(), 2.15) * 0.58 + hot2 * 2.05) * TUNE.bulgeGain;
      let size = 0.20 + Math.pow(U.rand(), 3.0) * 0.68 + hot2 * 0.18;
      if (U.rand() < 0.045) {
        col = C_OBAF[5];
        b *= 1.55;
        size *= 1.9;
      } else if (U.rand() < 0.02) {
        col = C_OBAF[0];
        b *= 1.25;
      }
      pushDisk(xd, yd, zd, col[0] * b, col[1] * b, col[2] * b, size);
    }

    /* ---------- 1b. 对数螺旋旋臂（密度波：主臂密、次臂疏、臂间桥） ---------- */
    for (let i = 0; i < N_ARM; i++) {
      const arm = pickArm();
      // 半径分布：外圈面积更大，但内圈更亮
      const rr0 = R_IN + (GAL_R * 0.99 - R_IN) * Math.pow(U.rand(), 0.62);
      const t = U.clamp((rr0 - R_IN) / (GAL_R - R_IN), 0, 1);
      // 臂宽：内窄外宽；主臂比次臂宽 1.35×
      const wBase = 0.040 + 0.088 * t;
      const width = wBase * (arm.main ? 1.28 : 0.68);
      // 对数螺旋 + 轻微摆动（真实旋臂不是完美曲线）
      const theta0 = arm.phase + Math.log(Math.max(rr0, R_IN) / R_IN) / TAN_PITCH
        + 0.022 * Math.sin(rr0 * 0.024 + arm.i * 2.13);
      // 约 17% 的粒子作为“臂间桥/羽状分支”，让旋臂不呆板
      let th, yd, onArm;
      if (U.rand() < 0.17) {
        // 臂间：偏向两臂之间的区域，形成连接的桥
        th = theta0 + Math.PI * 0.52 + gauss() * 0.24;
        yd = gauss() * (2.2 + rr0 * 0.026);
        onArm = false;
      } else {
        th = theta0 + gauss() * width;
        yd = gauss() * (1.25 + rr0 * 0.014 * (arm.main ? 1.0 : 1.5));
        onArm = true;
      }
      const rr = rr0 + gauss() * (1.8 + rr0 * 0.010);
      // 盘面翘曲（外盘抬起一点）
      const warp = Math.pow(Math.max(0, rr / GAL_R - 0.58) / 0.42, 2) * 8 * Math.sin(th * 1.7 + arm.i * 1.9);
      const xd = Math.cos(th) * rr;
      const zd = Math.sin(th) * rr;

      // 颜色：年轻蓝星为主；次臂/臂间混入老星
      let col;
      let young;
      if (onArm) {
        const r = U.rand();
        if (r < (arm.main ? 0.075 : 0.045)) { col = C_HII; young = true; }
        else if (r < (arm.main ? 0.86 : 0.66)) { col = pickYoungColor(); young = true; }
        else { col = pickOldColor(); young = false; }
      } else {
        const r = U.rand();
        if (r < 0.22) { col = pickYoungColor(); young = true; }
        else { col = pickOldColor(); young = false; }
      }

      // 亮度：年轻星更亮、尺寸更小（O/B 星少而亮）；沿臂有密度波明暗团块
      const armMod = 0.78 + 0.42 * Math.sin((rr / GAL_R) * Math.PI * 6.0 + arm.i * 1.7);
      let b = (0.016 + Math.pow(U.rand(), 2.55) * 0.30) * armMod;
      if (young) b *= 1.45;
      const knot = U.rand();
      if (knot < 0.012) {               // 年轻亮星结
        b *= 4.6;
      } else if (knot < 0.060) {
        b *= 1.9;
      }
      b *= (1.0 + 0.42 * (1 - t)) * TUNE.armGain;
      const size = young
        ? 0.16 + Math.pow(U.rand(), 3.2) * 0.52
        : 0.26 + Math.pow(U.rand(), 2.4) * 0.95;

      pushDisk(xd, yd + warp, zd, col[0] * b, col[1] * b, col[2] * b, size);
    }

    /* ---------- 1c. 盘面：薄盘（年轻蓝星）+ 厚盘（老星）两层 ---------- */
    for (let i = 0; i < N_DISK; i++) {
      const rr = 12 + (GAL_R * 0.975 - 12) * Math.pow(U.rand(), 0.70);
      const th = U.rand() * Math.PI * 2;
      const t = U.clamp(rr / GAL_R, 0, 1);
      const youngDisk = U.rand() < 0.20;      // 薄盘：z 薄、蓝白
      const yd = youngDisk
        ? gauss() * (0.75 + rr * 0.005)
        : gauss() * (2.35 + rr * 0.030);
      const col = youngDisk ? pickYoungColor() : pickOldColor();
      let b = (0.009 + Math.pow(U.rand(), 2.2) * 0.080) * TUNE.diskGain;
      if (youngDisk) b *= 1.30;
      const size = youngDisk
        ? 0.16 + Math.pow(U.rand(), 3.0) * 0.55
        : 0.24 + Math.pow(U.rand(), 2.6) * 0.85;
      pushDisk(Math.cos(th) * rr, yd, Math.sin(th) * rr,
        col[0] * b, col[1] * b, col[2] * b, size);
    }

    /* ---------- 1d. 球状星团：核球晕 + 银晕里的紧凑亮团 ---------- */
    const N_GLOB_CLUSTER = isLow ? 36 : (isMed ? 64 : 92);
    let globLeft = N_GLOB;
    for (let c = 0; c < N_GLOB_CLUSTER && globLeft > 0; c++) {
      const n = Math.min(globLeft, 12 + Math.floor(U.rand() * 30));
      globLeft -= n;
      const halo = U.rand() < 0.52;
      let cx, cy, cz;
      if (halo) {
        // 银晕：各向同性球分布，半径延伸到 1.9 R
        const rr = RB * 1.30 + Math.pow(U.rand(), 0.62) * (GAL_R * 1.85 - RB * 1.30);
        const th = U.rand() * Math.PI * 2;
        const ph = Math.acos(2 * U.rand() - 1);
        cx = Math.sin(ph) * Math.cos(th) * rr;
        cy = Math.cos(ph) * rr * 0.78;
        cz = Math.sin(ph) * Math.sin(th) * rr;
      } else {
        // 核球区：更密集
        const rr = Math.pow(U.rand(), 1.35) * RB * 1.22;
        const th = U.rand() * Math.PI * 2;
        cx = Math.cos(th) * rr;
        cz = Math.sin(th) * rr;
        cy = gauss() * (2.0 + rr * 0.18);
      }
      const spread = 0.9 + U.rand() * 1.9;
      const warm = U.rand() < 0.72;
      const cr = warm ? 1.00 : 0.86;
      const cg = warm ? 0.87 : 0.90;
      const cb = warm ? 0.68 : 1.00;
      for (let k = 0; k < n; k++) {
        const dx = gauss() * spread;
        const dy = gauss() * spread * 0.82;
        const dz = gauss() * spread;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(spread * 2.2, 0.5);
        const b = (0.42 + Math.pow(U.rand(), 1.4) * 1.55 + (1 - Math.min(1, dist)) * 0.85) * TUNE.clusterGain;
        pushDisk(cx + dx, cy + dy, cz + dz,
          cr * b, cg * b, cb * b, 0.09 + U.rand() * 0.26);
      }
    }
    // 兜底：余下点数补到核球外缘
    while (globLeft > 0) {
      globLeft--;
      const rr = RB * (1.1 + U.rand() * 0.9);
      const th = U.rand() * Math.PI * 2;
      const b = 0.45 + U.rand() * 0.9;
      pushDisk(Math.cos(th) * rr, gauss() * 2.5, Math.sin(th) * rr,
        0.95 * b, 0.86 * b, 0.72 * b, 0.10 + U.rand() * 0.22);
    }

    const galaxyGeo = new THREE.BufferGeometry();
    galaxyGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
    galaxyGeo.setAttribute('aColor', new THREE.BufferAttribute(gCol, 3));
    galaxyGeo.setAttribute('aSize', new THREE.BufferAttribute(gSize, 1));
    galaxyGeo.setAttribute('aSeed', new THREE.BufferAttribute(gSeed, 1));
    galaxyGeo.setDrawRange(0, gi);

    const galaxyUniforms = { uTime: { value: 0 }, uPxScale: { value: 1080 / (2 * TAN_HALF) } };

    const galaxyMat = new THREE.ShaderMaterial({
      uniforms: galaxyUniforms,
      vertexShader: COSMOS.GLSL.noise + `
        uniform float uTime;
        uniform float uPxScale;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 1.0);

          // 大尺度明暗起伏：旋臂上的亮结与暗隙
          float n = snoise(vec3(position.x, position.z, position.y * 5.0) * 0.0060);
          float patchiness = 0.42 + 0.95 * n;
          patchiness = max(patchiness, 0.12);

          // 核球额外提亮（局部坐标以核心为原点）
          float rad = length(position);
          float coreBoost = 1.0 + 1.15 * exp(-rad * 0.028);
          // 盘边缘平滑渐隐（避免出现弧形硬切边）
          float diskFade = 1.0 - smoothstep(0.70, 1.04, rad / ${GAL_R.toFixed(1)});

          // 左侧通透：给大标题留出干净的暗背景
          float lateral = 1.0 - (1.0 - ${TUNE.leftFade.toFixed(2)}) * (1.0 - smoothstep(-460.0, -110.0, position.x));

          // 极缓慢闪烁
          float tw = 0.90 + 0.10 * sin(uTime * (0.6 + aSeed * 0.9) + aSeed * 63.0);

          vColor = aColor * (patchiness * coreBoost * diskFade * lateral * tw);
          float px = aSize * uPxScale / depth;
          gl_PointSize = clamp(px, 1.0, 14.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = 1.0 - smoothstep(0.0, 1.0, d);
          a *= a;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });

    const galaxyPoints = new THREE.Points(galaxyGeo, galaxyMat);
    galaxyPoints.frustumCulled = false;
    galaxyPoints.renderOrder = 2;

    /* ============================================================
     * 2. 银河弥散雾层（大而暗，把旋臂连成连续的银河带）
     * ============================================================ */
    const hPos = new Float32Array(N_HAZE * 3);
    const hCol = new Float32Array(N_HAZE * 3);
    const hSize = new Float32Array(N_HAZE);
    const hSeed = new Float32Array(N_HAZE);

    for (let i = 0; i < N_HAZE; i++) {
      let xd, yd, zd, rr;
      if (U.rand() < 0.64) {
        // 沿旋臂（比星点层宽 2.6 倍，形成连续的“光带”）
        const arm = pickArm();
        rr = R_IN * 0.5 + (GAL_R * 1.04 - R_IN * 0.5) * Math.pow(U.rand(), 0.62);
        const theta0 = arm.phase + Math.log(Math.max(rr, R_IN * 0.5) / R_IN) / TAN_PITCH;
        const width = (9.0 + rr * 0.105) * (arm.main ? 1.15 : 0.8);
        const rr2 = rr + gauss() * width * 0.5;
        const th = theta0
          + gauss() * (width / Math.max(rr2, 16)) * 0.90
          + 0.06 * Math.sin(rr2 * 0.028 + arm.i * 2.13);
        xd = Math.cos(th) * rr2;
        zd = Math.sin(th) * rr2;
        yd = gauss() * (3.2 + rr2 * 0.028);
      } else {
        // 盘面弥散
        rr = 8 + (GAL_R * 0.98 - 8) * Math.pow(U.rand(), 0.72);
        const th = U.rand() * Math.PI * 2;
        xd = Math.cos(th) * rr;
        zd = Math.sin(th) * rr;
        yd = gauss() * (4.0 + rr * 0.030);
      }
      const ty = yd * COS_T - zd * SIN_T;
      const tz = yd * SIN_T + zd * COS_T;
      hPos[i * 3] = xd * COS_R - ty * SIN_R;
      hPos[i * 3 + 1] = xd * SIN_R + ty * COS_R;
      hPos[i * 3 + 2] = tz;

      const t = U.clamp(rr / GAL_R, 0, 1);
      const col = t < 0.28
        ? mix3([1.00, 0.80, 0.55], [0.62, 0.76, 1.00], U.smoothstep(0, 0.28, t))
        : mix3([0.62, 0.76, 1.00], [0.48, 0.30, 1.00], U.smoothstep(0.28, 1.0, t));
      const coreB = 1.0 + 1.35 * Math.exp(-rr * 0.030);
      const edgeFade = 1.0 - 0.50 * U.smoothstep(0.68, 1.04, rr / GAL_R);
      const b = (0.0048 + Math.pow(U.rand(), 2.3) * 0.0230) * coreB * edgeFade * TUNE.hazeGain;
      hCol[i * 3] = col[0] * b;
      hCol[i * 3 + 1] = col[1] * b;
      hCol[i * 3 + 2] = col[2] * b;
      hSize[i] = 1.0 + Math.pow(U.rand(), 2.0) * 3.4;
      hSeed[i] = U.rand();
    }

    const hazeGeo = new THREE.BufferGeometry();
    hazeGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
    hazeGeo.setAttribute('aColor', new THREE.BufferAttribute(hCol, 3));
    hazeGeo.setAttribute('aSize', new THREE.BufferAttribute(hSize, 1));
    hazeGeo.setAttribute('aSeed', new THREE.BufferAttribute(hSeed, 1));

    const hazeUniforms = { uTime: { value: 0 }, uPxScale: { value: 1080 / (2 * TAN_HALF) } };

    const hazeMat = new THREE.ShaderMaterial({
      uniforms: hazeUniforms,
      vertexShader: COSMOS.GLSL.noise + `
        uniform float uTime;
        uniform float uPxScale;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 1.0);

          float n = snoise(vec3(position.x, position.z, position.y * 4.0) * 0.0046);
          float patchiness = 0.26 + 1.28 * n;
          patchiness = max(patchiness, 0.06);

          float radial = length(position);
          float coreBoost = 1.0 + 0.85 * exp(-radial * 0.022);
          float diskFade = 1.0 - smoothstep(0.58, 1.00, radial / ${GAL_R.toFixed(1)});
          float lateral = 1.0 - (1.0 - ${(TUNE.leftFade * 0.92).toFixed(2)}) * (1.0 - smoothstep(-480.0, -100.0, position.x));
          float breath = 0.92 + 0.08 * sin(uTime * 0.35 + aSeed * 41.0);

          vColor = aColor * (patchiness * coreBoost * diskFade * lateral * breath);
          float px = aSize * uPxScale / depth;
          gl_PointSize = clamp(px, 2.0, 46.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = 1.0 - smoothstep(0.0, 1.0, d);
          a = pow(a, 1.7);
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });

    const hazePoints = new THREE.Points(hazeGeo, hazeMat);
    hazePoints.frustumCulled = false;
    hazePoints.renderOrder = 1;

    /* ============================================================
     * 3. 尘埃带点云（沿旋臂内侧的暗红褐粒子，普通混合压暗星点）
     * ============================================================ */
    const dPos = new Float32Array(N_DUST * 3);
    const dCol = new Float32Array(N_DUST * 3);
    const dSize = new Float32Array(N_DUST);
    const dSeed = new Float32Array(N_DUST);

    for (let i = 0; i < N_DUST; i++) {
      const arm = pickArm();
      const rr = R_IN * 0.9 + (GAL_R * 0.965 - R_IN * 0.9) * Math.pow(U.rand(), 0.80);
      const t = U.clamp(rr / GAL_R, 0, 1);
      // 主臂内侧（凸侧）偏移，形成暗缝；次臂少一些尘埃
      const theta0 = arm.phase + Math.log(Math.max(rr, R_IN) / R_IN) / TAN_PITCH - (arm.main ? 0.10 : 0.055);
      const spread = 0.020 + 0.042 * t;
      const th = theta0 + gauss() * spread;
      const rr2 = rr + gauss() * (1.0 + rr * 0.006);
      const xd = Math.cos(th) * rr2;
      const zd = Math.sin(th) * rr2;
      const yd = gauss() * (0.85 + rr2 * 0.006) - 0.6;

      const ty = yd * COS_T - zd * SIN_T;
      const tz = yd * SIN_T + zd * COS_T;
      dPos[i * 3] = xd * COS_R - ty * SIN_R;
      dPos[i * 3 + 1] = xd * SIN_R + ty * COS_R;
      dPos[i * 3 + 2] = tz;

      const lum = 0.55 + 0.55 * U.rand();
      dCol[i * 3] = C_DUST_LANE[0] * lum;
      dCol[i * 3 + 1] = C_DUST_LANE[1] * lum;
      dCol[i * 3 + 2] = C_DUST_LANE[2] * lum;
      dSize[i] = 1.6 + Math.pow(U.rand(), 1.6) * 3.6;
      dSeed[i] = U.rand();
    }
    // 约 8% 的弥漫尘埃：臂间与核球外缘的稀薄暗云
    for (let i = 0; i < Math.floor(N_DUST * 0.08); i++) {
      const j = Math.floor(U.rand() * N_DUST);
      const rr = 20 + U.rand() * GAL_R * 0.9;
      const th = U.rand() * Math.PI * 2;
      const xd = Math.cos(th) * rr;
      const zd = Math.sin(th) * rr;
      const yd = gauss() * (2.2 + rr * 0.012);
      const ty = yd * COS_T - zd * SIN_T;
      const tz = yd * SIN_T + zd * COS_T;
      dPos[j * 3] = xd * COS_R - ty * SIN_R;
      dPos[j * 3 + 1] = xd * SIN_R + ty * COS_R;
      dPos[j * 3 + 2] = tz;
      const lum = 0.35 + 0.3 * U.rand();
      dCol[j * 3] = C_DUST_LANE[0] * lum;
      dCol[j * 3 + 1] = C_DUST_LANE[1] * lum;
      dCol[j * 3 + 2] = C_DUST_LANE[2] * lum;
      dSize[j] *= 1.3;
    }

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dustGeo.setAttribute('aColor', new THREE.BufferAttribute(dCol, 3));
    dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1));
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1));

    const dustUniforms = { uTime: { value: 0 }, uPxScale: { value: 1080 / (2 * TAN_HALF) } };
    const dustLaneMat = new THREE.ShaderMaterial({
      uniforms: dustUniforms,
      vertexShader: `
        uniform float uTime;
        uniform float uPxScale;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 1.0);
          gl_PointSize = clamp(aSize * uPxScale / depth, 1.0, 40.0);
          vColor = aColor;
          vAlpha = (0.62 + 0.38 * sin(uTime * (0.13 + aSeed * 0.2) + aSeed * 37.0)) * ${TUNE.dustLaneGain.toFixed(2)};
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = (1.0 - smoothstep(0.10, 1.0, d)) * 0.58;
          gl_FragColor = vec4(vColor, clamp(a * vAlpha, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false
    });

    const dustPoints = new THREE.Points(dustGeo, dustLaneMat);
    dustPoints.frustumCulled = false;
    dustPoints.renderOrder = 3;

    /* ============================================================
     * 4. HII 区点云（旋臂上的电离氢区：粉红/洋红色成团发射）
     * ============================================================ */
    const pPos = new Float32Array(N_HII * 3);
    const pCol = new Float32Array(N_HII * 3);
    const pSize = new Float32Array(N_HII);
    const pSeed = new Float32Array(N_HII);

    // 先预生成 HII 群中心（构建期），再撒点
    const HII_CLUSTERS = 64;
    let pi = 0;
    for (let c = 0; c < HII_CLUSTERS && pi < N_HII; c++) {
      const arm = (c % 2 === 0) ? ARMS[0] : ARMS[1];
      const f = (c * 0.173 + 0.21) % 1;
      const rr = R_IN + (GAL_R * 0.92 - R_IN) * f;
      const theta0 = arm.phase + Math.log(Math.max(rr, R_IN) / R_IN) / TAN_PITCH - 0.03;
      const cx = Math.cos(theta0) * rr;
      const cz = Math.sin(theta0) * rr;
      const cy = gauss() * (1.4 + rr * 0.012);
      const groupN = Math.min(N_HII - pi, 24 + Math.floor(U.rand() * 52));
      const spread = 1.2 + U.rand() * 3.8;
      const purple = U.rand() < 0.22;
      for (let k = 0; k < groupN; k++) {
        const dx = gauss() * spread;
        const dy = gauss() * spread * 0.65;
        const dz = gauss() * spread;
        const ty = (cy + dy) * COS_T - (cz + dz) * SIN_T;
        const tz = (cy + dy) * SIN_T + (cz + dz) * COS_T;
        pPos[pi * 3] = (cx + dx) * COS_R - ty * SIN_R;
        pPos[pi * 3 + 1] = (cx + dx) * SIN_R + ty * COS_R;
        pPos[pi * 3 + 2] = tz;
        const cc = purple ? C_HII_PURPLE : C_HII;
        const b = (0.55 + U.rand() * 0.85) * TUNE.hiiGain;
        pCol[pi * 3] = cc[0] * b;
        pCol[pi * 3 + 1] = cc[1] * b;
        pCol[pi * 3 + 2] = cc[2] * b;
        pSize[pi] = 0.34 + U.rand() * 0.95;
        pSeed[pi] = U.rand();
        pi++;
      }
    }
    // 余下点数补到主臂上（零散 HII 点）
    while (pi < N_HII) {
      const arm = (pi % 2 === 0) ? ARMS[0] : ARMS[1];
      const rr = R_IN + U.rand() * (GAL_R * 0.92 - R_IN);
      const th = arm.phase + Math.log(Math.max(rr, R_IN) / R_IN) / TAN_PITCH + gauss() * 0.05;
      pPos[pi * 3] = Math.cos(th) * rr;
      pPos[pi * 3 + 1] = gauss() * (1.2 + rr * 0.010);
      pPos[pi * 3 + 2] = Math.sin(th) * rr;
      const b = 0.5 + U.rand() * 0.7;
      pCol[pi * 3] = C_HII[0] * b;
      pCol[pi * 3 + 1] = C_HII[1] * b;
      pCol[pi * 3 + 2] = C_HII[2] * b;
      pSize[pi] = 0.3 + U.rand() * 0.8;
      pSeed[pi] = U.rand();
      pi++;
    }

    const hiiGeo = new THREE.BufferGeometry();
    hiiGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    hiiGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
    hiiGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
    hiiGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));

    const hiiUniforms = { uTime: { value: 0 }, uPxScale: { value: 1080 / (2 * TAN_HALF) } };
    const hiiMat = new THREE.ShaderMaterial({
      uniforms: hiiUniforms,
      vertexShader: `
        uniform float uTime;
        uniform float uPxScale;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 1.0);
          float tw = 0.88 + 0.12 * sin(uTime * (0.5 + aSeed * 0.7) + aSeed * 53.0);
          gl_PointSize = clamp(aSize * uPxScale / depth, 1.0, 16.0) * tw;
          vColor = aColor;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.7);
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });

    const hiiPoints = new THREE.Points(hiiGeo, hiiMat);
    hiiPoints.frustumCulled = false;
    hiiPoints.renderOrder = 2;

    /* ============================================================
     * 5. 十字星芒（只有最亮的十几颗一等星）
     * ============================================================ */
    const fPos = new Float32Array(N_FLARE * 3);
    const fCol = new Float32Array(N_FLARE * 3);
    const fSize = new Float32Array(N_FLARE);
    const fSeed = new Float32Array(N_FLARE);

    for (let i = 0; i < N_FLARE; i++) {
      let xd, yd, zd;
      if (i < N_FLARE * 0.6) {
        const rr = RB * Math.pow(U.rand(), 1.2) * 0.92;
        const ct = U.rand() * Math.PI * 2;
        xd = Math.cos(ct) * rr;
        zd = Math.sin(ct) * rr;
        yd = gauss() * (rr * 0.22 + 1.5);
      } else {
        const arm = pickArm();
        const rr0 = R_IN + (GAL_R * 0.86 - R_IN) * Math.pow(U.rand(), 0.50);
        const th0 = arm.phase + Math.log(rr0 / R_IN) / TAN_PITCH + gauss() * 0.04;
        xd = Math.cos(th0) * rr0 + gauss() * 4;
        zd = Math.sin(th0) * rr0 + gauss() * 4;
        yd = gauss() * 1.6;
      }
      const ty = yd * COS_T - zd * SIN_T;
      const tz = yd * SIN_T + zd * COS_T;
      fPos[i * 3] = xd * COS_R - ty * SIN_R;
      fPos[i * 3 + 1] = xd * SIN_R + ty * COS_R;
      fPos[i * 3 + 2] = tz;

      const warm = U.rand() < 0.45;
      const b = (0.70 + U.rand() * 0.95) * TUNE.flareGain * (fPos[i * 3] < -120 ? TUNE.leftFade + 0.30 : 1);
      if (warm) {
        fCol[i * 3] = 1.25 * b; fCol[i * 3 + 1] = 0.90 * b; fCol[i * 3 + 2] = 0.58 * b;
      } else {
        fCol[i * 3] = 0.78 * b; fCol[i * 3 + 1] = 0.92 * b; fCol[i * 3 + 2] = 1.30 * b;
      }
      fSize[i] = 8 + Math.pow(U.rand(), 1.6) * 22;
      fSeed[i] = U.rand();
    }

    const flareGeo = new THREE.BufferGeometry();
    flareGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    flareGeo.setAttribute('aColor', new THREE.BufferAttribute(fCol, 3));
    flareGeo.setAttribute('aSize', new THREE.BufferAttribute(fSize, 1));
    flareGeo.setAttribute('aSeed', new THREE.BufferAttribute(fSeed, 1));

    const flareUniforms = { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } };
    const flareMat = new THREE.ShaderMaterial({
      uniforms: flareUniforms,
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 1.0);
          float pulse = 0.88 + 0.12 * sin(uTime * (0.35 + aSeed * 0.5) + aSeed * 40.0);
          gl_PointSize = aSize * uPixelRatio * (500.0 / depth) * pulse;
          vColor = aColor * (0.9 + 0.2 * pulse);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float core = pow(max(0.0, 1.0 - d * 2.6), 3.0);
          // 四芒：exp 衰减系数按像素标定（24px 点时约 1.6px 宽）
          float sx = exp(-abs(c.y) * 34.0) * max(0.0, 1.0 - abs(c.x) * 2.4);
          float sy = exp(-abs(c.x) * 34.0) * max(0.0, 1.0 - abs(c.y) * 2.4);
          float d1 = abs(c.x - c.y) * 0.7071;
          float d2 = abs(c.x + c.y) * 0.7071;
          float diag = (exp(-d1 * 58.0) + exp(-d2 * 58.0)) * max(0.0, 1.0 - d * 3.8) * 0.12;
          float a = core + (sx + sy) * 0.55 + diag;
          vec3 col = vColor * (0.85 + a * 0.80);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });

    const flarePoints = new THREE.Points(flareGeo, flareMat);
    flarePoints.frustumCulled = false;
    flarePoints.renderOrder = 6;

    /* ============================================================
     * 6. 近景星点（细小、闪烁，推进时产生视差）
     * ============================================================ */
    const nPos = new Float32Array(N_NEAR * 3);
    const nCol = new Float32Array(N_NEAR * 3);
    const nSize = new Float32Array(N_NEAR);
    const nPhase = new Float32Array(N_NEAR);
    for (let i = 0; i < N_NEAR; i++) {
      nPos[i * 3] = (U.rand() * 2 - 1) * 900;
      nPos[i * 3 + 1] = (U.rand() * 2 - 1) * 560;
      nPos[i * 3 + 2] = 130 + U.rand() * 320;
      const t = U.rand();
      let r, g, b;
      if (t < 0.5) { r = 0.70; g = 0.80; b = 1.0; }
      else if (t < 0.8) { r = 1.0; g = 0.95; b = 0.86; }
      else { r = 1.0; g = 0.78; b = 0.56; }
      const br = (0.055 + Math.pow(U.rand(), 2.0) * 0.22) * (1 - 0.48 * Math.abs(nPos[i * 3]) / 900);
      nCol[i * 3] = r * br; nCol[i * 3 + 1] = g * br; nCol[i * 3 + 2] = b * br;
      nSize[i] = 0.16 + Math.pow(U.rand(), 3.0) * 0.55;
      nPhase[i] = U.rand();
    }
    const nearGeo = new THREE.BufferGeometry();
    nearGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
    nearGeo.setAttribute('aColor', new THREE.BufferAttribute(nCol, 3));
    nearGeo.setAttribute('aSize', new THREE.BufferAttribute(nSize, 1));
    nearGeo.setAttribute('aPhase', new THREE.BufferAttribute(nPhase, 1));

    const nearUniforms = { uTime: { value: 0 }, uPxScale: { value: 1080 / (2 * TAN_HALF) } };
    const nearMat = new THREE.ShaderMaterial({
      uniforms: nearUniforms,
      vertexShader: `
        uniform float uTime;
        uniform float uPxScale;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vTw;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 1.0);
          float tw = 0.5 + 0.5 * sin(uTime * (0.8 + aPhase * 1.8) + aPhase * 57.0);
          float px = aSize * uPxScale / depth;
          gl_PointSize = clamp(px, 1.0, 3.0) * (0.85 + 0.35 * tw);
          vColor = aColor;
          vTw = tw;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTw;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = 1.0 - smoothstep(0.05, 1.0, d);
          a = a * a * (0.65 + 0.6 * vTw);
          gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    const nearStars = new THREE.Points(nearGeo, nearMat);
    nearStars.frustumCulled = false;
    nearStars.renderOrder = -5;

    /* ============================================================
     * 7. 背景星野
     * ============================================================ */
    const bgStars = COSMOS.builders.makeStarfield({ count: N_BG, rMin: 600, rMax: 1600 });
    if (bgStars.material && bgStars.material.uniforms && bgStars.material.uniforms.uOpacity) {
      bgStars.material.uniforms.uOpacity.value = 0.32;
    }

    /* ============================================================
     * 8. 气体 / 辉光 / 大尺度暗尘埃（sprite 层，共 33 个）
     * ============================================================ */
    const texSoft = softCloudTexture(isLow ? 512 : 768);
    const texGlow = COSMOS.tex.glowTexture(256);
    const texDust = dustTexture(512, isLow ? 8 : 14);

    const pivot = new THREE.Group();
    pivot.position.set(CORE_WX0, CORE_WY0, 0);
    scene.add(pivot);
    pivot.add(galaxyPoints);
    pivot.add(hazePoints);
    pivot.add(dustPoints);
    pivot.add(hiiPoints);
    pivot.add(flarePoints);

    const spriteField = [];
    function addSprite(o) {
      const locX = screenToLocalX(o.sx, o.z);
      const locY = screenToLocalY(o.sy, o.z);
      const mat = new THREE.SpriteMaterial({
        map: o.map,
        color: new THREE.Color().setRGB(o.r, o.g, o.b),
        transparent: true,
        opacity: o.alpha,
        depthWrite: false,
        depthTest: false,
        blending: o.dust ? THREE.NormalBlending : THREE.AdditiveBlending,
        toneMapped: false
      });
      mat.rotation = o.rot || 0;
      const sp = new THREE.Sprite(mat);
      sp.position.set(locX, locY, o.z);
      sp.scale.set(o.w, o.h, 1);
      sp.renderOrder = o.order !== undefined ? o.order : 1;
      pivot.add(sp);
      spriteField.push({
        sp: sp, mat: mat,
        bx: locX, by: locY,
        alpha: o.alpha,
        phase: o.phase || 0,
        speed: o.speed || 0.2,
        drift: o.drift || 0,
        driftSpeed: o.driftSpeed || 0.1,
        rot: o.rot || 0,
        rotAmp: o.rotAmp || 0.03
      });
      return sp;
    }

    /* 尺寸一律按「参考视口 1600x900 下的像素」书写，运行时换算成世界单位。 */
    const PXU = 900 / (2 * TAN_HALF * CAM_DIST0);
    function uu(px) { return px / PXU; }

    /* 8a. 盘面辉光带（细长、沿盘面滚转 → 连续银河的整体亮度） */
    const BANDS = [
      [0.635, 0.455, -40, 1520, 330, 0.60, 0.58, 0.86, 0.020],
      [0.600, 0.480, -22, 1080, 250, 0.86, 0.70, 0.72, 0.024],
      [0.700, 0.512, -30, 900, 230, 0.52, 0.64, 0.96, 0.020],
      [0.400, 0.448, -60, 720, 200, 0.58, 0.48, 0.95, 0.013]
    ];
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i];
      addSprite({
        sx: b[0], sy: b[1], z: b[2], w: uu(b[3]), h: uu(b[4]),
        r: b[5], g: b[6], b: b[7], alpha: b[8] * TUNE.bandGain,
        map: texGlow, rot: ROLL, order: 0,
        phase: i * 1.61, speed: 0.09 + (i % 3) * 0.02,
        drift: 1.8, driftSpeed: 0.035, rotAmp: 0.010
      });
    }

    /* 8b. 核心 HDR 光核（扁椭圆，靠泛光晕开；外层用纯径向 glow 避免色块感） */
    const CORES = [
      [0.635, 0.437, -8, 820, 340, 0.80, 0.62, 0.42, 0.030, 0],
      [0.635, 0.437, -3, 460, 210, 1.00, 0.80, 0.56, 0.048, 0],
      [0.635, 0.437, 0, 250, 122, 1.10, 0.92, 0.70, 0.085, 1],
      [0.635, 0.435, 6, 124, 64, 1.90, 1.60, 1.20, 0.140, 1]
    ];
    for (let i = 0; i < CORES.length; i++) {
      const c = CORES[i];
      addSprite({
        sx: c[0], sy: c[1], z: c[2], w: uu(c[3]), h: uu(c[4]),
        r: c[5], g: c[6], b: c[7], alpha: c[8] * TUNE.coreHaze,
        map: c[9] ? texSoft : texGlow, rot: ROLL, order: 2,
        phase: 0.7 + i * 1.9, speed: 0.11, drift: 0.5, driftSpeed: 0.03, rotAmp: 0.005
      });
    }

    /* 8c. 旋臂上的气体云：沿对数螺旋切线拉长（不是圆斑），低 alpha 多层叠加 */
    const N_GAS = isLow ? 5 : 8;
    const GAS_COL = [
      [1.05, 0.22, 0.55],
      [0.28, 0.80, 1.00],
      [0.62, 0.38, 1.05]
    ];
    for (let i = 0; i < N_GAS; i++) {
      const arm = ARMS[i % 4];
      const rf = (i * 0.427 + 0.19) % 1;
      const rr = R_IN + (GAL_R * 0.94 - R_IN) * rf;
      const th = arm.phase + Math.log(rr / R_IN) / TAN_PITCH + ((i % 2) ? 0.09 : -0.07);
      const gp = diskToScreen(Math.cos(th) * rr, 0, Math.sin(th) * rr);
      const gp2 = diskToScreen(Math.cos(th + 0.06) * rr, 0, Math.sin(th + 0.06) * rr);
      const ang = Math.atan2(-(gp2[1] - gp[1]) * 900, (gp2[0] - gp[0]) * 1600);
      const cc = GAS_COL[i % 3];
      addSprite({
        sx: gp[0], sy: gp[1], z: gp[2],
        w: uu(300 + (i % 4) * 80), h: uu(130 + (i % 3) * 40),
        r: cc[0], g: cc[1], b: cc[2], alpha: (0.017 + (i % 3) * 0.005) * TUNE.gasGain,
        map: texSoft, rot: ang, order: 1,
        phase: i * 1.37, speed: 0.12 + (i % 5) * 0.035,
        drift: 2.2, driftSpeed: 0.045 + (i % 3) * 0.015, rotAmp: 0.04
      });
    }

    /* 8d. 旋臂亮结：HDR 光斑（含 3 处粉红 HII 复合体），把“年轻星团正在点亮”点出来 */
    const N_KNOT = isLow ? 4 : 8;
    const KNOT_ARM = [0, 1, 2, 3, 1, 2, 0, 1];
    const KNOT_R = [0.34, 0.52, 0.72, 0.44, 0.86, 0.30, 0.63, 0.78];
    for (let i = 0; i < N_KNOT; i++) {
      const arm = ARMS[KNOT_ARM[i % KNOT_ARM.length] % 4];
      const rr = R_IN + (GAL_R * 0.90 - R_IN) * KNOT_R[i % KNOT_R.length];
      const th = arm.phase + Math.log(rr / R_IN) / TAN_PITCH + 0.10 * Math.sin(i * 2.3);
      const kp = diskToScreen(Math.cos(th) * rr, 0, Math.sin(th) * rr);
      const isHii = i % 3 === 2;
      const warm = i % 4 === 1;
      const kw = uu(11 + (i % 4) * 4);
      addSprite({
        sx: kp[0], sy: kp[1], z: kp[2], w: kw, h: kw * 0.92,
        r: isHii ? 2.10 : (warm ? 2.40 : 1.05),
        g: isHii ? 0.62 : (warm ? 1.95 : 1.45),
        b: isHii ? 0.70 : (warm ? 1.45 : 2.05),
        alpha: (isHii ? 1.05 : 1.35) * TUNE.knotGain
          + (i % 3) * 0.30,
        map: texGlow, rot: ROLL, order: 2,
        phase: 5.1 + i * 1.7, speed: 0.13 + (i % 5) * 0.03,
        drift: 0.8, driftSpeed: 0.05, rotAmp: 0.02
      });
    }

    /* 8e. 大尺度暗尘埃云：柔和的暗色长条（非矩形边界），横向切割盘面与亮核 */
    const DUST = [
      [0.300, 0.452, 30, 520, 150, 0.30, 4, 44],
      [0.420, 0.492, -20, 580, 165, 0.34, -5, 48],
      [0.615, 0.466, 55, 500, 130, 0.40, 0, 38],
      [0.700, 0.512, 35, 470, 145, 0.32, 5, 42],
      [0.800, 0.560, -15, 560, 165, 0.29, -6, 46],
      [0.660, 0.398, 60, 360, 118, 0.22, -55, 34]
    ];
    for (let i = 0; i < DUST.length; i++) {
      const dd = DUST[i];
      addSprite({
        sx: dd[0], sy: dd[1], z: dd[2], w: uu(dd[3]), h: uu(dd[4]),
        r: 0.0, g: 0.0, b: 0.0, alpha: Math.min(0.62, dd[5] * TUNE.dustGain),
        map: texDust, dust: true, rot: ROLL + dd[6] * DEG, order: 3,
        phase: i * 2.03, speed: 0.07,
        drift: 2.0, driftSpeed: 0.03, rotAmp: 0.010
      });
      addSprite({
        sx: dd[0], sy: dd[1], z: dd[2] + 2, w: uu(dd[3] * 0.92), h: uu(dd[4] * 0.34),
        r: 0.0, g: 0.0, b: 0.0, alpha: Math.min(0.56, dd[7] / 100 * TUNE.dustGain),
        map: texDust, dust: true, rot: ROLL + dd[6] * DEG, order: 3,
        phase: i * 2.03 + 0.9, speed: 0.07,
        drift: 1.6, driftSpeed: 0.03, rotAmp: 0.008
      });
    }

    /* 8f. 盘面外侧的冷紫气体（撑开外围、增加纵深） */
    const OUTER = [
      [0.180, 0.360, -90, 340, 340, 0.34, 0.16, 0.95, 0.013],
      [0.360, 0.560, -80, 310, 310, 0.42, 0.20, 1.00, 0.011],
      [0.980, 0.520, -60, 300, 300, 0.36, 0.18, 0.98, 0.011]
    ];
    for (let i = 0; i < OUTER.length; i++) {
      const o = OUTER[i];
      addSprite({
        sx: o[0], sy: o[1], z: o[2], w: uu(o[3]), h: uu(o[4]),
        r: o[5], g: o[6], b: o[7], alpha: o[8] * TUNE.gasGain,
        map: texSoft,
        rot: ROLL + i * 0.9, order: 1,
        phase: 4.2 + i * 1.3, speed: 0.10,
        drift: 2.4, driftSpeed: 0.04
      });
    }

    scene.add(bgStars);
    scene.add(nearStars);

    /* ============================================================
     * 9. 布局 / 镜头 / 每帧更新
     * ============================================================ */
    let camDist = CAM_DIST0;
    let intro = 0;           // 首屏推镜 0→1
    let diveWarped = false;  // 俯冲只触发一次转场

    /* ---- 交互状态：拖拽旋转 / 缩放 / 点击核球俯冲 ---- */
    const view = {
      yaw: 0, pitch: 0, vy: 0, vp: 0,
      zoom: 1, zoomTarget: 1,
      dive: false
    };
    const tmpV = new THREE.Vector3();

    function resetView() {
      view.yaw = 0; view.pitch = 0;
      view.vy = 0; view.vp = 0;
      view.zoom = 1;
      view.zoomTarget = 1;
      view.dive = false;
      intro = 0;
      diveWarped = false;
    }

    function handleClick(click) {
      if (!click) return;
      // 核球在屏幕上的位置（投影世界原点）
      const c = COSMOS.util.project(camera, tmpV.set(0, 0, 0), ctx.width, ctx.height);
      const cx = c.x / Math.max(ctx.width, 1) * 2 - 1;
      const cy = -(c.y / Math.max(ctx.height, 1) * 2 - 1);
      const d = Math.hypot(click.nx - cx, click.ny - cy);
      if (d < 0.24) {
        view.dive = true;
        view.zoomTarget = 0.34;
        if (COSMOS.emit) COSMOS.emit('hero:dive', { dive: true });
        // 俯冲 1.1s 后直接接上「宇宙总览」——让点击核球成为进入旅程的入口
        if (!diveWarped) {
          diveWarped = true;
          setTimeout(function () {
            if (COSMOS.app && COSMOS.app.goTo) COSMOS.app.goTo('overview');
            diveWarped = false;
          }, 1100);
        }
      }
    }

    function layout(w, h) {
      const aspect = (w && h) ? w / Math.max(h, 1) : (ctx.aspect || REF_ASPECT);
      const aLay = U.clamp(aspect, 1.2, 2.6);
      camDist = HALF_W / (TAN_HALF * aLay);
      const halfH = HALF_W / aspect;
      pivot.position.set(CORE_WX0, (0.5 - CORE_SY) * 2 * halfH, 0);
      const pxScale = (h * pixelRatio) / (2 * TAN_HALF);
      galaxyUniforms.uPxScale.value = pxScale;
      hazeUniforms.uPxScale.value = pxScale;
      dustUniforms.uPxScale.value = pxScale;
      hiiUniforms.uPxScale.value = pxScale;
      nearUniforms.uPxScale.value = pxScale;
    }
    layout(ctx.width, ctx.height);

    function resize(w, h) {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      layout(w, h);
    }

    /* 键盘状态（update 内只读）：←/→ 环绕、w/s 俯仰、+/- 缩放 */
    const KEYS = { left: 'ArrowLeft', right: 'ArrowRight' };

    function update(t, dt, p) {
      if (!isFinite(t)) t = 0;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.1) dt = 0.1;
      const pp = U.ease.inOutSine(U.clamp(isFinite(p) ? p : 0, 0, 1));
      const inp = ctx.input;
      const rm = ctx.reduceMotion;

      /* ---------- 交互：拖拽旋转银河 / 键盘 / 缩放 / 点击核球 ---------- */
      if (inp) {
        const kk = inp.keys || {};
        if (inp.dragging && !inp.uiTarget) {
          view.yaw += inp.dx * 0.0042;
          view.pitch = U.clamp(view.pitch + inp.dy * 0.0026, -0.42, 0.42);
          view.vy = inp.dx * 0.0042;
          view.vp = inp.dy * 0.0026;
        } else if (!inp.down) {
          // 松手惯性 → 衰减
          view.yaw += view.vy;
          view.pitch = U.clamp(view.pitch + view.vp, -0.42, 0.42);
          const decay = Math.exp(-dt * 3.2);
          view.vy *= decay;
          view.vp *= decay;
        }
        // 键盘：←/→ 调 yaw，w/s 调 pitch，+/- 缩放
        const kYaw = (kk[KEYS.left] || kk.a ? 1 : 0) - (kk[KEYS.right] || kk.d ? 1 : 0);
        if (kYaw !== 0) {
          view.yaw += kYaw * 0.85 * dt;
          view.vy = kYaw * 0.85;
        }
        const kPitch = (kk.w ? 1 : 0) - (kk.s ? 1 : 0);
        if (kPitch !== 0) {
          view.pitch = U.clamp(view.pitch + kPitch * 0.55 * dt, -0.42, 0.42);
          view.vp = kPitch * 0.55;
        }
        if (kk['+'] || kk['=']) view.zoomTarget = U.clamp(view.zoomTarget * Math.exp(-0.9 * dt), 0.32, 2.8);
        if (kk['-']) view.zoomTarget = U.clamp(view.zoomTarget * Math.exp(0.9 * dt), 0.32, 2.8);
        if (inp.pinch) view.zoomTarget = U.clamp(view.zoomTarget * (1 - inp.pinch * 0.85), 0.32, 2.8);
        if (inp.wheel) view.zoomTarget = U.clamp(view.zoomTarget * (1 + inp.wheel * 0.0011), 0.32, 2.8);
        if (inp.wheelCtrl) view.zoomTarget = U.clamp(view.zoomTarget * (1 + inp.wheelCtrl * 0.0012), 0.32, 2.8);
        if (inp.click) handleClick(inp.click);
      }
      view.zoom += (view.zoomTarget - view.zoom) * Math.min(1, dt * 6);
      if (!rm && !(inp && inp.down)) view.yaw += dt * 0.012;
      // 轻微回正，避免越转越偏
      view.pitch += (0 - view.pitch) * dt * 0.04;
      pivot.rotation.y = view.yaw;
      pivot.rotation.x = view.pitch * 0.55;

      /* ---------- 首屏推镜：3 秒内从远处推进到航拍位 ---------- */
      if (intro < 1) intro = Math.min(1, intro + dt * (rm ? 2 : 0.42));
      const introEase = 1 - Math.pow(1 - intro, 3);
      const pushIn = (1 + (1 - introEase) * 0.62);

      /* ---------- 指针视差（不干扰拖拽） ---------- */
      const parX = inp && !inp.down ? inp.nx * 0.9 : 0;
      const parY = inp && !inp.down ? inp.ny * 0.55 : 0;

      camera.position.set(
        Math.sin(t * 0.033) * 1.4 - pp * 2.5 + parX,
        Math.cos(t * 0.027) * 1.0 + pp * 1.5 + parY,
        (camDist * (1 - 0.20 * pp) + Math.sin(t * 0.041) * 1.8) * view.zoom * pushIn
      );
      camera.rotation.z = Math.sin(t * 0.023) * 0.005 + pp * 0.006;
      camera.rotation.y = Math.sin(t * 0.017 + 1.3) * 0.004;

      galaxyUniforms.uTime.value = t;
      hazeUniforms.uTime.value = t;
      dustUniforms.uTime.value = t;
      hiiUniforms.uTime.value = t;
      flareUniforms.uTime.value = t;
      nearUniforms.uTime.value = t;
      if (bgStars.material && bgStars.material.uniforms && bgStars.material.uniforms.uTime) {
        bgStars.material.uniforms.uTime.value = t;
      }

      for (let i = 0; i < spriteField.length; i++) {
        const c = spriteField[i];
        const ph = c.phase;
        c.mat.opacity = c.alpha * (0.86 + 0.14 * Math.sin(t * c.speed + ph));
        c.sp.position.x = c.bx + Math.sin(t * c.driftSpeed + ph * 1.7) * c.drift;
        c.sp.position.y = c.by + Math.cos(t * c.driftSpeed * 0.77 + ph * 2.3) * c.drift * 0.6;
        c.mat.rotation = c.rot + Math.sin(t * 0.021 + ph) * c.rotAmp;
      }
    }

    return {
      scene: scene,
      camera: camera,
      update: update,
      resize: resize,
      reset: resetView,
      bloom: { strength: 1.22, radius: 0.92, threshold: 0.52 },
      dispose: function () {
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material && o.material.dispose) o.material.dispose();
        });
      }
    };
  });
})(window.COSMOS = window.COSMOS || {});
