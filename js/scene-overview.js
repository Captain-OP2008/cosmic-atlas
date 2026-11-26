/* ============================================================
 * COSMOS ATLAS · 01「宇宙总览」— 拉尼亚凯亚超星系团（stage: overview）· v4
 * ------------------------------------------------------------
 * 画面（艺术化示意，尺度经过压缩）：
 *   - 金色主体：拉尼亚凯亚超星系团的「纤维流」——从密集核心向外
 *     流泻的数千条弯曲发丝，颜色从白热 → 金 → 奶油 → 淡蓝，越靠
 *     近核心越亮、越密；核心处是巨引源所在的高亮团块；
 *   - 蓝色外围：更远处的宇宙网节点与细丝，提供纵深与对比；
 *   - 银河系用红点标出，另有巨引源、室女座星系团等可点击标签；
 *   - 所有粒子共用一个着色器，随时间缓慢自旋 + 呼吸，不重建几何。
 *
 * 交互：
 *   - 拖拽 360° 环绕（松手惯性）；滚轮 / 双指 / +/- 缩放（可放大可缩小）；
 *   - ←/→ 与 w/s 键盘环绕；Esc 复位；
 *   - 点击任意标签 → 展开该天体的说明（只有动手才看得见）；
 *   - 红色「银河系」标签标出我们在宇宙网里的位置。
 *
 * 数据口径：
 *   - 拉尼亚凯亚超星系团：Tully et al. 2014（Nature）用星系流场定义，
 *     直径约 5.2 亿光年（约 160 Mpc），包含约 10 万个星系；
 *   - 银河系朝巨引源方向的本动速度约 600 km/s；
 *   - 本场景是示意，粒子位置与距离经过压缩。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  const T = (COSMOS.i18n && COSMOS.i18n.T) || function (zh) { return zh; };
  const U = COSMOS.util;
  const TAU = Math.PI * 2;

  const FOV = 55;
  const CORE_RX = 15.0;
  const CORE_RY = 9.0;
  const CORE_RZ = 13.5;
  const WEB_RADIUS = 104.0;

  /* 打开 01 章时纤维已经「卷」了多久（秒）。
   * 纤维的差速旋转（核心快、外缘慢）会把放射状的丝束逐渐剪切成漩涡；
   * 预置一段运行时间，让章节一打开就是漩涡形态，而不是从零慢慢卷起来。 */
  const SPIN_WARMUP = 45;

  /* 金色流的颜色带：白热核心 → 金 → 奶油 → 淡蓝尾迹 */
  const C_HOT = [1.00, 0.86, 0.56];
  const C_GOLD = [1.00, 0.72, 0.30];
  const C_CREAM = [1.00, 0.86, 0.56];
  const C_TIP = [0.55, 0.72, 1.00];

  const C_WEB_A = [0.28, 0.44, 0.98];
  const C_WEB_B = [0.52, 0.36, 0.96];
  const C_WEB_C = [0.34, 0.66, 1.00];
  const C_WEB_NODE = [0.72, 0.84, 1.00];

  /* ---------- 粒子着色器 ---------- */
  const VS = `
    attribute float aSize;
    attribute vec3  aColor;
    attribute float aSpin;
    attribute float aPhase;
    uniform float uPR;
    uniform float uTime;
    uniform float uFade;
    varying vec3  vColor;
    varying float vA;
    void main() {
      vec3 p = position;
      float r = max(length(p.xz), 0.001);
      // 半径越小转得越快：核心像漩涡，外缘像缓慢的水流
      float ang = uTime * aSpin * 0.055 / (0.75 + r * 0.035) + aPhase * 0.55;
      float ca = cos(ang), sa = sin(ang);
      vec3 q = vec3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);
      // 极缓慢的径向呼吸，暗示结构在演化
      q *= 1.0 + 0.0065 * sin(uTime * 0.26 - r * 0.105);
      vec4 mv = modelViewMatrix * vec4(q, 1.0);
      gl_Position = projectionMatrix * mv;
      float tw = 0.74 + 0.26 * sin(uTime * 0.85 + aPhase * 41.0);
      gl_PointSize = aSize * uPR * (168.0 / max(-mv.z, 1.0)) * tw;
      vColor = aColor;
      float depth = clamp(-mv.z / 165.0 + 0.50, 0.0, 1.0);
      vA = uFade * tw * pow(depth, 0.62);
    }
  `;
  const FS = `
    varying vec3  vColor;
    varying float vA;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float d = clamp(length(c) * 2.0, 0.0, 1.0);
      float a = 1.0 - d;
      a *= a;
      a *= vA;
      gl_FragColor = vec4(vColor, a);
    }
  `;

  /* ---------- 丝绸纤维（ribbon）着色器 ----------
   * 每条纤维是一条面向相机的软边带子：顶点着色器里用「切线 × 视线」
   * 展开左右两条边，片元按到中线的距离做高斯衰减（窄亮芯 + 宽柔光晕），
   * 再沿纤维长度叠加缓慢的丝绸光泽波动，避免出现钢丝一样的硬边。 */
  const SILK_VS = `
    attribute vec3  aCenter;
    attribute vec3  aTangent;
    attribute float aSide;
    attribute float aU;
    attribute float aWidth;
    attribute vec3  aColor;
    attribute float aSpin;
    attribute float aPhase;
    uniform float uTime;
    uniform float uWidthMul;
    varying float vSide;
    varying float vU;
    varying vec3  vColor;
    varying float vSeed;
    varying float vFade;
    varying float vDist;
    void main() {
      vec3 p = aCenter;
      float r = max(length(p.xz), 0.001);
      float ang = uTime * aSpin * 0.055 / (0.75 + r * 0.035) + aPhase * 0.55;
      float ca = cos(ang), sa = sin(ang);
      vec3 c = vec3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);
      c *= 1.0 + 0.0065 * sin(uTime * 0.26 - r * 0.105);
      vec3 t = vec3(aTangent.x * ca - aTangent.z * sa, aTangent.y, aTangent.x * sa + aTangent.z * ca);
      vec4 mv = modelViewMatrix * vec4(c, 1.0);
      vec3 tv = mat3(modelViewMatrix) * t;
      vec3 vd = normalize(-mv.xyz);
      vec3 sd = cross(tv, vd);
      float sl = length(sd);
      sd = sl > 1e-5 ? sd / sl : vec3(1.0, 0.0, 0.0);
      mv.xyz += sd * aSide * aWidth * uWidthMul;
      gl_Position = projectionMatrix * mv;
      vSide = aSide;
      vU = aU;
      vColor = aColor;
      vSeed = aPhase;
      vDist = length(aCenter);
      float depth = clamp(-mv.z / 165.0 + 0.50, 0.0, 1.0);
      vFade = pow(depth, 0.62);
    }
  `;
  const SILK_FS = `
    varying float vSide;
    varying float vU;
    varying vec3  vColor;
    varying float vSeed;
    varying float vFade;
    varying float vDist;
    uniform float uTime;
    uniform float uAlpha;
    void main() {
      float e = abs(vSide);
      float core = exp(-e * e * 7.2);
      float halo = exp(-e * e * 2.40);
      float wave = 0.55 + 0.45 * sin(vU + vSeed * 6.283 + uTime * 0.35);
      float dFade = mix(0.26, 1.0, smoothstep(2.5, 12.0, vDist));
      float a = (core * 0.64 + halo * 0.08) * (0.58 + 0.52 * wave) * uAlpha * vFade * dFade;
      vec3 col = vColor * (0.90 + 0.30 * wave);
      gl_FragColor = vec4(col, a);
    }
  `;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix3(out, a, b, t) {
    out[0] = lerp(a[0], b[0], t);
    out[1] = lerp(a[1], b[1], t);
    out[2] = lerp(a[2], b[2], t);
    return out;
  }

  COSMOS.registerStage('overview', function (ctx) {
    U.reseed(0x1A17A9);
    const isLow = ctx.quality === 'low';
    const isMed = ctx.quality === 'medium';
    const rnd = mulberry32(0x5EED12);

    const scene = new THREE.Scene();
    // 深蓝底：参考图里的宇宙背景色，让金色纤维更突出
    scene.background = new THREE.Color(0x061026);
    const camera = U.makeCamera(FOV, ctx.aspect || 1);
    camera.near = 0.4;
    camera.far = 4000;

    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const tmpC = new THREE.Vector3();
    const tmpCol = [0, 0, 0];

    /* ============================================================
     * 1. 金色纤维流：从核心向外流泻的“头发”
     * ============================================================ */
    const goldPos = [];
    /* 丝绸纤维 ribbon 缓冲：每个采样点两个顶点（左右边缘） */
    const silkCenter = [];
    const silkTangent = [];
    const silkSide = [];
    const silkWidth = [];
    const silkColor = [];
    const silkU = [];
    const silkSpin = [];
    const silkPhase = [];
    const silkIndex = [];
    let silkVerts = 0;
    const goldCol = [];
    const goldSize = [];
    const goldSpin = [];
    const goldPhase = [];


    function pushGold(x, y, z, col, size, spin) {
      goldPos.push(x, y, z);
      goldCol.push(col[0], col[1], col[2]);
      goldSize.push(size);
      goldSpin.push(spin);
      goldPhase.push(rnd());
    }

    // 纤维「家族」：同一束里的丝共享走向与曲率，靠微小抖动散开，
    // 这样叠出来是丝绸的一绺一绺，而不是蒲公英式的放射线。
    const FAM = [];
    for (let f = 0; f < 120; f++) {
      const wind = 0.86 + (rnd() - 0.5) * 1.15;
      FAM.push({
        th: rnd() < 0.18 ? wind + (rnd() - 0.5) * 2.3 : rnd() * TAU,
        y0: rnd() < 0.12 ? (rnd() - 0.5) * 7.0 : (rnd() * 2 - 1) * 1.5,
        curl: (rnd() < 0.84 ? 1 : -1) * (0.55 + rnd() * 1.25),
        len: 0.72 + rnd() * 1.05,
        ph: rnd() * TAU,
        wa: 0.55 + rnd() * 0.85,
        wf: 2.2 + rnd() * 3.2
      });
    }

    function pushStream(lay) {
      // 一条弯曲的“丝绸纤维”：从核心附近出发，边向外扩张边绕轴旋转。
      const fam = FAM[(rnd() * FAM.length) | 0];
      const th0 = fam.th + (rnd() - 0.5) * 0.10;
      const y0 = fam.y0 + (rnd() - 0.5) * 0.42;
      const r0 = 4.6 + rnd() * 5.8;
      const len = lay.len * fam.len * (0.94 + rnd() * 0.12);
      const curl = fam.curl * lay.curl * (0.94 + rnd() * 0.12);
      const phase = fam.ph + (rnd() - 0.5) * 0.16;
      const waveAmp = lay.spread * fam.wa;
      const waveFreq = fam.wf;
      const brightBias = 0.86 + rnd() * 0.30;
      const tint = 0.88 + rnd() * 0.26;
      const strandW = 0.70 + rnd() * 0.55;
      const spin = lay.spin * (0.92 + rnd() * 0.16);
      const ph2 = rnd();
      const colorAt = [0, 0, 0];
      const N = lay.samples;
      const cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N);
      const cw = new Float32Array(N), cu = new Float32Array(N);
      const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);

      for (let k = 0; k < N; k++) {
        const t = k / (N - 1);
        const r = r0 + len * Math.pow(t, 0.86);
        const th = th0 + curl * t + 0.16 * Math.sin(t * 5.2 + phase);
        const y = y0 * (1 - t * 0.55) +
          Math.sin(t * waveFreq * Math.PI + phase) * waveAmp * (0.25 + t * 0.75) +
          Math.sin(t * 33 + phase * 1.9) * lay.spread * 0.12;
        const braid = Math.sin(t * 24 + phase) * lay.spread * 0.34 + Math.sin(t * 41 + phase * 2.7) * lay.spread * 0.10;
        const x = Math.cos(th) * r + braid;
        const z = Math.sin(th) * r - braid * 0.6;

        // 颜色：核心白热 → 金 → 奶油 → 淡蓝尾迹
        const q = t;
        if (q < 0.20) mix3(colorAt, C_HOT, C_GOLD, q / 0.20);
        else if (q < 0.55) mix3(colorAt, C_GOLD, C_CREAM, (q - 0.20) / 0.35);
        else mix3(colorAt, C_CREAM, C_TIP, (q - 0.55) / 0.45);

        // 亮度沿纤维平滑变化（丝绸的光泽），不要逐点随机噪点
        const sheen = 0.80 + 0.24 * Math.sin(t * 9.0 + phase * 2.0);
        const bright = Math.max(0.0, 0.58 + 1.05 * Math.exp(-Math.pow((t - 0.34) / 0.26, 2)) - 0.62 * t) * brightBias * (lay.dim || 1) * sheen;
        // 根部饱满、向外逐渐收细变淡，像发丝而不是等粗的钢丝
        const taper = 0.18 + 0.95 * Math.pow(1 - t, 0.62);
        cx[k] = x; cy[k] = y * 0.68; cz[k] = z;
        cw[k] = lay.width * strandW * taper;
        cu[k] = t * lay.uf + ph2 * 6.283;
        cr[k] = colorAt[0] * bright * 1.78 * tint;
        cg[k] = colorAt[1] * bright * 1.22 * tint;
        cb[k] = colorAt[2] * bright * 0.50 * tint;

        // 伴随稀疏尘埃，补充纤维的厚度
        if (rnd() < 0.09) {
          const rr2 = r + (rnd() - 0.5) * lay.spread * 1.28;
          pushGold(
            Math.cos(th) * rr2,
            y * 0.68 + (rnd() - 0.5) * lay.spread * 0.55,
            Math.sin(th) * rr2,
            [colorAt[0] * bright * 0.24, colorAt[1] * bright * 0.22, colorAt[2] * bright * 0.20],
            lay.size * 0.45,
            spin
          );
        }
      }

      // 生成 ribbon 顶点：每个采样点两条边，顶点着色器里按切线展开成面向相机的带子
      const base = silkVerts;
      for (let k = 0; k < N; k++) {
        let ax, ay, az;
        if (k === 0) { ax = cx[1] - cx[0]; ay = cy[1] - cy[0]; az = cz[1] - cz[0]; }
        else if (k === N - 1) { ax = cx[N - 1] - cx[N - 2]; ay = cy[N - 1] - cy[N - 2]; az = cz[N - 1] - cz[N - 2]; }
        else { ax = cx[k + 1] - cx[k - 1]; ay = cy[k + 1] - cy[k - 1]; az = cz[k + 1] - cz[k - 1]; }
        const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        ax /= al; ay /= al; az /= al;
        for (let ss = 0; ss < 2; ss++) {
          silkCenter.push(cx[k], cy[k], cz[k]);
          silkTangent.push(ax, ay, az);
          silkSide.push(ss === 0 ? -1 : 1);
          silkWidth.push(cw[k]);
          silkColor.push(cr[k], cg[k], cb[k]);
          silkU.push(cu[k]);
          silkSpin.push(spin);
          silkPhase.push(ph2);
          silkVerts++;
        }
      }
      for (let k = 0; k < N - 1; k++) {
        const a = base + k * 2;
        silkIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    /* 三层发丝：核心密织 / 主纤维 / 外梢，均按螺旋流线生成 */
    const LAYERS = [
      { n: isLow ? 60 : 170, samples: isLow ? 44 : 52, len: 13, size: 0.62, spin: 2.4, spread: 0.35, curl: 1.28, width: 0.24, dim: 1.0, uf: 7.0 },
      { n: isLow ? 130 : 470, samples: isLow ? 76 : 96, len: 33, size: 0.85, spin: 1.3, spread: 0.85, curl: 1.02, width: 0.26, dim: 1.0, uf: 9.0 },
      { n: isLow ? 52 : 180, samples: isLow ? 140 : 180, len: 63, size: 0.44, spin: 0.72, spread: 1.50, curl: 0.82, width: 0.24, dim: 0.82, uf: 11.0 },
      { n: isLow ? 22 : 60, samples: isLow ? 160 : 210, len: 66, size: 0.35, spin: 0.42, spread: 3.10, curl: 1.60, width: 0.21, dim: 0.34, uf: 13.0 }
    ];
    for (let L = 0; L < LAYERS.length; L++) {
      const lay = LAYERS[L];
      for (let s2 = 0; s2 < lay.n; s2++) pushStream(lay);
    }

    /* 核心高亮团：额外一层极细密的金色尘埃，集中在巨引源附近 */
    const coreDust = isLow ? 1100 : (isMed ? 1500 : 1900);
    for (let i = 0; i < coreDust; i++) {
      const rr = Math.pow(rnd(), 1.7);
      const th = rnd() * TAU;
      const ph = Math.acos(2 * rnd() - 1);
      const x = Math.sin(ph) * Math.cos(th) * rr * CORE_RX * 0.92;
      const y = Math.cos(ph) * rr * CORE_RY * 0.78;
      const z = Math.sin(ph) * Math.sin(th) * rr * CORE_RZ * 0.92;
      const bright = (0.40 + rnd() * 0.45) * (1.05 - rr * 0.42);
      pushGold(x, y, z,
        [C_HOT[0] * bright, C_HOT[1] * bright, C_HOT[2] * bright],
        0.36 + rnd() * 0.42,
        2.9);
    }

    /* 星系点：沿发丝散布的小光点，数量多、尺寸小 */
    const galaxyCount = isLow ? 2000 : (isMed ? 3200 : 4200);
    const gPos = [], gCol = [], gSize = [], gSpin = [], gPhase = [];
    const goldCount = goldPos.length / 3;
    for (let i = 0; i < galaxyCount; i++) {
      // 沿已生成的发丝点云散布：挑一个金色粒子，再在附近抖动
      const src = Math.floor(rnd() * goldCount) * 3;
      const spread = 0.30 + rnd() * 1.25;
      const x = goldPos[src] + (rnd() - 0.5) * spread;
      const y = goldPos[src + 1] + (rnd() - 0.5) * spread * 0.7;
      const z = goldPos[src + 2] + (rnd() - 0.5) * spread;
      // 一部分是蓝色年轻星系，一部分是金色椭圆星系
      const blue = rnd() < 0.34;
      const c = blue ? C_TIP : C_CREAM;
      const b = 0.22 + rnd() * 0.30;
      gPos.push(x, y, z);
      gCol.push(c[0] * b, c[1] * b, c[2] * b);
      gSize.push(0.30 + Math.pow(rnd(), 2.0) * 0.55);
      gSpin.push(1.1);
      gPhase.push(rnd());
    }

    /* ============================================================
     * 2. 外围蓝色宇宙网：节点 + 细丝
     * ============================================================ */
    const webNodes = [];
    const WEB_N = isLow ? 8 : 16;
    for (let i = 0; i < WEB_N; i++) {
      const th = rnd() * TAU;
      const ph = Math.acos(2 * rnd() - 1);
      const rr = WEB_RADIUS * (0.42 + rnd() * 0.60);
      webNodes.push(new THREE.Vector3(
        Math.sin(ph) * Math.cos(th) * rr,
        Math.cos(ph) * rr * 0.55,
        Math.sin(ph) * Math.sin(th) * rr
      ));
    }
    function nearestNode(a, skip) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < webNodes.length; i++) {
        if (i === skip) continue;
        const d = a.distanceTo(webNodes[i]);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    const webPairs = [];
    const webPairKey = {};
    for (let i = 0; i < webNodes.length; i++) {
      const order = [];
      for (let j = 0; j < webNodes.length; j++) {
        if (j !== i) order.push([webNodes[i].distanceTo(webNodes[j]), j]);
      }
      order.sort(function (p, q) { return p[0] - q[0]; });
      for (let k = 0; k < Math.min(2, order.length); k++) {
        const j = order[k][1];
        const key = i < j ? i + ':' + j : j + ':' + i;
        if (webPairKey[key]) continue;
        webPairKey[key] = 1;
        webPairs.push([i, j]);
      }
    }

    const wPos = [], wCol = [], wSize = [], wSpin = [], wPhase = [];
    const webCount = isLow ? 14000 : (isMed ? 22000 : 32000);
    for (let p = 0; p < webPairs.length && wPos.length / 3 < webCount; p++) {
      const a = webNodes[webPairs[p][0]];
      const b = webNodes[webPairs[p][1]];
      const bend = 1.4 + a.distanceTo(b) * 0.10;
      const c1 = new THREE.Vector3(
        (a.x + b.x) * 0.5 + (rnd() - 0.5) * bend,
        (a.y + b.y) * 0.5 + (rnd() - 0.5) * bend,
        (a.z + b.z) * 0.5 + (rnd() - 0.5) * bend
      );
      const curve = new THREE.CatmullRomCurve3([a, c1, b]);
      const n = Math.round(420 + (isMed ? -80 : 0));
      for (let k = 0; k < n && wPos.length / 3 < webCount; k++) {
        const t = k / n;
        curve.getPoint(t, tmpC);
        const spread = 0.8 + Math.sin(t * Math.PI) * 0.9;
        const x = tmpC.x + (rnd() - 0.5) * spread;
        const y = tmpC.y + (rnd() - 0.5) * spread;
        const z = tmpC.z + (rnd() - 0.5) * spread;
        const mix = rnd();
        if (mix < 0.45) mix3(tmpCol, C_WEB_A, C_WEB_B, rnd());
        else mix3(tmpCol, C_WEB_B, C_WEB_C, rnd());
        const bri = (0.54 + rnd() * 0.80) * (0.6 + 0.4 * Math.sin(t * Math.PI));
        wPos.push(x, y, z);
        wCol.push(tmpCol[0] * bri, tmpCol[1] * bri, tmpCol[2] * bri);
        wSize.push(0.90 + Math.pow(rnd(), 2.4) * 1.75);
        wSpin.push(0.32);
        wPhase.push(rnd());
      }
    }
    // 节点：一小团蓝色星系，而不是一个点
    for (let i = 0; i < webNodes.length && wPos.length / 3 < webCount; i++) {
      const nn = webNodes[i];
      for (let k = 0; k < 70 && wPos.length / 3 < webCount; k++) {
        const rr = Math.pow(rnd(), 0.7) * 3.4;
        const th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1);
        const bri = (0.90 + rnd() * 1.2);
        wPos.push(
          nn.x + Math.sin(ph) * Math.cos(th) * rr,
          nn.y + Math.cos(ph) * rr * 0.7,
          nn.z + Math.sin(ph) * Math.sin(th) * rr
        );
        wCol.push(C_WEB_NODE[0] * bri, C_WEB_NODE[1] * bri, C_WEB_NODE[2] * bri);
        wSize.push(1.45 + rnd() * 2.10);
        wSpin.push(0.26);
        wPhase.push(rnd());
      }
    }

    /* ============================================================
     * 3. 远景星点
     * ============================================================ */
    const bgCount = isLow ? 1400 : (isMed ? 1900 : 2400);
    const bPos = [], bCol = [], bSize = [], bSpin = [], bPhase = [];
    for (let i = 0; i < bgCount; i++) {
      const th = rnd() * TAU;
      const ph = Math.acos(2 * rnd() - 1);
      const rr = 240 + rnd() * 620;
      const x = Math.sin(ph) * Math.cos(th) * rr;
      const y = Math.cos(ph) * rr;
      const z = Math.sin(ph) * Math.sin(th) * rr;
      const t = rnd();
      bPos.push(x, y, z);
      bCol.push(0.20 + t * 0.18, 0.28 + t * 0.16, 0.52 + t * 0.12);
      bSize.push(0.9 + Math.pow(rnd(), 4.0) * 2.6);
      bSpin.push(0.02);
      bPhase.push(rnd());
    }

    function makePoints(posArr, colArr, sizeArr, spinArr, phaseArr, fade) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(colArr), 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(sizeArr), 1));
      g.setAttribute('aSpin', new THREE.BufferAttribute(new Float32Array(spinArr), 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phaseArr), 1));
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uPR: { value: ctx.pixelRatio || 1 },
          uTime: { value: 0 },
          uFade: { value: fade }
        },
        vertexShader: VS,
        fragmentShader: FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = fade < 0.9 ? 1 : 2;
      return pts;
    }

    let silkMesh = null;

    const group = new THREE.Group();
    if (silkVerts > 0) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('aCenter', new THREE.BufferAttribute(new Float32Array(silkCenter), 3));
      sg.setAttribute('aTangent', new THREE.BufferAttribute(new Float32Array(silkTangent), 3));
      sg.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(silkSide), 1));
      sg.setAttribute('aWidth', new THREE.BufferAttribute(new Float32Array(silkWidth), 1));
      sg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(silkColor), 3));
      sg.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(silkU), 1));
      sg.setAttribute('aSpin', new THREE.BufferAttribute(new Float32Array(silkSpin), 1));
      sg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(silkPhase), 1));
      sg.setIndex(new THREE.BufferAttribute(new Uint32Array(silkIndex), 1));
      const sm = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0.155 },
          uWidthMul: { value: 1.0 }
        },
        vertexShader: SILK_VS,
        fragmentShader: SILK_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      silkMesh = new THREE.Mesh(sg, sm);
      silkMesh.frustumCulled = false;
      silkMesh.renderOrder = 3;
      group.add(silkMesh);
    }
    const webPts = makePoints(wPos, wCol, wSize, wSpin, wPhase, 0.72);
    const goldPts = makePoints(goldPos, goldCol, goldSize, goldSpin, goldPhase, 1.0);
    const galPts = makePoints(gPos, gCol, gSize, gSpin, gPhase, 0.95);
    const bgStars = makePoints(bPos, bCol, bSize, bSpin, bPhase, 0.55);
    group.add(webPts, goldPts, galPts);
    scene.add(group);
    scene.add(bgStars);

    /* ============================================================
     * 4. 核心发光：巨引源的白热光晕（两层 sprite）
     * ============================================================ */
    function glowTexture(inner, outer) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g2 = c.getContext('2d');
      const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(' + inner + ',1)');
      grad.addColorStop(0.22, 'rgba(' + inner + ',0.55)');
      grad.addColorStop(0.55, 'rgba(' + outer + ',0.14)');
      grad.addColorStop(1, 'rgba(' + outer + ',0)');
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('255,236,190', '255,150,50'),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.022
    }));
    halo.scale.set(22, 18, 1);
    halo.renderOrder = 2;
    scene.add(halo);

    const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('255,236,186', '255,148,44'),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.86
    }));
    coreGlow.scale.set(9.0, 7.5, 1);
    coreGlow.position.set(0, 0, 0);
    coreGlow.renderOrder = 3;
    scene.add(coreGlow);

    const coreHot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('255,255,246', '255,214,140'),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.92
    }));
    coreHot.scale.set(3.6, 3.0, 1);
    coreHot.renderOrder = 4;
    scene.add(coreHot);

    /* ============================================================
     * 5. 标签：拉尼亚凯亚 / 银河系 / 巨引源 / 室女座星系团
     * ============================================================ */
    const LABELS = [
      {
        key: 'great', name: '巨引源', en: 'GREAT ATTRACTOR', nameEn: 'Great Attractor', cls: '',
        pos: new THREE.Vector3(7.5, 6.5, -2.0),
        desc: '拉尼亚凯亚的引力中心，约 2.2 亿光年外。银河系正以约 600 km/s 向它运动。',
        descEn: 'The gravitational center of Laniakea, about 220 million light-years away. The Milky Way is falling toward it at roughly 600 km/s.'
      },
      {
        key: 'milky', name: '银河系', en: 'MILKY WAY', nameEn: 'Milky Way', cls: 'is-milky',
        pos: new THREE.Vector3(22.5, 6.8, 11.5),
        desc: '我们所在的星系，位于拉尼亚凯亚外缘的一条纤维上。图中红点即此。',
        descEn: 'Our own galaxy, on a filament at the outskirts of Laniakea. It is the red dot in this view.'
      },
      {
        key: 'virgo', name: '室女座星系团', en: 'VIRGO CLUSTER', nameEn: 'Virgo Cluster', cls: '',
        pos: new THREE.Vector3(9.0, -10.5, 30.0),
        desc: '离我们最近的星系团，约 5,400 万光年，包含上千个星系。',
        descEn: 'The nearest galaxy cluster to us, about 54 million light-years away, with more than a thousand galaxies.'
      },
      {
        key: 'title', name: '拉尼亚凯亚超星系团', en: 'LANIAKEA SUPERCLUSTER', nameEn: 'Laniakea Supercluster', cls: 'is-title',
        pos: new THREE.Vector3(-1.0, -16.0, 0),
        desc: '直径约 5.2 亿光年，约 10 万个星系；2014 年由星系流场定义。',
        descEn: 'About 520 million light-years across, containing roughly 100,000 galaxies. Defined in 2014 by the flow field of galaxies.'
      }
    ];

    const labelRoot = document.createElement('div');
    labelRoot.className = 'lka-labels';
    labelRoot.setAttribute('aria-hidden', 'true');
    if (ctx.section) ctx.section.appendChild(labelRoot);

    function buildLabel(item) {
      const el = document.createElement('div');
      el.className = 'lka-label ' + item.cls;
      const dot = document.createElement('span');
      dot.className = 'lka-dot';
      const txt = document.createElement('span');
      txt.className = 'lka-txt';
      const nm = document.createElement('b');
      nm.className = 'lka-name';
      nm.textContent = T(item.name, item.nameEn || item.en);
      const en = document.createElement('i');
      en.className = 'lka-en';
      en.textContent = T(item.en, item.name);
      txt.appendChild(nm);
      txt.appendChild(en);
      el.appendChild(dot);
      el.appendChild(txt);
      const tip = document.createElement('span');
      tip.className = 'lka-tip';
      tip.textContent = T(item.desc, item.descEn || item.desc);
      el.appendChild(tip);
      labelRoot.appendChild(el);
      item.el = el;
      item.tipEl = tip;
      item.active = false;
    }
    for (let i = 0; i < LABELS.length; i++) buildLabel(LABELS[i]);

    function hideTips(except) {
      for (let i = 0; i < LABELS.length; i++) {
        const L = LABELS[i];
        if (L === except) continue;
        L.active = false;
        L.el.classList.remove('is-open');
      }
    }

    function toggleLabel(L) {
      const on = !L.active;
      hideTips(L);
      L.active = on;
      L.el.classList.toggle('is-open', on);
    }

    const tmpAnchor = new THREE.Vector3();

    /* 锚点从结构空间 -> 世界空间再投影：与旋转/呼吸后的纤维严格同步 */
    function projectLabel(L, w, h) {
      tmpAnchor.copy(L.pos).applyMatrix4(group.matrixWorld);
      return U.project(camera, tmpAnchor, w, h);
    }

    /* 左侧文案安全区：标签不要压住正文 */
    function safeLeft(w) {
      if (w < 861) return 0;
      return Math.max(20, Math.min(w * 0.05, 96)) + Math.min(500, w * 0.43) + 12;
    }

    /* ============================================================
     * 6. 交互：环绕 / 滚轮缩放 / 点击标签
     * ============================================================ */
    const view = {
      yaw: 0.62, pitch: 0.30,
      vy: 0, vp: 0,
      dist: 112, distTarget: 112
    };
    const LIMIT = { pitch: 1.15, distMin: 56, distMax: 210 };
    const VIEW_SHIFT = { x: -0.072, y: 0.018 };

    function applyViewShift(w, h) {
      if (!camera.setViewOffset) return;
      const sx = Math.round(w * VIEW_SHIFT.x);
      const sy = Math.round(h * VIEW_SHIFT.y);
      camera.setViewOffset(w, h, sx, sy, w, h);
    }

    function reset() {
      view.yaw = 0.62;
      view.pitch = 0.30;
      view.distTarget = 112;
      view.vy = 0; view.vp = 0;
      hideTips(null);
    }

    function handleClick(click) {
      const w = ctx.width, h = ctx.height;
      let best = null, bestD = 46;
      for (let i = 0; i < LABELS.length; i++) {
        const s = projectLabel(LABELS[i], w, h);
        if (!s.visible) continue;
        const d = Math.hypot(s.x - click.x, s.y - click.y);
        if (d < bestD) { bestD = d; best = LABELS[i]; }
      }
      if (best) toggleLabel(best);
      else hideTips(null);
    }

    // 本场景被激活的累计时间：只随本章 update 增长，与页面全局时间解耦，
    // 使 01 章打开即处于「已卷起」的漩涡形态；之后随停留继续缓慢加深。
    let runTime = 0;

    function update(t, dt, p) {
      if (!isFinite(t)) t = 0;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.1) dt = 0.1;
      const inp = ctx.input;
      const rm = ctx.reduceMotion;
      const pp = U.ease.inOutSine(U.clamp(isFinite(p) ? p : 0, 0, 1));
      let pendingClick = null;

      if (inp) {
        const kk = inp.keys || {};
        if (inp.dragging && !inp.uiTarget) {
          view.yaw -= inp.dx * 0.0042;
          view.pitch = U.clamp(view.pitch + inp.dy * 0.0028, -LIMIT.pitch, LIMIT.pitch);
          view.vy = -inp.dx * 0.0042;
          view.vp = inp.dy * 0.0028;
        } else if (!inp.down) {
          view.yaw += view.vy;
          view.pitch = U.clamp(view.pitch + view.vp, -LIMIT.pitch, LIMIT.pitch);
          const decay = Math.exp(-dt * 3.4);
          view.vy *= decay;
          view.vp *= decay;
        }
        const kYaw = (kk.ArrowLeft || kk.a ? 1 : 0) - (kk.ArrowRight || kk.d ? 1 : 0);
        if (kYaw !== 0) {
          view.yaw += kYaw * 0.85 * dt;
          view.vy = kYaw * 0.85;
        }
        const kPitch = (kk.w ? 1 : 0) - (kk.s ? 1 : 0);
        if (kPitch !== 0) {
          view.pitch = U.clamp(view.pitch + kPitch * 0.55 * dt, -LIMIT.pitch, LIMIT.pitch);
          view.vp = kPitch * 0.55;
        }
        if (kk['+'] || kk['=']) view.distTarget = U.clamp(view.distTarget * Math.exp(-0.85 * dt), LIMIT.distMin, LIMIT.distMax);
        if (kk['-']) view.distTarget = U.clamp(view.distTarget * Math.exp(0.85 * dt), LIMIT.distMin, LIMIT.distMax);
        if (inp.pinch) view.distTarget = U.clamp(view.distTarget / (1 + inp.pinch * 0.9), LIMIT.distMin, LIMIT.distMax);
        if (inp.wheel) view.distTarget = U.clamp(view.distTarget * (1 + inp.wheel * 0.0013), LIMIT.distMin, LIMIT.distMax);
        if (inp.wheelCtrl) view.distTarget = U.clamp(view.distTarget * (1 + inp.wheelCtrl * 0.0014), LIMIT.distMin, LIMIT.distMax);
        if (inp.click) pendingClick = inp.click;
      }

      if (!rm) view.yaw += dt * 0.028;
      view.dist += (view.distTarget - view.dist) * Math.min(1, dt * 5.5);

      const camDist = view.dist * (1 - 0.085 * pp);
      camera.position.set(
        Math.sin(view.yaw) * Math.cos(view.pitch) * camDist,
        Math.sin(view.pitch) * camDist + 4.0,
        Math.cos(view.yaw) * Math.cos(view.pitch) * camDist
      );
      camera.lookAt(0, 1.0, 0);

      // 结构整体极缓慢地呼吸与自转
      const breathe = 1 + Math.sin(t * 0.17) * 0.006 + (rm ? 0 : Math.sin(t * 0.043) * 0.003);
      group.scale.setScalar(breathe);
      group.rotation.y = Math.sin(t * 0.01) * 0.05;

      // 标签投影先刷新本帧矩阵；否则会滞后一帧（拖动时表现为错位/发飘）
      group.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

      // 章内时间 + 预热：一打开就在「运行一段时间之后」的漩涡状态
      runTime += dt;
      const uT = runTime + SPIN_WARMUP;
      goldPts.material.uniforms.uTime.value = uT;
      galPts.material.uniforms.uTime.value = uT;
      webPts.material.uniforms.uTime.value = uT;
      bgStars.material.uniforms.uTime.value = uT;
      if (silkMesh) silkMesh.material.uniforms.uTime.value = uT;

      // 核心光晕：轻微心跳，保持克制
      const pulse = 1 + Math.sin(t * 0.55) * 0.018 + (rm ? 0 : Math.sin(t * 1.7) * 0.006);
      coreGlow.scale.set(9.0 * pulse, 7.5 * pulse, 1);
      coreHot.scale.set(3.6 * pulse, 3.0 * pulse, 1);
      coreGlow.material.opacity = 0.80 + Math.sin(t * 0.42) * 0.04;
      coreHot.material.opacity = 0.86 + Math.sin(t * 0.9) * 0.06;

      if (pendingClick) handleClick(pendingClick);

      // 标签跟随投影
      const w = ctx.width, h = ctx.height;
      const sl = safeLeft(w);
      for (let i = 0; i < LABELS.length; i++) {
        const L = LABELS[i];
        const s = projectLabel(L, w, h);
        if (!s.visible || s.x < sl || s.x > w - 12 || s.y < 8 || s.y > h - 8) {
          L.el.classList.remove('is-visible');
          continue;
        }
        const tr = 'translate3d(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px,0)';
        if (L.el.style.transform !== tr) L.el.style.transform = tr;
        if (!L.el.classList.contains('is-visible')) L.el.classList.add('is-visible');
      }
    }

    function resize(w, h) {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      applyViewShift(w, h);
      const pr = ctx.pixelRatio || 1;
      goldPts.material.uniforms.uPR.value = pr;
      galPts.material.uniforms.uPR.value = pr;
      webPts.material.uniforms.uPR.value = pr;
      bgStars.material.uniforms.uPR.value = pr;
    }
    resize(ctx.width, ctx.height);

    return {
      scene: scene,
      camera: camera,
      arrowKeys: true,
      update: update,
      resize: resize,
      reset: reset,
      bloom: { strength: 0.48, radius: 0.64, threshold: 0.84 },
      dispose: function () {
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material && o.material.dispose) o.material.dispose();
          if (o.material && o.material.map && o.material.map.dispose) o.material.map.dispose();
        });
        if (labelRoot && labelRoot.parentNode) labelRoot.parentNode.removeChild(labelRoot);
      }
    };
  });
})(window.COSMOS = window.COSMOS || {});
