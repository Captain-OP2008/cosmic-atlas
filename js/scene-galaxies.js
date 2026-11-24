/* ============================================================
 * COSMOS ATLAS · 07「星系动物园」— 三种星系形态（stage: galaxies）
 * v5：给三种形态补上体积——连续面是多层体积切片，核球是同心椭球壳
 * v4 重做：从「白色点云」升级为连续亮度场 + 尘埃吸收 + 分层点光
 * ------------------------------------------------------------
 * 旧版的问题：所有亮度都来自随机点，没有面（surface brightness），
 * 于是核球没有梯度、旋臂只是密度差、尘埃与 HII 不可辨。
 * v4 的遗留问题：连续面本质是一张水平平面、核球是永远正对相机的
 * Sprite，从侧面看整座星系像一张剪纸，完全没有厚度。
 *
 * 新版每一形态都是「体积切片 + 吸收层 + 点光」三层叠加：
 *
 *  体积的做法：
 *    · 连续面换成 N 层水平薄切片（单 BufferGeometry，一个 draw call）。
 *      顶点属性 aY（层高）/aW（层权重，Σ=1 保持总亮度），顶点着色器
 *      按 aY 做微小扭转与径向缩放；加法混合下多层 α 叠加 ≈ 沿视线
 *      方向的亮度积分，所以任何角度都能看到厚度，且亮度守恒。
 *    · 核球换成同心椭球壳（SphereGeometry + 法线·视线 pow 衰减），
 *      加法叠加成中心亮、边缘暗的体积发光体；不再用屏幕空间 Sprite。
 *    · 点云 y 分布同步加厚，与连续面一起构成真实的三维结构。
 *
 *  螺旋（spiral）
 *    · 盘面：9 层体积切片（全厚 0.40），在极坐标里解析计算
 *      对数螺旋臂（2 主 2 次）的内缘锐 / 外缘弥散、指数盘、双尺度核球；
 *      Canvas 噪声（可平铺 fbm）调制臂宽与结块，消除「数学光滑」。
 *    · 尘埃：单层 Plane，MultiplyBlending（dst = src·dst），只在旋臂
 *      内缘压出一条窄暗带 + 核球周围弥漫尘，形成「被咬掉」的轮廓。
 *    · 点光：盘上 2.6 万颗细星（臂上偏蓝、臂间偏黄）、核球 7 千颗、
 *      沿臂 12 个 HII 粉红云团（含青绿核）、26 颗亮星（含 8 颗前景星芒）、
 *      一个 M51 式伴星系（核 + 尘 + 潮汐桥）。
 *    · 核球：4 层同心椭球壳（压扁比 0.58–0.70）+ 1 层极淡外晕。
 *  椭圆（elliptical）
 *    · 面：Sérsic 式连续面（n≈2.5 核 + 平缓包层）+ 轻微等照度扭曲，
 *      颜色从中心暖黄白到外围橙红；12 层体积切片（全厚 1.55），
 *      点云只作颗粒感。
 *    · 外围 48 个球状星团（4–8px 软斑）+ 4 层核球椭球壳。
 *  不规则（irregular）
 *    · 面：4 团块 metaball 场 + 丝状噪声，9 层体积切片（全厚 1.15），
 *      蓝白年轻星 + 粉红 HII 巨团。
 *    · 暗尘埃与星桥连接、2 条潮汐尾（延伸约 1.7 倍主体）。
 *
 *  远景：18 个程序化小星系（1–4px 到 20px，跟相机走，避开中心 25° 锥），
 *        制造景深；星空沿用共享 starfield。
 *
 * 性能：所有几何 / 材质 / 纹理只建一次；三形态预建完毕，切换只改
 * uOpacity（320ms 交叉淡化）。update() 内零 new、零编译。
 * 预算：draw call ≈ 34（含过渡期两形态）、粒子 ≈ 7.4 万、三角 ≈ 3 千。
 *
 * 交互（与旧版一致）：
 *   拖拽 360° 环绕（yaw + pitch，松手惯性 ≤ 600ms）；双指 / Ctrl+滚轮 /
 *   +/- 缩放；←/→ 与 w/s 键盘环绕；1 / 2 / 3 切换形态；Esc / 复位回默认机位。
 *
 * 与 widget 的契约：COSMOS.state.galaxies = { type } 是唯一真源；
 * 外部（tabs）改 type → 这里检测到后交叉淡化，并 emit('galaxies:type')。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  const U = COSMOS.util;
  const PI = Math.PI;
  const TAU = PI * 2;

  const CFG = {
    fov: 38,
    yaw0: 0.56,
    pitch0: 0.60,      // 比旧版抬一点：30° 左右，旋臂结构才看得清
    dist0: 9.0,
    pitchMax: 1.34,
    distMin: 6.4,
    distMax: 15.8,
    autoSpin: 0.030,
    dragYaw: 0.0036,
    dragPitch: 0.0030,
    inertiaTau: 0.085,
    offX: 1.18,
    offAspect: 1.7,
    fade: 9.5,
    starCount: 4600
  };

  /* ---------------- 体积（厚度）参数 ----------------
   * 单层平面渲染永远像一张剪纸：从侧面看没有厚度、核球永远是贴片。
   * 这里把每种形态的连续面换成 N 层薄切片——加法混合下的多层 α 叠加
   * 近似「沿视线方向的亮度积分」，从任何角度都能看到厚度；再给核球
   * 换成同心椭球壳，得到真正的体积发光体。
   *   thick  = 全厚（world）；twist = 顶层相对底层的扭转（rad）；
   *   radial = 逐层径向缩放；layers = 切片数（按 quality 再缩放）。 */
  /* 体积切片参数。layers 必须够多：层间距在屏幕上 ≪ 盘面细结构的宽度，
   * 侧视时层与层才会融合成连续体；层太少会看到一条条平行亮带（片状纹理）。 */
  const VOL = {
    spiral: { layers: 28, thick: 0.40, twist: 0.030, radial: 0.012 },
    elliptical: { layers: 30, thick: 1.55, twist: 0.018, radial: 0.010 },
    irregular: { layers: 24, thick: 1.15, twist: 0.045, radial: 0.020 }
  };

  const QS = { high: 1.0, medium: 0.72, low: 0.48 };

  /* ---------------- 颜色（线性空间，由物理决定） ----------------
   * 核球 = K/G 老星（暖白 → 橙），旋臂 = O/B 年轻星（蓝白），
   * HII = Hα 656nm 发射线（粉红），尘埃 = 吸收后的红褐色。 */
  const STAR = {
    O: [0.58, 0.70, 1.00],
    B: [0.70, 0.80, 1.00],
    A: [0.86, 0.90, 1.00],
    F: [1.00, 0.98, 0.94],
    G: [1.00, 0.93, 0.78],
    K: [1.00, 0.80, 0.58],
    M: [1.00, 0.62, 0.40]
  };
  const CORE_A = [1.00, 0.84, 0.58];      // 核球中心
  const CORE_B = [1.00, 0.80, 0.58];      // 核球外缘
  const ARM_A = [0.56, 0.70, 1.00];       // 旋臂内缘（年轻蓝星）
  const ARM_B = [0.82, 0.88, 1.00];       // 旋臂外缘
  const HII_PINK = [1.00, 0.34, 0.44];
  const HII_TEAL = [0.30, 0.85, 0.80];
  const DUST_BROWN = [0.30, 0.22, 0.17];
  const ELL_A = [1.00, 0.86, 0.66];
  const ELL_B = [1.00, 0.66, 0.40];
  const IRR_A = [0.16, 0.19, 0.30];
  const IRR_B = [0.30, 0.34, 0.48];

  /* ---------------- 螺旋盘参数（JS 与 GLSL 必须一致） ---------------- */
  const SP = {
    RP: 2.70,          // 盘面 Plane 半宽（world）
    RM: 2.52,          // 星系盘半径（world）
    K: 2.05,           // 对数螺旋缠绕系数
    R0: 0.24,          // 螺旋起始半径
    W0: 0.085,         // 臂宽基准（弧度）
    W1: 0.190,         // 臂宽随半径增长
    ARMS: [
      { ph: 0.0, g: 1.00 },
      { ph: PI, g: 1.00 },
      { ph: PI * 0.5, g: 0.62 },
      { ph: PI * 1.5, g: 0.62 }
    ]
  };
  const armBase = function (r) {
    return SP.K * Math.log(Math.max(r, SP.R0 * 0.55) / SP.R0);
  };
  const armW = function (r) { return SP.W0 + SP.W1 * (r / SP.RM); };

  /* ---------------- 椭圆盘参数 ---------------- */
  const EL = { RE: 2.25, AXIS: 0.62, TILT: [0.58, 0.26, -0.18] };

  /* ---------------- 不规则团块（world，盘面内 x/z） ---------------- */
  const IR = {
    RP: 3.90,
    BLOBS: [
      { x: -0.20, z: 0.10, r: 0.68, a: 1.00 },
      { x: 1.02, z: -0.60, r: 0.50, a: 0.92 },
      { x: -1.02, z: -0.44, r: 0.44, a: 0.80 },
      { x: 0.34, z: 0.96, r: 0.42, a: 0.72 },
      { x: 0.62, z: 0.30, r: 0.30, a: 0.64 },
      { x: -0.56, z: 0.64, r: 0.26, a: 0.56 },
      { x: 1.26, z: 0.26, r: 0.22, a: 0.50 }
    ],
    TILT: [0.30, -0.40, 0.16]
  };

  /* ============================================================
   * 着色器
   * ============================================================ */

  /* 点：精确像素尺寸（gl_PointSize = 世界直径 × 投影尺度 / 深度） */
  const VERT_POINT = `
    attribute vec3  aColor;
    attribute float aSize;
    attribute float aAlpha;
    attribute float aPhase;
    attribute float aRot;
    uniform float uTime;
    uniform float uProjScale;
    uniform float uOpacity;
    uniform float uSizeMul;
    uniform float uMinPx;
    uniform float uTwinkle;
    varying vec3  vColor;
    varying float vAlpha;
    varying float vRot;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float tw = 1.0;
      if (uTwinkle > 0.5) {
        tw = 0.84 + 0.16 * sin(uTime * 2.1 + aPhase * 53.0);
      }
      float px = aSize * uSizeMul * uProjScale / max(-mv.z, 0.08);
      gl_PointSize = max(uMinPx, px) * tw;
      vColor = aColor;
      vAlpha = aAlpha * uOpacity;
      vRot = aRot;
    }
  `;

  /* 点：纹理（HII 云 / 亮星 / 远景星系） */
  const FRAG_ADDTEX = `
    uniform sampler2D uTex;
    uniform float uGain;
    varying vec3  vColor;
    varying float vAlpha;
    varying float vRot;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float s = sin(vRot), co = cos(vRot);
      vec2 rc = vec2(co * c.x - s * c.y, s * c.x + co * c.y);
      vec4 t = texture2D(uTex, rc + 0.5);
      float a = t.a * vAlpha;
      if (a < 0.002) discard;
      gl_FragColor = vec4(t.rgb * vColor * uGain, a);
    }
  `;

  /* 点：程序化软斑（球状星团 / 核球星点） */
  const FRAG_ADDSOFT = `
    uniform float uGain;
    uniform float uSoftPow;
    varying vec3  vColor;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float a = pow(max(0.0, 1.0 - d), uSoftPow);
      if (a < 0.002) discard;
      gl_FragColor = vec4(vColor * uGain, a * vAlpha);
    }
  `;

  /* ---------------- 螺旋盘面 ----------------
   * delta > 0 一侧朝向星系中心 = 旋臂内缘（锐）；delta < 0 = 外缘（弥散）。
   * 尘埃带在 delta ≈ +0.60·w 处，即紧贴内缘的凹侧。 */
  const FRAG_SPIRAL = `
    precision highp float;
    uniform sampler2D uNoise;
    uniform float uOpacity;
    uniform float uRP;
    uniform float uRM;
    uniform float uK;
    uniform float uR0;
    uniform float uW0;
    uniform float uW1;
    uniform vec3  uCoreA;
    uniform vec3  uCoreB;
    uniform vec3  uArmA;
    uniform vec3  uArmB;
    varying vec2 vUv;
    varying float vW;

    #define PI 3.14159265359
    #define TAU 6.28318530718

    float wrapPi(float a) { return mod(a + PI, TAU) - PI; }

    float lobe(float d, float w, float gn) {
      float s = d > 0.0 ? 0.55 : 1.70;
      float x = d / (w * s);
      // 指数 2.3：比高斯更陡，臂外缘出现"丝状锐边"而不是棉花雾
      return gn * exp(-pow(abs(x), 2.30));
    }

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p) * uRP;
      if (r > uRM * 1.07) discard;
      float ang = atan(-p.y, p.x);
      float rn = clamp(r / uRM, 0.0, 1.0);
      float base = uK * log(max(r, uR0 * 0.55) / uR0);

      float nA = texture2D(uNoise, p * 0.55 + vec2(0.13, 0.41)).r;
      float nB = texture2D(uNoise, p * 1.85 + vec2(0.47, 0.19)).g;
      float nC = texture2D(uNoise, p * 4.60 + vec2(0.07, 0.63)).b;
      float nD = texture2D(uNoise, p * 12.0 + vec2(0.55, 0.29)).g;
      float nE = texture2D(uNoise, p * 0.21 + vec2(0.31, 0.77)).a;

      float fw = 0.62 + 0.66 * nA + 0.38 * nB;
      float w = (uW0 + uW1 * rn) * fw;

      float armSum =
          lobe(wrapPi(ang - base), w, 1.0)
        + lobe(wrapPi(ang - base - PI), w, 1.0)
        + lobe(wrapPi(ang - base - PI * 0.5), w, 0.60)
        + lobe(wrapPi(ang - base - PI * 1.5), w, 0.60);

      // 沿臂的高频碎块（photo-real 关键：臂不能是光滑喷绘带）
      float streak = 0.85 + 0.15 * texture2D(uNoise, p * 6.5 + vec2(0.23, 0.51)).g;
      float clump = 0.74 + 0.34 * nC + 0.16 * nB + 0.10 * nD;
      // 2 条 spur：只在半径带内出现的短分叉臂
      float spurW = w * 1.15;
      float spur = lobe(wrapPi(ang - base - 1.05), spurW, 0.52)
                   * smoothstep(1.00, 1.45, r) * smoothstep(2.35, 1.75, r)
                 + lobe(wrapPi(ang - base - PI - 2.35), spurW * 0.90, 0.44)
                   * smoothstep(1.55, 1.95, r) * smoothstep(2.45, 2.00, r);
      float armAll = armSum + spur;

      // 峰值压到 ~1.0 以内：超过 1 会被 ACES 压成纯白并吃掉细节与颜色
      float arms = min(armAll, 1.15) * clump * streak * 0.62 * smoothstep(0.05, 0.28, r);
      arms *= smoothstep(uRM * 1.02, uRM * 0.74, r);
      float hot = smoothstep(0.70, 0.97, nC) * smoothstep(0.34, 0.90, nB)
                * min(armSum, 1.10);

      // 核球：主体由体积壳层承担，这里只留平坦底子（×0.45），
      // 避免切片把中心拉成一条竖直的糊条
      float bulge = 1.64 * exp(-pow(r / 0.155, 1.50))
                  + 0.18 * exp(-pow(r / 0.300, 1.15))
                  + 0.0135 * exp(-pow(r / 0.95, 1.05));
      float disk = 0.050 * exp(-r / 0.62) + 0.038 * exp(-r / 0.20);
      // 盘底弥散光：让盘面是实心圆盘，而不是"只有臂的空心结构"（只到 1.95，外侧留黑）
      float floorDisk = 0.045 * smoothstep(1.95, 1.05, r);

      vec3 coreCol = mix(uCoreA, uCoreB, smoothstep(0.05, 1.40, r));
      vec3 armCol = mix(uArmA, uArmB, clamp(0.30 + 0.62 * nA + 0.18 * nD, 0.0, 1.0));
      vec3 col = coreCol * (bulge + disk) + armCol * arms;
      col += vec3(0.72, 0.80, 1.00) * floorDisk;
      col += vec3(0.70, 0.83, 1.00) * hot * 0.55;
      col *= 0.84 + 0.30 * nE;

      // 外缘连续面 alpha ×0.75：把"白色羽毛/霜"压成细丝
      float fringe = mix(0.75, 1.0, smoothstep(uRM * 0.92, uRM * 0.50, r));
      // ×1.15：多层切片把细结构在屏幕上摊开，峰值会略降，这里补回一点亮度
      float a = uOpacity * fringe * smoothstep(uRM * 1.03, uRM * 0.90, r) * vW * 1.15;
      gl_FragColor = vec4(col, a);
    }
  `;

  /* ---------------- 螺旋尘埃（乘法吸收层） ----------------
   * dst = src·dst；没有尘埃的地方输出纯白 = 不改变画面。 */
  const FRAG_SPIRAL_DUST = `
    precision highp float;
    uniform sampler2D uNoise;
    uniform float uOpacity;
    uniform float uRP;
    uniform float uRM;
    uniform float uK;
    uniform float uR0;
    uniform float uW0;
    uniform float uW1;
    uniform vec3  uDustCol;
    varying vec2 vUv;
    varying float vW;

    #define PI 3.14159265359
    #define TAU 6.28318530718

    float wrapPi(float a) { return mod(a + PI, TAU) - PI; }

    float lane(float d, float w, float gn) {
      float dl = d - 0.35 * w;                       // 旋臂内缘一侧
      float x = dl / (0.46 * w + 0.016);             // 宽 0.08–0.19 world（更宽更软）
      return gn * exp(-x * x);
    }

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p) * uRP;
      if (r > uRM * 1.07) discard;
      float ang = atan(-p.y, p.x);
      float rn = clamp(r / uRM, 0.0, 1.0);
      float base = uK * log(max(r, uR0 * 0.55) / uR0);

      float nA = texture2D(uNoise, p * 0.55 + vec2(0.13, 0.41)).r;
      float nB = texture2D(uNoise, p * 1.85 + vec2(0.47, 0.19)).g;
      float nC = texture2D(uNoise, p * 4.60 + vec2(0.07, 0.63)).b;
      float nD = texture2D(uNoise, p * 9.50 + vec2(0.61, 0.11)).g;

      float fw = 0.62 + 0.66 * nA + 0.38 * nB;
      float w = (uW0 + uW1 * rn) * fw;

      // 宽度抖动 + 丝状：暗带既不能是等宽弧线，也不能是光滑灰带
      float wj = w * (0.62 + 0.85 * nD);
      float dl =
          lane(wrapPi(ang - base), wj, 1.0)
        + lane(wrapPi(ang - base - PI), wj, 1.0)
        + lane(wrapPi(ang - base - PI * 0.5), wj, 0.58)
        + lane(wrapPi(ang - base - PI * 1.5), wj, 0.58)
        // 2 条短支臂内缘的暗带
        + lane(wrapPi(ang - base - 1.05), wj * 1.15, 0.60)
            * smoothstep(1.02, 1.42, r) * smoothstep(2.40, 1.80, r)
        + lane(wrapPi(ang - base - PI - 2.35), wj * 1.15, 0.60)
            * smoothstep(1.02, 1.42, r) * smoothstep(2.40, 1.80, r);

      // 丝状结构：暗带必须断断续续，否则侧视时像画在平面上的细弧
      float fil = 0.20 + 1.30 * nC + 0.62 * nD;
      float dust = clamp(dl * 1.25 * fil, 0.0, 1.0);
      dust += 0.045 * exp(-r / 1.05) * smoothstep(0.22, 0.90, r) * nB;
      dust *= smoothstep(0.08, 0.42, r);            // 核心区不能吃掉核球
      dust *= smoothstep(uRM * 1.04, uRM * 0.84, r);
      dust *= uOpacity * vW;

      // NormalBlending：暗色 + alpha=吸收度（MultiplyBlending 在本管线 HDR 缓冲上不生效）
      float absorb = clamp(dust * 0.92, 0.0, 0.66);
      gl_FragColor = vec4(uDustCol, absorb);
    }
  `;

  /* ---------------- 椭圆：Sérsic 式连续面 ---------------- */
  const FRAG_ELLIPTICAL = `
    precision highp float;
    uniform sampler2D uNoise;
    uniform float uOpacity;
    uniform float uRP;
    uniform vec3  uColA;
    uniform vec3  uColB;
    varying vec2 vUv;
    varying float vW;

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec2 wp = vec2(p.x, -p.y) * uRP;
      float ang = atan(wp.y, wp.x);
      float twist = 1.0 + 0.055 * sin(2.0 * ang + 0.7)
                        + 0.025 * sin(4.0 * ang - 1.15);
      float e = length(vec2(wp.x, wp.y / 0.62)) * twist;

      float n1 = texture2D(uNoise, p * 0.42).r;
      float n2 = texture2D(uNoise, p * 1.35).g;

      // Sérsic n≈4（Re≈0.70 world）：中心极亮、外缘指数衰减，边缘干净渐隐
      float xs = max(e, 0.015) / 0.70;
      float I = 1.30 * exp(-7.67 * (pow(xs, 0.25) - 1.0));
      I += 0.30 * exp(-e / 1.35);
      I = min(I, 3.0);
      I *= 0.90 + 0.16 * n1 + 0.08 * n2;

      float cut = smoothstep(2.45, 1.55, e);

      vec3 col = mix(uColA, uColB, smoothstep(0.0, 1.90, e));
      gl_FragColor = vec4(col * I, uOpacity * cut * vW);
    }
  `;

  /* ---------------- 椭圆：极淡同心尘埃带（乘法吸收层，M87 那种） ---------------- */
  const FRAG_ELL_DUST = `
    precision highp float;
    uniform sampler2D uNoise;
    uniform float uOpacity;
    uniform float uRP;
    uniform vec3  uDustCol;
    varying vec2 vUv;

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec2 wp = vec2(p.x, -p.y) * uRP;
      float ang = atan(wp.y, wp.x);
      float twist = 1.0 + 0.055 * sin(2.0 * ang + 0.7);
      float e = length(vec2(wp.x, wp.y / 0.62)) * twist;
      float n1 = texture2D(uNoise, p * 0.70 + vec2(0.31, 0.11)).r;
      float n2 = texture2D(uNoise, p * 2.30 + vec2(0.13, 0.57)).b;
      e += 0.16 * (n1 - 0.5) + 0.06 * (n2 - 0.5);      // 环带不许是规整的同心圆
      float wj = 0.60 + 0.80 * n2;                      // 宽度 ±40% 抖动
      float band = exp(-pow((e - 0.62) / (0.070 * wj), 2.0))
                 + exp(-pow((e - 1.02) / (0.085 * wj), 2.0)) * 0.75
                 + exp(-pow((e - 1.46) / (0.110 * wj), 2.0)) * 0.55;
      band *= smoothstep(0.16, 0.42, e);
      // 用 fbm 把环带切成 3–5 段不连续的弧
      float arc = texture2D(uNoise, vec2(ang * 0.36 + 0.5, e * 0.42 + 0.20)).g;
      band *= smoothstep(0.35, 0.75, arc);
      float dust = clamp(band * 1.35, 0.0, 1.0) * uOpacity;
      vec3 col = mix(vec3(1.0), uDustCol, dust * 0.28);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  /* ---------------- 不规则：4 团块 metaball ---------------- */
  const FRAG_IRREG = `
    precision highp float;
    uniform sampler2D uNoise;
    uniform float uOpacity;
    uniform float uRP;
    uniform vec4  uB0;
    uniform vec4  uB1;
    uniform vec4  uB2;
    uniform vec4  uB3;
    uniform vec4  uB4;
    uniform vec4  uB5;
    uniform vec4  uB6;
    uniform vec3  uColA;
    uniform vec3  uColB;
    uniform vec3  uColC;
    varying vec2 vUv;
    varying float vW;

    float blobF(vec2 p, vec4 b) {
      vec2 d = (p - b.xy) / b.z;
      return b.w * exp(-dot(d, d) * 1.15);
    }

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec2 wp = vec2(p.x, -p.y) * uRP;

      float n1 = texture2D(uNoise, p * 0.42 + vec2(0.20, 0.60)).r;
      float n2 = texture2D(uNoise, p * 1.60).g;
      float n3 = texture2D(uNoise, p * 3.70).b;
      float nB = texture2D(uNoise, wp * 0.48 + vec2(0.37, 0.71)).r;   // 团块级 fbm（约 1 world 尺度）

      float f = blobF(wp, uB0) + blobF(wp, uB1) + blobF(wp, uB2) + blobF(wp, uB3)
              + blobF(wp, uB4) + blobF(wp, uB5) + blobF(wp, uB6);
      f *= 1.0 + 0.55 * (n1 - 0.5) + 0.25 * (n2 - 0.5);
      float body = pow(smoothstep(0.030, 0.58, f), 1.20);
      body *= smoothstep(1.05, 0.72, length(wp) / 1.60);   // 收边：去掉外围毛绒
      body *= 0.65 + 0.35 * nB;                            // 雾要有团块起伏，不能是均匀灰雾

      float pink = smoothstep(0.72, 0.98, n2) * smoothstep(0.30, 0.80, f);
      vec3 col = mix(uColA, uColB, clamp(n1 * 0.85, 0.0, 1.0));
      col = mix(col, uColC, pink * 0.28);
      col *= 0.85 + 1.55 * n3;

      // ×0.80：体积切片把团块亮度摊到更多像素上，略提补偿
      gl_FragColor = vec4(col, body * uOpacity * 0.80 * vW);
    }
  `;

  /* ---------------- 不规则尘埃（乘法吸收层） ---------------- */
  const FRAG_IRREG_DUST = `
    precision highp float;
    uniform sampler2D uNoise;
    uniform float uOpacity;
    uniform float uRP;
    uniform vec4  uB0;
    uniform vec4  uB1;
    uniform vec4  uB2;
    uniform vec4  uB3;
    uniform vec4  uB4;
    uniform vec4  uB5;
    uniform vec4  uB6;
    uniform vec3  uDustCol;
    varying vec2 vUv;

    float blobF(vec2 p, vec4 b) {
      vec2 d = (p - b.xy) / b.z;
      return b.w * exp(-dot(d, d) * 1.15);
    }

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec2 wp = vec2(p.x, -p.y) * uRP;
      float n1 = texture2D(uNoise, p * 0.55 + vec2(0.7, 0.1)).r;
      float n2 = texture2D(uNoise, p * 1.90 + vec2(0.3, 0.5)).b;

      float f = blobF(wp, uB0) + blobF(wp, uB1) + blobF(wp, uB2) + blobF(wp, uB3)
              + blobF(wp, uB4) + blobF(wp, uB5) + blobF(wp, uB6);
      float mask = smoothstep(0.030, 0.16, f);
      float dust = smoothstep(0.40, 0.70, n1 * 0.8 + n2 * 0.6) * mask * 0.13;

      // 3 条弯曲、断续的暗带：中心线用正弦 + fbm 扰动，宽度沿程不均匀，边缘 fbm 打碎成絮状
      float along1 = dot(wp, vec2(0.94, 0.34));
      float off1 = dot(wp, vec2(-0.34, 0.94));
      off1 -= 0.035 - 0.075 * sin(along1 * 2.4 + 1.7)
            + 0.100 * (texture2D(uNoise, vec2(along1 * 0.26 + 0.13, 0.41)).g - 0.5);
      float w1 = 0.11 + 0.07 * (texture2D(uNoise, vec2(along1 * 0.19 + 0.57, 0.83)).r - 0.5) * 2.0;
      float b1 = exp(-pow(off1 / max(w1, 0.055), 2.0));

      float along2 = dot(wp, vec2(-0.42, 0.91));
      float off2 = dot(wp, vec2(-0.91, -0.42));
      off2 -= -0.030 + 0.080 * sin(along2 * 2.9 + 4.1)
            + 0.110 * (texture2D(uNoise, vec2(along2 * 0.24 + 0.69, 0.17)).g - 0.5);
      float w2 = 0.13 + 0.07 * (texture2D(uNoise, vec2(along2 * 0.21 + 0.07, 0.53)).r - 0.5) * 2.0;
      float b2 = exp(-pow(off2 / max(w2, 0.060), 2.0));

      float along3 = dot(wp, vec2(0.60, -0.80));
      float off3 = dot(wp, vec2(0.80, 0.60));
      off3 -= 0.060 + 0.065 * sin(along3 * 2.1 + 5.6)
            + 0.090 * (texture2D(uNoise, vec2(along3 * 0.29 + 0.44, 0.75)).g - 0.5);
      float w3 = 0.10 + 0.055 * (texture2D(uNoise, vec2(along3 * 0.23 + 0.31, 0.09)).r - 0.5) * 2.0;
      float b3 = exp(-pow(off3 / max(w3, 0.050), 2.0)) * 0.85;

      float nBreak = texture2D(uNoise, wp * 2.35 + vec2(0.21, 0.63)).r;
      float bands = clamp(b1 + b2 + b3, 0.0, 1.0);
      bands *= smoothstep(0.42, 0.72, nBreak * 0.75 + n1 * 0.45);
      dust = max(dust, bands * 0.86 * mask);
      dust *= uOpacity;

      float a = clamp(dust, 0.0, 0.66);
      gl_FragColor = vec4(uDustCol, a);   // NormalBlending：直接压暗（Multiply 在本管线 HDR 缓冲上不生效）
    }
  `;

  /* ---------------- 不规则：潮汐尾淡雾带（加法，cloudTexture 打碎） ---------------- */
  const FRAG_TAIL = `
    precision highp float;
    uniform sampler2D uTex;
    uniform float uOpacity;
    uniform vec3  uCol;
    varying vec2 vUv;

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float t = clamp(p.x * 0.5 + 0.5, 0.0, 1.0);            // 0 = 尾根，1 = 尾梢
      float w = 0.62 * (1.0 - 0.55 * t);                      // 宽度向尾梢收窄
      float band = exp(-pow(p.y / w, 2.0));
      float cl = texture2D(uTex, vec2(0.03 + vUv.x * 0.94, 0.05 + vUv.y * 0.90)).a;
      float a = band * smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.58, 1.0, t));
      a *= (0.30 + 1.30 * cl) * uOpacity;
      gl_FragColor = vec4(uCol, a);
    }
  `;

  const VERT_UV = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  /* ---------------- 体积切片顶点 ----------------
   * aY = 层高（-1 底 / +1 顶），aW = 该层权重（Σ=1，保证总亮度不变）。
   * 按层高做微小扭转 + 径向缩放：各层图案错开，厚度才不会像千层饼。 */
  const VERT_STACK = `
    attribute float aY;
    attribute float aW;
    uniform float uTwist;
    varying vec2 vUv;
    varying float vW;
    void main() {
      vUv = uv;
      vW = aW;
      float ang = aY * uTwist;
      float c = cos(ang), s = sin(ang);
      vec3 p = position;
      p.xz = mat2(c, -s, s, c) * p.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;

  /* ---------------- 核球椭球壳 ----------------
   * 正面渲染的椭球面，亮度按法线与视线夹角衰减；多层同心壳加法叠加
   * ⇒ 中心亮、边缘暗的发光体，从任何角度看都随视角正确改变形状。 */
  const VERT_SHELL = `
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `;
  const FRAG_SHELL = `
    uniform vec3  uColor;
    uniform float uOpacity;
    uniform float uA;
    uniform float uPow;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float f = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
      float a = pow(f, uPow) * uA * uOpacity;
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor, a);
    }
  `;

  /* ============================================================
   * 程序化纹理
   * ============================================================ */
  function hash2(x, y, s) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function vnoise(ix, iy, G, s) {
    const x0 = ((ix % G) + G) % G;
    const y0 = ((iy % G) + G) % G;
    return hash2(x0, y0, s);
  }
  function pnoise(x, y, G, s) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = vnoise(ix, iy, G, s), b = vnoise(ix + 1, iy, G, s);
    const c = vnoise(ix, iy + 1, G, s), d = vnoise(ix + 1, iy + 1, G, s);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }
  function fbm(u, v, G0, oct, s) {
    let sum = 0, amp = 0.5, G = G0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * pnoise(u * G, v * G, G, s + o * 977);
      norm += amp;
      amp *= 0.5;
      G *= 2;
    }
    return sum / norm;
  }

  function makeNoiseTexture(size) {
    const t = COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      const img = g.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        const v = y / h;
        for (let x = 0; x < w; x++) {
          const u = x / w;
          const i = (y * w + x) * 4;
          const a = fbm(u, v, 5, 4, 101);
          const b = fbm(u, v, 11, 4, 211);
          const cr = fbm(u, v, 7, 4, 307);
          const ridge = 1.0 - Math.abs(cr * 2.0 - 1.0);
          d[i] = a * 255;
          d[i + 1] = b * 255;
          d[i + 2] = ridge * 255;
          d[i + 3] = hash2(x, y, 401) * 255;
        }
      }
      g.putImageData(img, 0, 0);
    }, { wrap: true });
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  function makeCoreTexture(size) {
    return COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      grd.addColorStop(0.00, 'rgba(255,255,255,1)');
      grd.addColorStop(0.06, 'rgba(255,255,255,0.90)');
      grd.addColorStop(0.14, 'rgba(255,255,255,0.62)');
      grd.addColorStop(0.26, 'rgba(255,255,255,0.34)');
      grd.addColorStop(0.42, 'rgba(255,255,255,0.15)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.055)');
      grd.addColorStop(0.82, 'rgba(255,255,255,0.014)');
      grd.addColorStop(1.00, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
  }

  function makeHaloTexture(size) {
    return COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      grd.addColorStop(0.00, 'rgba(255,255,255,0.55)');
      grd.addColorStop(0.18, 'rgba(255,255,255,0.34)');
      grd.addColorStop(0.38, 'rgba(255,255,255,0.17)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.065)');
      grd.addColorStop(0.84, 'rgba(255,255,255,0.016)');
      grd.addColorStop(1.00, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
  }

  function makeCloudTexture(size) {
    return COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      const img = g.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        const v = y / h;
        for (let x = 0; x < w; x++) {
          const u = x / w;
          const i = (y * w + x) * 4;
          const nx = u - 0.5, ny = v - 0.5;
          const rad = Math.sqrt(nx * nx + ny * ny) * 2.0;
          const n = fbm(u, v, 4, 4, 733);
          const core = Math.max(0, 1.0 - rad);
          let a = (0.30 + 1.35 * n) * Math.pow(core, 1.6);
          a = Math.min(1, Math.max(0, a * 1.15));
          d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
          d[i + 3] = a * 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
  }

  function makeStarTexture(size) {
    return COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      const img = g.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const nx = (x + 0.5) / w - 0.5;
          const ny = (y + 0.5) / h - 0.5;
          const r2 = nx * nx + ny * ny;
          const core = Math.exp(-r2 / 0.0075);
          const halo = Math.exp(-r2 / 0.055) * 0.22;
          const sx = Math.exp(-(ny * ny) / 0.00055) * Math.exp(-(nx * nx) / 0.115) * 0.42;
          const sy = Math.exp(-(nx * nx) / 0.00055) * Math.exp(-(ny * ny) / 0.115) * 0.42;
          const a = Math.min(1, core + halo + sx + sy);
          // 星芒略偏冷、核心偏白
          d[i] = 255;
          d[i + 1] = 244 + 11 * Math.min(1, core);
          d[i + 2] = 255;
          d[i + 3] = a * 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
  }

  function makeGalaxyTexture(size) {
    return COSMOS.tex.canvasTexture(size, size, function (g, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      g.clearRect(0, 0, w, h);
      g.save();
      g.translate(cx, cy);
      g.rotate(-0.42);
      g.scale(1.0, 0.56);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.48);
      grd.addColorStop(0.00, 'rgba(255,252,244,1)');
      grd.addColorStop(0.12, 'rgba(255,240,214,0.92)');
      grd.addColorStop(0.28, 'rgba(236,226,212,0.55)');
      grd.addColorStop(0.52, 'rgba(196,206,232,0.26)');
      grd.addColorStop(0.76, 'rgba(170,190,230,0.07)');
      grd.addColorStop(1.00, 'rgba(160,180,220,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(0, 0, w * 0.5, 0, TAU);
      g.fill();
      // 两道极淡的旋臂弧
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(190,214,255,0.20)';
      g.lineWidth = w * 0.055;
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        const off = k * PI;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const rr = w * (0.10 + 0.36 * t);
          const th = off + t * 3.6;
          const px = Math.cos(th) * rr;
          const py = Math.sin(th) * rr;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }
      g.restore();
    });
  }

  /* ============================================================
   * Stage
   * ============================================================ */
  COSMOS.registerStage('galaxies', function (ctx) {
    U.reseed(0x6A1A5E);
    const isLow = ctx.quality === 'low';
    const qs = QS[ctx.quality] || 1;
    const rnd = mulberry32(isLow ? 907 : 1337);
    const rc = function (n) { return Math.max(16, Math.round(n * qs)); };

    const scene = new THREE.Scene();
    const camera = U.makeCamera(CFG.fov, ctx.aspect || 1);
    camera.near = 0.1;
    camera.far = 400;

    /* 形态真源：唯一真源在 COSMOS.state.galaxies */
    const GS = COSMOS.state.galaxies || (COSMOS.state.galaxies = { type: 'spiral' });
    if (GS.type !== 'elliptical' && GS.type !== 'irregular') GS.type = 'spiral';
    let curType = GS.type;

    /* 共享 uniform（同一对象被所有材质引用：每帧只写一次） */
    const SH = {
      uTime: { value: 0 },
      uProjScale: { value: 600 },
      uMinPx: { value: 1 }
    };

    /* ---------------- 纹理（一次性） ---------------- */
    const texNoise = makeNoiseTexture(isLow ? 128 : 256);
    const texCore = makeCoreTexture(256);
    const texHalo = makeHaloTexture(256);
    const texCloud = makeCloudTexture(256);
    const texStar = makeStarTexture(128);
    const texGalaxy = makeGalaxyTexture(128);
    const allTextures = [texNoise, texCore, texHalo, texCloud, texStar, texGalaxy];

    /* ---------------- 点云缓冲 ---------------- */
    function newBuf() {
      return { p: [], c: [], s: [], a: [], ph: [], rt: [], n: 0 };
    }
    function addP(b, x, y, z, col, size, alpha, rot) {
      b.p.push(x, y, z);
      b.c.push(col[0], col[1], col[2]);
      b.s.push(size);
      b.a.push(alpha);
      b.ph.push(rnd());
      b.rt.push(rot || 0);
      b.n++;
    }
    function gauss() {
      const u = Math.max(1e-6, rnd());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd());
    }
    function mix3(a, b, t) {
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
      ];
    }

    function makeGeom(b) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('aColor', new THREE.Float32BufferAttribute(b.c, 3));
      g.setAttribute('aSize', new THREE.Float32BufferAttribute(b.s, 1));
      g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(b.a, 1));
      g.setAttribute('aPhase', new THREE.Float32BufferAttribute(b.ph, 1));
      g.setAttribute('aRot', new THREE.Float32BufferAttribute(b.rt, 1));
      return g;
    }

    function pointMat(opt) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: opt.tex || null },
          uOpacity: { value: opt.opacity == null ? 1 : opt.opacity },
          uSizeMul: { value: opt.sizeMul == null ? 1 : opt.sizeMul },
          uGain: { value: opt.gain == null ? 1 : opt.gain },
          uSoftPow: { value: opt.softPow == null ? 2.4 : opt.softPow },
          uTwinkle: { value: opt.twinkle ? 1 : 0 },
          uTime: SH.uTime,
          uProjScale: SH.uProjScale,
          uMinPx: SH.uMinPx
        },
        vertexShader: VERT_POINT,
        fragmentShader: opt.frag || FRAG_ADDSOFT,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
    }

    function addPoints(group, b, mat, order) {
      if (!b.n) return null;
      const pts = new THREE.Points(makeGeom(b), mat);
      pts.frustumCulled = false;
      pts.renderOrder = order || 3;
      group.add(pts);
      return pts;
    }

    function planeMat(frag, uniforms) {
      const u = uniforms || {};
      u.uOpacity = { value: 1 };
      u.uNoise = { value: texNoise };
      u.uTime = SH.uTime;
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: VERT_UV,
        fragmentShader: frag,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      });
      return m;
    }

    function dustMat(frag, uniforms, blend) {
      const u = uniforms || {};
      u.uOpacity = { value: 1 };
      u.uNoise = { value: texNoise };
      return new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: VERT_UV,
        fragmentShader: frag,
        transparent: true,
        blending: blend || THREE.MultiplyBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      });
    }

    function addGlowSprite(group, tex, color, scale, opacity, x, y, z, order) {
      const m = new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        opacity: opacity
      });
      const s = new THREE.Sprite(m);
      s.position.set(x || 0, y || 0, z || 0);
      s.scale.set(scale, scale, 1);
      s.renderOrder = order || 5;
      group.add(s);
      return s;
    }

    /* ---- 多层切片几何：一个 draw call 画 N 层水平薄面 ----
     * aY = 层高（-1..1），aW = 层权重（Σ=1，总亮度与单层一致）。
     * uv 朝向与 PlaneGeometry 旋转 -PI/2 后一致，原有 frag 无需改坐标。
     * 层高带 ±0.55 层距的确定性抖动：等距采样在侧视时和像素网格拍频，
     * 会出现规则平行条纹；抖动把它变成不可见的噪声，再由层数掩盖。 */
    function makeStackGeo(R, N, thick, radial) {
      const half = thick * 0.5;
      const step = N > 1 ? 2 / (N - 1) : 0;
      const pos = [], uvs = [], aY = [], aW = [], idx = [];
      const wt = [], tt = [];
      let ws = 0;
      for (let i = 0; i < N; i++) {
        const baseT = N > 1 ? (i / (N - 1)) * 2 - 1 : 0;
        let t = baseT;
        if (i > 0 && i < N - 1) t += (rnd() - 0.5) * step * 1.1;
        tt.push(t);
        /* 边缘渐隐窗：|t|→1 时权重归零。否则最外层切片在高斯尾部仍有约 0.2
         * 的权重，侧视时那层平面的边缘会切出一条笔直硬边（片状感来源之一）。 */
        const edge = Math.pow(Math.max(0, 1 - t * t), 0.85);
        const w = Math.exp(-(t * t) / 0.62) * edge;
        wt.push(w);
        ws += w;
      }
      for (let i = 0; i < N; i++) {
        const t = tt[i];
        const y = t * half;
        const g = wt[i] / ws;
        const s = 1 + t * radial;
        const base = pos.length / 3;
        pos.push(-R * s, y, R * s, R * s, y, R * s,
          -R * s, y, -R * s, R * s, y, -R * s);
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        aY.push(t, t, t, t);
        aW.push(g, g, g, g);
        idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('aY', new THREE.Float32BufferAttribute(aY, 1));
      geo.setAttribute('aW', new THREE.Float32BufferAttribute(aW, 1));
      geo.setIndex(idx);
      return geo;
    }

    function stackMat(frag, uniforms, twist, blend) {
      const u = uniforms || {};
      u.uOpacity = { value: 1 };
      u.uNoise = { value: texNoise };
      u.uTime = SH.uTime;
      u.uTwist = { value: twist || 0 };
      return new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: VERT_STACK,
        fragmentShader: frag,
        transparent: true,
        blending: blend || THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      });
    }

    /* ---- 核球：同心椭球壳（加法叠加 ⇒ 体积发光体，替代扁平的 Sprite） ---- */
    const shellGeo = new THREE.SphereGeometry(1, 20, 12);
    function addGlowShell(group, sx, flat, color, alpha, pow, order) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(color[0], color[1], color[2]) },
          uOpacity: { value: 1 },
          uA: { value: alpha },
          uPow: { value: pow }
        },
        vertexShader: VERT_SHELL,
        fragmentShader: FRAG_SHELL,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
      const m = new THREE.Mesh(shellGeo, mat);
      m.scale.set(sx, sx * flat, sx);
      m.renderOrder = order || 5;
      group.add(m);
      return m;
    }

    /* ============================================================
     * 螺旋星系
     * ============================================================ */
    function buildSpiral() {
      const g = new THREE.Group();
      g.rotation.z = 0.15;

      /* ---- 1. 连续盘面（多层体积切片：盘有可见厚度） ---- */
      const nDisk = Math.max(14, Math.round(VOL.spiral.layers * qs));
      const diskGeo = makeStackGeo(SP.RP, nDisk, VOL.spiral.thick, VOL.spiral.radial);
      const diskMat = stackMat(FRAG_SPIRAL, {
        uRP: { value: SP.RP },
        uRM: { value: SP.RM },
        uK: { value: SP.K },
        uR0: { value: SP.R0 },
        uW0: { value: SP.W0 },
        uW1: { value: SP.W1 },
        uCoreA: { value: new THREE.Vector3(CORE_A[0], CORE_A[1], CORE_A[2]) },
        uCoreB: { value: new THREE.Vector3(CORE_B[0], CORE_B[1], CORE_B[2]) },
        uArmA: { value: new THREE.Vector3(ARM_A[0], ARM_A[1], ARM_A[2]) },
        uArmB: { value: new THREE.Vector3(ARM_B[0], ARM_B[1], ARM_B[2]) }
      }, VOL.spiral.twist);
      const disk = new THREE.Mesh(diskGeo, diskMat);
      disk.renderOrder = 2;
      g.add(disk);

      /* ---- 2. 尘埃吸收层（同样切片）----
       * 单层平面上的车道只有零点几 world 宽，侧视时被压成 1px 硬线，
       * 这正是「片状」观感：好几条细弧排成同心线。切片后车道有了 y 向分布。 */
      const nDust = Math.max(4, Math.round(6 * qs));
      const dustGeo = makeStackGeo(SP.RP, nDust, 0.20, VOL.spiral.radial * 0.5);
      const dustMat0 = stackMat(FRAG_SPIRAL_DUST, {
        uRP: { value: SP.RP },
        uRM: { value: SP.RM },
        uK: { value: SP.K },
        uR0: { value: SP.R0 },
        uW0: { value: SP.W0 },
        uW1: { value: SP.W1 },
        uDustCol: { value: new THREE.Vector3(0.075, 0.042, 0.030) }
      }, VOL.spiral.twist, THREE.NormalBlending);
      const dust = new THREE.Mesh(dustGeo, dustMat0);
      dust.renderOrder = 3;   // 压在连续盘面（2）之后、星点（4）之前：星点能透出来
      g.add(dust);

      /* ---- 3. 盘上细星 ---- */
      const bDisk = newBuf();
      const ND = rc(26000);
      for (let i = 0; i < ND; i++) {
        const u = rnd();
        const r = 0.09 + (SP.RM - 0.09) * Math.pow(u, 0.72);
        const inArm = rnd() < 0.74;
        let phi;
        let col;
        if (inArm) {
          let a = SP.ARMS[0];
          const pick = rnd();
          if (pick < 0.32) a = SP.ARMS[0];
          else if (pick < 0.64) a = SP.ARMS[1];
          else if (pick < 0.82) a = SP.ARMS[2];
          else a = SP.ARMS[3];
          const w = armW(r) * 1.55;
          phi = a.ph + armBase(r) + gauss() * w;
          col = r > 1.0 ? mix3(STAR.B, STAR.A, rnd())
                        : mix3(STAR.A, STAR.G, rnd() * 0.8);
        } else {
          phi = rnd() * TAU;
          col = mix3(STAR.G, STAR.K, rnd());
        }
        // 薄盘：外圈薄、内圈（厚盘/核球过渡）厚，整个盘在 y 向有体积
        const y = gauss() * (0.016 + 0.075 * Math.max(0, 1 - r / SP.RM));
        const size = 0.005 + Math.pow(rnd(), 3.0) * 0.011;
        const al = (inArm ? 0.30 : 0.14) + Math.pow(rnd(), 2.0) * (inArm ? 0.46 : 0.26);
        addP(bDisk, r * Math.cos(phi), y, r * Math.sin(phi), col, size, al);
      }
      const matDisk = pointMat({ frag: FRAG_ADDSOFT, softPow: 3.2, gain: 1.0, opacity: 0.9 });
      addPoints(g, bDisk, matDisk, 4);

      /* ---- 4. 核球星点（只作颗粒感） ---- */
      const bBulge = newBuf();
      const NB = rc(7000);
      for (let i = 0; i < NB; i++) {
        const rr = 1.15 * Math.pow(rnd(), 0.55);
        const th = rnd() * TAU;
        const ph = Math.acos(2 * rnd() - 1);
        const x = Math.sin(ph) * Math.cos(th) * rr;
        const y = Math.cos(ph) * rr * 0.62;
        const z = Math.sin(ph) * Math.sin(th) * rr;
        const col = mix3(STAR.G, STAR.K, rnd() * 0.9);
        addP(bBulge, x, y, z, col, 0.004 + rnd() * 0.008, 0.10 + rnd() * 0.26);
      }
      const matBulge = pointMat({ frag: FRAG_ADDSOFT, softPow: 3.2, gain: 0.9, opacity: 0.75 });
      addPoints(g, bBulge, matBulge, 3);

      /* ---- 5. 年轻星团碎星：臂上的锐利亮点（"糊"的对症药） ---- */
      const bClus = newBuf();
      const NCl = rc(2700);
      for (let i = 0; i < NCl; i++) {
        const a = SP.ARMS[rnd() < 0.72 ? (rnd() < 0.5 ? 0 : 1) : (rnd() < 0.5 ? 2 : 3)];
        const r = 0.30 + Math.pow(rnd(), 0.80) * (SP.RM - 0.34);
        const phi = a.ph + armBase(r) + gauss() * armW(r) * 0.80;
        const col = mix3(STAR.O, STAR.B, rnd() * 0.85);
        addP(bClus, r * Math.cos(phi), gauss() * 0.028, r * Math.sin(phi),
          col, (0.007 + Math.pow(rnd(), 2.2) * 0.016) * 0.55, 0.45 + rnd() * 0.55);
      }
      const matClus = pointMat({ frag: FRAG_ADDSOFT, softPow: 3.8, gain: 1.15, opacity: 0.95 });
      addPoints(g, bClus, matClus, 7);

      /* ---- 6. HII 区（沿臂的粉红云团 + 青绿核） ---- */
      const bHii = newBuf();
      const NREG = isLow ? 8 : 12;
      for (let i = 0; i < NREG; i++) {
        const a = SP.ARMS[rnd() < 0.72 ? (rnd() < 0.5 ? 0 : 1) : (rnd() < 0.5 ? 2 : 3)];
        const r = 0.55 + Math.pow(rnd(), 0.85) * (SP.RM - 0.72);
        const phi = a.ph + armBase(r) + gauss() * armW(r) * 0.55;
        const cx = r * Math.cos(phi), cz = r * Math.sin(phi);
        const big = 0.12 + rnd() * 0.14;              // 世界半径（≈26–56px 直径，照片级 HII 团）
        const al = 0.80 + rnd() * 0.20;
        const pink = mix3(HII_PINK, [1.0, 0.55, 0.62], rnd() * 0.5);
        addP(bHii, cx, gauss() * 0.045, cz, pink, big * 2, al);
        // 亮核：让团块有"中心"而不是一团雾
        addP(bHii, cx, gauss() * 0.020, cz, mix3(pink, [1.0, 0.72, 0.78], 0.45), big * 0.85, 0.95);
        const sub = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < sub; k++) {
          const rr = big * (0.9 + rnd() * 0.9);
          const aa = rnd() * TAU;
          addP(bHii, cx + Math.cos(aa) * rr, gauss() * 0.040, cz + Math.sin(aa) * rr,
            pink, big * (0.5 + rnd() * 0.7), al * (0.35 + rnd() * 0.4));
        }
        if (rnd() < 0.45) {
          addP(bHii, cx, gauss() * 0.020, cz, HII_TEAL, big * 0.55, 0.75 + rnd() * 0.25);
        }
      }
      const matHii = pointMat({
        frag: FRAG_ADDTEX, tex: texCloud, gain: 1.35, opacity: 0.95, sizeMul: 1.0
      });
      addPoints(g, bHii, matHii, 8);

      /* ---- 6. 亮星（含 8 颗前景星芒） ---- */
      const bStar = newBuf();
      const NBright = isLow ? 16 : 26;
      for (let i = 0; i < NBright; i++) {
        const a = SP.ARMS[rnd() < 0.6 ? 0 : 1];
        const r = 0.35 + rnd() * (SP.RM - 0.4);
        const phi = a.ph + armBase(r) + gauss() * armW(r) * 0.9;
        const col = [STAR.A, STAR.F, STAR.B, STAR.G][Math.floor(rnd() * 4)];
        addP(bStar, r * Math.cos(phi), gauss() * 0.06, r * Math.sin(phi),
          col, 0.028 + rnd() * 0.028, 0.55 + rnd() * 0.45);
      }
      const NFg = isLow ? 4 : 8;
      for (let i = 0; i < NFg; i++) {
        const ang = (i / NFg) * TAU + rnd() * 0.6;
        const rr = 2.1 + rnd() * 1.9;
        const col = [STAR.F, STAR.A, STAR.G, STAR.K][Math.floor(rnd() * 4)];
        addP(bStar, Math.cos(ang) * rr, 0.55 + rnd() * 1.35, Math.sin(ang) * rr,
          col, 0.062 + rnd() * 0.055, 0.75 + rnd() * 0.25);
      }
      const matStar = pointMat({
        frag: FRAG_ADDTEX, tex: texStar, gain: 1.0, opacity: 0.95, twinkle: false
      });
      addPoints(g, bStar, matStar, 9);

      /* ---- 7. 核球：同心椭球壳（体积发光体）+ 极淡外晕 ---- */
      addGlowSprite(g, texHalo, [0.98, 0.80, 0.58], 7.4, 0.042, 0, 0, 0, 1);
      addGlowShell(g, 1.55, 0.60, CORE_B, 0.05, 2.6, 5);
      addGlowShell(g, 0.95, 0.58, CORE_A, 0.09, 2.6, 5);
      addGlowShell(g, 0.50, 0.62, [1.00, 0.94, 0.84], 0.26, 2.2, 5);
      addGlowShell(g, 0.22, 0.70, [1.00, 0.98, 0.95], 0.62, 1.8, 5);

      /* ---- 8. 伴星系（M51 式，含核、尘、桥） ---- */
      const compX = -1.75, compZ = 1.52;
      const bComp = newBuf();
      const NC = rc(1600);
      for (let i = 0; i < NC; i++) {
        const rr = 0.30 * Math.pow(rnd(), 0.6);
        const th = rnd() * TAU;
        const ph = Math.acos(2 * rnd() - 1);
        const x = Math.sin(ph) * Math.cos(th) * rr;
        const y = Math.cos(ph) * rr * 0.62;
        const z = Math.sin(ph) * Math.sin(th) * rr;
        const col = mix3(STAR.G, STAR.K, rnd());
        addP(bComp, compX + x, y, compZ + z, col, 0.004 + rnd() * 0.006, 0.16 + rnd() * 0.3);
      }
      // 潮汐桥
      const NBr = rc(420);
      const P2x = 0.34, P2z = -0.16;
      const P1x = (compX + P2x) * 0.5 + 0.55, P1z = (compZ + P2z) * 0.5 - 0.45;
      for (let i = 0; i < NBr; i++) {
        const t = rnd();
        const it = 1 - t;
        const bx = it * it * compX + 2 * it * t * P1x + t * t * P2x;
        const bz = it * it * compZ + 2 * it * t * P1z + t * t * P2z;
        addP(bComp,
          bx + gauss() * 0.055 * (1 - t * 0.5),
          gauss() * 0.03,
          bz + gauss() * 0.055 * (1 - t * 0.5),
          mix3(STAR.A, STAR.B, rnd()), 0.004 + rnd() * 0.007, 0.10 + rnd() * 0.18);
      }
      const bCompDust = newBuf();
      const NCD = rc(300);
      for (let i = 0; i < NCD; i++) {
        const rr = 0.32 * Math.pow(rnd(), 0.5);
        const th = rnd() * TAU;
        addP(bCompDust, compX + Math.cos(th) * rr * 1.15, gauss() * 0.01,
          compZ + Math.sin(th) * rr * 0.75, DUST_BROWN, 0.006 + rnd() * 0.012, 0.3 + rnd() * 0.4);
      }
      const matComp = pointMat({ frag: FRAG_ADDSOFT, softPow: 2.6, gain: 0.85, opacity: 0.8 });
      addPoints(g, bComp, matComp, 3);
      addGlowSprite(g, texCore, [1.0, 0.92, 0.78], 0.62, 0.55, compX, 0, compZ, 4);
      addGlowSprite(g, texHalo, [0.92, 0.86, 0.72], 1.9, 0.10, compX, 0, compZ, 1);

      return g;
    }

    /* ============================================================
     * 椭圆星系
     * ============================================================ */
    function buildElliptical() {
      const g = new THREE.Group();
      g.rotation.set(EL.TILT[0], EL.TILT[1], EL.TILT[2]);

      /* 主体：多层体积切片（椭球体，不再是单张 Sérsic 面） */
      const nE = Math.max(16, Math.round(VOL.elliptical.layers * qs));
      const planeGeo = makeStackGeo(EL.RE, nE, VOL.elliptical.thick, VOL.elliptical.radial);
      const planeMatE = stackMat(FRAG_ELLIPTICAL, {
        uRP: { value: EL.RE },
        uColA: { value: new THREE.Vector3(ELL_A[0], ELL_A[1], ELL_A[2]) },
        uColB: { value: new THREE.Vector3(ELL_B[0], ELL_B[1], ELL_B[2]) }
      }, VOL.elliptical.twist);
      const plane = new THREE.Mesh(planeGeo, planeMatE);
      plane.renderOrder = 2;
      g.add(plane);

      /* 极淡同心尘埃带（乘法吸收，宽 0.015–0.035R，暗 22%） */
      const edGeo = new THREE.PlaneGeometry(EL.RE * 2, EL.RE * 2, 1, 1);
      const edMat = dustMat(FRAG_ELL_DUST, {
        uRP: { value: EL.RE },
        uDustCol: { value: new THREE.Vector3(DUST_BROWN[0], DUST_BROWN[1], DUST_BROWN[2]) }
      });
      const edPlane = new THREE.Mesh(edGeo, edMat);
      edPlane.rotation.x = -PI / 2;
      edPlane.renderOrder = 6;
      g.add(edPlane);

      /* 颗粒点云：只负责质感，不负责亮度 */
      const bE = newBuf();
      const NE = rc(15000);
      for (let i = 0; i < NE; i++) {
        const e = 1.85 * Math.pow(rnd(), 0.52);
        const th = rnd() * TAU;
        const x = Math.cos(th) * e;
        const z = Math.sin(th) * e * EL.AXIS;
        const y = gauss() * 0.26 * (1.0 - Math.min(0.7, e / 3.0));
        const col = mix3(STAR.G, STAR.K, rnd());
        addP(bE, x, y, z, col, 0.004 + rnd() * 0.008,
          0.30 * Math.exp(-e / 0.85) + 0.06);
      }
      const matE = pointMat({ frag: FRAG_ADDSOFT, softPow: 2.4, gain: 0.8, opacity: 0.85 });
      addPoints(g, bE, matE, 3);

      /* 球状星团：1200 个暖色稀疏大点（4–8px） */
      const bGlob = newBuf();
      const NG = rc(2000);
      for (let i = 0; i < NG; i++) {
        const e = 2.10 * Math.pow(rnd(), 0.62) + 0.12;
        const th = rnd() * TAU;
        const x = Math.cos(th) * e;
        const z = Math.sin(th) * e * EL.AXIS;
        const y = gauss() * 0.34 * (1.0 - Math.min(0.6, e / 3.0));
        addP(bGlob, x, y, z, mix3(STAR.G, STAR.F, rnd()),
          0.010 + rnd() * 0.013, 0.34 + rnd() * 0.44);
      }
      const matGlob = pointMat({ frag: FRAG_ADDSOFT, softPow: 2.8, gain: 1.0, opacity: 0.9 });
      addPoints(g, bGlob, matGlob, 6);

      /* 核球：同心椭球壳（体积发光体）+ 极淡外晕 */
      addGlowSprite(g, texHalo, [0.98, 0.84, 0.62], 5.85, 0.06, 0, 0, 0, 1);
      addGlowShell(g, 1.60, 0.86, ELL_B, 0.08, 2.8, 5);
      addGlowShell(g, 0.95, 0.90, ELL_A, 0.13, 2.6, 5);
      addGlowShell(g, 0.46, 0.92, [1.00, 0.90, 0.74], 0.26, 2.2, 5);
      addGlowShell(g, 0.20, 0.95, [1.00, 0.97, 0.90], 0.52, 1.9, 5);

      return g;
    }

    /* ============================================================
     * 不规则星系
     * ============================================================ */
    function irBlobF(x, z, i) {
      const b = IR.BLOBS[i];
      const dx = (x - b.x) / b.r, dz = (z - b.z) / b.r;
      return b.a * Math.exp(-(dx * dx + dz * dz) * 1.15);
    }
    function irField(x, z) {
      return irBlobF(x, z, 0) + irBlobF(x, z, 1) + irBlobF(x, z, 2) + irBlobF(x, z, 3);
    }

    function buildIrregular() {
      const g = new THREE.Group();
      g.rotation.set(IR.TILT[0], IR.TILT[1], IR.TILT[2]);

      const b4 = function (i) {
        const b = IR.BLOBS[i];
        return { value: new THREE.Vector4(b.x, b.z, b.r, b.a) };
      };
      /* 主体：多层体积切片（团块云在 y 向有厚度） */
      const nI = Math.max(12, Math.round(VOL.irregular.layers * qs));
      const bodyGeo = makeStackGeo(IR.RP, nI, VOL.irregular.thick, VOL.irregular.radial);
      const bodyUniforms = {
        uRP: { value: IR.RP },
        uB0: b4(0), uB1: b4(1), uB2: b4(2), uB3: b4(3),
        uB4: b4(4), uB5: b4(5), uB6: b4(6),
        uColA: { value: new THREE.Vector3(IRR_A[0], IRR_A[1], IRR_A[2]) },
        uColB: { value: new THREE.Vector3(IRR_B[0], IRR_B[1], IRR_B[2]) },
        uColC: { value: new THREE.Vector3(HII_PINK[0], HII_PINK[1], HII_PINK[2]) }
      };
      const bodyMat = stackMat(FRAG_IRREG, bodyUniforms, VOL.irregular.twist);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.renderOrder = 2;
      g.add(body);

      /* 尘埃吸收层 */
      const dGeo = new THREE.PlaneGeometry(IR.RP * 2, IR.RP * 2, 1, 1);
      const dMat = dustMat(FRAG_IRREG_DUST, {
        uRP: { value: IR.RP },
        uB0: b4(0), uB1: b4(1), uB2: b4(2), uB3: b4(3),
        uB4: b4(4), uB5: b4(5), uB6: b4(6),
        uDustCol: { value: new THREE.Vector3(0.09, 0.05, 0.035) }
      }, THREE.NormalBlending);
      const dPlane = new THREE.Mesh(dGeo, dMat);
      dPlane.rotation.x = -PI / 2;
      dPlane.renderOrder = 5;   // 在主体与星点之后、HII 之前
      g.add(dPlane);

      /* 亮核：最大团块中心的暖白 HDR 核心（同心椭球壳，体积发光） */
      const c0 = IR.BLOBS[0];
      addGlowShell(g, 0.72, 0.80, [1.90, 1.70, 1.40], 0.30, 2.8, 4)
        .position.set(c0.x, 0.02, c0.z);
      addGlowShell(g, 0.40, 0.85, [1.20, 1.05, 0.86], 0.24, 2.6, 4)
        .position.set(c0.x, 0.01, c0.z);
      addGlowShell(g, 0.16, 0.90, [1.00, 0.96, 0.88], 0.55, 2.0, 4)
        .position.set(c0.x, 0.01, c0.z);

      /* HII 区中心先定下来：蓝色星团要聚集在 HII 区周围（物理正确：年轻星团诞生于 HII 区） */
      const HII_REG = [];
      const NREG = isLow ? 4 : 6;
      for (let i = 0; i < NREG; i++) {
        const bl = IR.BLOBS[Math.floor(rnd() * IR.BLOBS.length)];
        const th = rnd() * TAU;
        const rr = bl.r * (0.30 + rnd() * 0.62);
        HII_REG.push({
          x: bl.x + Math.cos(th) * rr,
          z: bl.z + Math.sin(th) * rr,
          r: 0.075 + rnd() * 0.055      // 世界半径 0.075–0.130（≈25–44px 直径）
        });
      }

      /* 团块内星点 */
      const bStars = newBuf();
      const NB = rc(15000);
      for (let i = 0; i < NB; i++) {
        const pick = rnd();
        let wsum = 0;
        const NBn = IR.BLOBS.length;
        for (let k = 0; k < NBn; k++) wsum += IR.BLOBS[k].a;
        let acc = 0, bi = 0;
        for (let k = 0; k < NBn; k++) {
          acc += IR.BLOBS[k].a / wsum;
          if (pick <= acc) { bi = k; break; }
          bi = k;
        }
        const bl = IR.BLOBS[bi];
        const rr = bl.r * 0.82 * Math.pow(rnd(), 0.55);
        const th = rnd() * TAU;
        const x = bl.x + Math.cos(th) * rr;
        const z = bl.z + Math.sin(th) * rr;
        const y = gauss() * 0.20;
        const young = rnd() < 0.62;
        const col = young ? mix3(STAR.O, STAR.B, rnd()) : mix3(STAR.A, STAR.G, rnd());
        addP(bStars, x, y, z, col, 0.004 + Math.pow(rnd(), 2.4) * 0.010,
          0.16 + Math.pow(rnd(), 1.8) * 0.46);
      }
      const matBS = pointMat({ frag: FRAG_ADDSOFT, softPow: 2.3, gain: 1.15, opacity: 0.95 });
      addPoints(g, bStars, matBS, 3);

      /* 蓝色年轻星团：60% 聚集在 HII 区周围，其余散布主体；颜色 (0.55,0.72,1.0)×2.2 HDR，过 bloom 发蓝白光 */
      const bClu = newBuf();
      const NClu = rc(2600);
      for (let i = 0; i < NClu; i++) {
        let cx, cz;
        if (rnd() < 0.60) {
          const hc = HII_REG[Math.floor(rnd() * HII_REG.length)];
          const rad = hc.r * Math.pow(rnd(), 0.70);
          const th = rnd() * TAU;
          cx = hc.x + Math.cos(th) * rad;
          cz = hc.z + Math.sin(th) * rad;
        } else {
          const bb = IR.BLOBS[Math.floor(rnd() * IR.BLOBS.length)];
          const rad = bb.r * 0.78 * Math.pow(rnd(), 0.62);
          const th = rnd() * TAU;
          cx = bb.x + Math.cos(th) * rad;
          cz = bb.z + Math.sin(th) * rad;
        }
        addP(bClu, cx, gauss() * 0.130, cz,
          mix3([0.62, 0.86, 1.45], [0.80, 1.05, 1.72], rnd()),
          0.0140 + Math.pow(rnd(), 1.5) * 0.0130,   // 2.4–4.6px
          0.50 + rnd() * 0.38);
      }
      const matClu = pointMat({ frag: FRAG_ADDSOFT, softPow: 3.2, gain: 1.0, opacity: 1.0 });
      addPoints(g, bClu, matClu, 7);

      /* HII 巨团：每个区 3 个重叠碎云（lib-core 的 fbm 云纹理打碎边缘），内亮外深，绝不做"实心圆球" */
      const bH = newBuf();
      const texHII = COSMOS.tex.cloudTexture(256);
      for (let i = 0; i < HII_REG.length; i++) {
        const hc = HII_REG[i];
        const rb = hc.r;
        for (let k = 0; k < 3; k++) {
          const inner = k === 0;
          const a2 = rnd() * TAU;
          const off = inner ? 0 : rb * (0.30 + rnd() * 0.55);
          const rs = rb * (inner ? 0.90 : 0.55 + rnd() * 0.50);          // 世界半径
          const col = inner
            ? [1.00, 0.64, 0.72]
            : mix3([1.00, 0.40, 0.52], [1.00, 0.55, 0.62], rnd());
          addP(bH,
            hc.x + Math.cos(a2) * off,
            gauss() * 0.050,
            hc.z + Math.sin(a2) * off,
            col, rs * 2, (inner ? 0.62 : 0.34 + rnd() * 0.16));
        }
      }
      const matH = pointMat({ frag: FRAG_ADDTEX, tex: texHII, gain: 1.75, opacity: 0.78 });
      addPoints(g, bH, matH, 6);

      /* 潮汐尾 2 条 */
      const bTail = newBuf();
      const TAILS = [
        { x0: -0.95, z0: 0.55, dx: -2.95, dz: 1.55, bend: 1.10, len: 3.4, wid: 0.40 },
        { x0: 1.15, z0: -0.75, dx: 1.95, dz: -1.45, bend: -0.70, len: 2.6, wid: 0.32 }
      ];
      const NTail = rc(3000);
      for (let t = 0; t < TAILS.length; t++) {
        const td = TAILS[t];
        const n = Math.round(NTail * (t === 0 ? 0.56 : 0.44));
        for (let i = 0; i < n; i++) {
          const u = Math.pow(rnd(), 0.85);
          const px = td.x0 + td.dx * u + Math.sin(u * 2.4) * td.bend * u * 0.55;
          const pz = td.z0 + td.dz * u + Math.cos(u * 2.0) * td.bend * u * 0.45;
          const sp = td.wid * (0.35 + u);
          addP(bTail,
            px + gauss() * sp * 0.55,
            gauss() * sp * 0.55,
            pz + gauss() * sp * 0.55,
            mix3(STAR.B, STAR.A, rnd()),
            0.009 + rnd() * 0.011,
            (0.26 + rnd() * 0.26) * (1.35 - u * 0.6));
        }
      }
      const matTail = pointMat({ frag: FRAG_ADDSOFT, softPow: 2.4, gain: 0.9, opacity: 0.85 });
      addPoints(g, bTail, matTail, 3);

      /* 潮汐尾淡雾带：沿尾巴方向的加法 plane，用云纹理打碎（亮度 0.10–0.18） */
      const HAZE = [
        { t: TAILS[0], wid: 0.78, th: 0.16 },
        { t: TAILS[1], wid: 0.56, th: 0.13 }
      ];
      for (let i = 0; i < HAZE.length; i++) {
        const td = HAZE[i].t;
        const hGeo = new THREE.PlaneGeometry(td.len, HAZE[i].wid, 1, 1);
        hGeo.rotateX(-PI / 2);
        hGeo.rotateY(Math.atan2(-td.dz, td.dx));       // 局部 +x 对齐尾巴方向
        hGeo.translate(td.x0 + td.dx * 0.5, 0, td.z0 + td.dz * 0.5);
        const hMat = planeMat(FRAG_TAIL, {
          uTex: { value: texHII },
          uCol: { value: new THREE.Vector3(0.42, 0.58, 1.0) }
        });
        hMat.uniforms.uOpacity.value = HAZE[i].th;
        const haze = new THREE.Mesh(hGeo, hMat);
        haze.renderOrder = 3;
        g.add(haze);
      }

      return g;
    }

    /* ============================================================
     * 组装三形态
     * ============================================================ */
    const groups = {
      spiral: buildSpiral(),
      elliptical: buildElliptical(),
      irregular: buildIrregular()
    };
    const groupKeys = ['spiral', 'elliptical', 'irregular'];
    const groupList = [groups.spiral, groups.elliptical, groups.irregular];

    /* 收集每个形态的淡化目标（shader uOpacity / sprite opacity） */
    for (let gi = 0; gi < groupList.length; gi++) {
      const g = groupList[gi];
      const k = groupKeys[gi];
      const faders = [];
      g.traverse(function (o) {
        const m = o.material;
        if (!m) return;
        if (o.isSprite) {
          faders.push({ mat: m, sprite: true, base: m.opacity });
        } else if (m.uniforms && m.uniforms.uOpacity) {
          faders.push({ mat: m, sprite: false, base: m.uniforms.uOpacity.value });
        }
      });
      g.userData.faders = faders;
      g.userData.op = (k === curType) ? 1 : 0;
      g.visible = (k === curType);
      for (let i = 0; i < faders.length; i++) {
        const fa = faders[i];
        if (fa.sprite) fa.mat.opacity = fa.base * g.userData.op;
        else fa.mat.uniforms.uOpacity.value = fa.base * g.userData.op;
      }
      scene.add(g);
    }

    /* ============================================================
     * 远景小星系（跟相机走，避开中心 25° 锥）
     * ============================================================ */
    const bgGroup = new THREE.Group();
    bgGroup.matrixAutoUpdate = true;
    (function buildBackground() {
      const bBg = newBuf();
      const N = isLow ? 10 : 18;
      // 屏幕 CSS 像素 → 该距离下的世界直径（1 world ≈ 0.5·H·tan(fov/2) 像素）
      const pxUnit = 0.5 * (ctx.height || 810) * Math.tan(CFG.fov * PI / 360);
      for (let i = 0; i < N; i++) {
        const th = rnd() * TAU;
        const polar = (26 + rnd() * 52) * PI / 180;
        const dist = 24 + rnd() * 16;
        const sx = Math.sin(polar) * Math.cos(th);
        const sy = Math.sin(polar) * Math.sin(th);
        const sz = -Math.cos(polar);
        const px = 2.2 + Math.pow(rnd(), 2.2) * 15.0;
        const size = px * dist / pxUnit;
        const warm = rnd() < 0.55;
        const col = warm ? mix3([1.0, 0.86, 0.66], [1.0, 0.74, 0.52], rnd())
                         : mix3([0.78, 0.86, 1.0], [0.62, 0.74, 1.0], rnd());
        addP(bBg, sx * dist, sy * dist, sz * dist, col, size, 0.20 + rnd() * 0.34,
          rnd() * TAU);
      }
      const matBg = pointMat({ frag: FRAG_ADDTEX, tex: texGalaxy, gain: 0.72, opacity: 0.62 });
      const pts = new THREE.Points(makeGeom(bBg), matBg);
      pts.frustumCulled = false;
      pts.renderOrder = -20;
      bgGroup.add(pts);
      scene.add(bgGroup);
    })();

    /* ============================================================
     * 背景星野
     * ============================================================ */
    const stars = COSMOS.builders.makeStarfield({ count: CFG.starCount, rMin: 52, rMax: 96 });
    const sSize = stars.geometry.attributes.aSize;
    if (sSize) {
      for (let i = 0; i < sSize.count; i++) sSize.array[i] *= 0.26;
      sSize.needsUpdate = true;
    }
    const smat = stars.material;
    if (smat.uniforms) {
      if (smat.uniforms.uPixelRatio) smat.uniforms.uPixelRatio.value = ctx.pixelRatio || 1;
      if (smat.uniforms.uOpacity) smat.uniforms.uOpacity.value = 0.70;
      if (smat.uniforms.uSize) smat.uniforms.uSize.value = 0.85;
    }
    stars.renderOrder = -30;
    scene.add(stars);

    /* ============================================================
     * 交互状态
     * ============================================================ */
    const view = {
      yaw: CFG.yaw0,
      pitch: CFG.pitch0,
      dist: CFG.dist0,
      distTarget: CFG.dist0,
      vy: 0,
      vp: 0,
      spin: 0,
      zoomMul: 1
    };
    let resetT = 0;
    const _look = new THREE.Vector3();
    const _fwd = new THREE.Vector3();
    const _right = new THREE.Vector3();
    const _up = new THREE.Vector3();
    const WORLD_UP = new THREE.Vector3(0, 1, 0);

    function placeCamera() {
      const ya = view.yaw + view.spin;
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const d = view.dist;
      camera.position.set(
        Math.sin(ya) * cp * d,
        sp * d,
        Math.cos(ya) * cp * d
      );
      _fwd.copy(camera.position).negate().normalize();
      _right.crossVectors(_fwd, WORLD_UP);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _right.normalize();
      _up.crossVectors(_right, _fwd).normalize();
      const k = U.clamp(ctx.aspect || 1, 0.62, 1.7) / CFG.offAspect;
      _look.copy(_right)
        .multiplyScalar(-CFG.offX * k)
        .addScaledVector(_up, -0.02);
      camera.lookAt(_look);
      camera.updateMatrixWorld();
    }

    /* 切形态：只改透明度目标，几何和材质都复用 */
    function syncType(silent) {
      const t = GS.type;
      if (t !== 'spiral' && t !== 'elliptical' && t !== 'irregular') return;
      if (t === curType) return;
      curType = t;
      if (!silent) COSMOS.emit('galaxies:type', { type: t });
    }

    function reset() {
      resetT = 0.42;
      view.distTarget = CFG.dist0;
      view.vy = 0;
      view.vp = 0;
      COSMOS.emit('galaxies:reset');
    }

    /* ============================================================
     * 每帧
     * ============================================================ */
    function update(t, dt, p) {
      if (!isFinite(t)) t = 0;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.1) dt = 0.1;
      const inp = ctx.input;
      const rm = ctx.reduceMotion;

      const pp = U.ease.inOutSine(U.clamp(isFinite(p) ? p : 0, 0, 1));

      /* ---- 形态切换（外部 tabs 写 state，这里检测） ---- */
      if (GS.type !== curType) syncType(false);

      /* ---- 拖拽 + 惯性 ---- */
      if (inp) {
        if (inp.dragging && !inp.uiTarget) {
          view.yaw -= inp.dx * CFG.dragYaw;
          view.pitch = U.clamp(view.pitch + inp.dy * CFG.dragPitch, -CFG.pitchMax, CFG.pitchMax);
          view.vy = -inp.dx * CFG.dragYaw;
          view.vp = inp.dy * CFG.dragPitch;
        } else if (!inp.down) {
          view.yaw += view.vy;
          view.pitch = U.clamp(view.pitch + view.vp, -CFG.pitchMax, CFG.pitchMax);
          const decay = Math.exp(-dt / CFG.inertiaTau);
          view.vy *= decay;
          view.vp *= decay;
          if (Math.abs(view.vy) < 0.012) view.vy = 0;
          if (Math.abs(view.vp) < 0.012) view.vp = 0;
        }

        const kk = inp.keys || {};
        const kYaw = (kk.ArrowLeft || kk.a ? 1 : 0) - (kk.ArrowRight || kk.d ? 1 : 0);
        if (kYaw !== 0) { view.yaw -= kYaw * 0.9 * dt; view.vy = -kYaw * 0.9; }
        const kPitch = (kk.w ? 1 : 0) - (kk.s ? 1 : 0);
        if (kPitch !== 0) {
          view.pitch = U.clamp(view.pitch + kPitch * 0.55 * dt, -CFG.pitchMax, CFG.pitchMax);
          view.vp = kPitch * 0.55;
        }
        if (kk['1']) GS.type = 'spiral';
        if (kk['2']) GS.type = 'elliptical';
        if (kk['3']) GS.type = 'irregular';
        if (kk['+'] || kk['=']) view.zoomMul *= Math.exp(-0.8 * dt);
        if (kk['-']) view.zoomMul *= Math.exp(0.8 * dt);
        if (inp.wheelCtrl) view.zoomMul *= Math.exp(inp.wheelCtrl * 0.0012);
        // 普通滚轮同样缩放（boot.js 已把非 UI 区域的滚轮路由到 input.wheel）
        if (inp.wheel) view.zoomMul *= Math.exp(inp.wheel * 0.0012);
        if (inp.pinch) view.zoomMul *= Math.exp(inp.pinch * 0.9);
      }
      view.zoomMul = U.clamp(view.zoomMul, 0.66, 1.7);

      /* ---- 自动极慢自转（reduced-motion 停） ---- */
      if (!rm) view.spin += CFG.autoSpin * dt;

      /* ---- 形态交叉淡化：只动透明度，不重建 ---- */
      for (let gi = 0; gi < groupList.length; gi++) {
        const g = groupList[gi];
        const target = (groupKeys[gi] === curType) ? 1 : 0;
        if (g.userData.op === target && g.visible === (target > 0.004)) continue;
        g.userData.op = U.damp(g.userData.op, target, CFG.fade, dt);
        const op = g.userData.op;
        const show = op > 0.004;
        if (g.visible !== show) g.visible = show;
        if (!show) continue;
        const faders = g.userData.faders;
        for (let i = 0; i < faders.length; i++) {
          const fa = faders[i];
          if (fa.sprite) fa.mat.opacity = fa.base * op;
          else fa.mat.uniforms.uOpacity.value = fa.base * op;
        }
      }

      /* ---- 相机：入场推镜 + 复位缓动 ---- */
      if (resetT > 0) {
        resetT -= dt;
        view.yaw = U.damp(view.yaw, CFG.yaw0, 7, dt);
        view.pitch = U.damp(view.pitch, CFG.pitch0, 7, dt);
        view.zoomMul = U.damp(view.zoomMul, 1, 7, dt);
        view.spin = U.damp(view.spin, 0, 7, dt);
      }
      const distTarget = CFG.dist0 * view.zoomMul * (1 + 0.065 * (1 - pp));
      view.dist += (distTarget - view.dist) * Math.min(1, dt * 9);
      placeCamera();

      /* ---- 时间 / 背景跟随 ---- */
      SH.uTime.value = t;
      bgGroup.position.copy(camera.position);
      bgGroup.quaternion.copy(camera.quaternion);
      stars.position.copy(camera.position);
      if (smat.uniforms && smat.uniforms.uTime) smat.uniforms.uTime.value = t;
    }

    function resize(w, h) {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      const pr = ctx.pixelRatio || 1;
      const p11 = camera.projectionMatrix.elements[5];
      SH.uProjScale.value = 0.5 * h * pr * p11;
      SH.uMinPx.value = Math.max(1.0, pr * 0.85);
      if (smat && smat.uniforms && smat.uniforms.uPixelRatio) {
        smat.uniforms.uPixelRatio.value = pr;
      }
    }
    resize(ctx.width || 1440, ctx.height || 810);
    placeCamera();

    return {
      scene: scene,
      camera: camera,
      arrowKeys: true,
      update: update,
      resize: resize,
      enter: function () { },
      leave: function () { },
      reset: reset,
      bloom: { strength: 0.44, radius: 0.62, threshold: 0.86 },
      dispose: function () {
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        for (let i = 0; i < allTextures.length; i++) allTextures[i].dispose();
        scene.clear();
      }
    };
  });

  /* ---------------- 确定性随机 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
})(window.COSMOS = window.COSMOS || {});
