/* ============================================================
 * COSMOS ATLAS · 04 致密天体 —— 3D 舞台（v4 光追版）
 * ------------------------------------------------------------
 * 三种天体模式（COSMOS.state.compact.mode，由 widget 写入、场景只读）：
 *   blackhole    史瓦西黑洞：全屏测地线光线追踪。相机在盘面附近，
 *                黑洞阴影、被引力透镜弯折到上下两侧的吸积盘、多普勒
 *                增亮的白热接近侧、暗红外缘、光子环，全部由光线积分
 *                自然产生（不是贴片近似）。
 *   neutronstar  中子星：米粒/裂纹表面 + 极冠热斑 + 纤维状磁层壳 +
 *                偶极磁力线 + 淡双极射束，自转 1.4 s 示意脉冲。
 *   whitedwarf   白矮星：结晶表面 + 蓝白边缘光 + 轨道伴星 + 磁力线/
 *                物质流弧 + 极淡行星状星云壳。
 *
 * 设计取舍：
 *   - 黑洞不再用 RingGeometry 吸积盘 + 屏幕空间偏折贴片，改为在片元
 *     着色器里逐像素积分光子轨道：a = -1.5 rs h² p / r⁵（施瓦西几何
 *     单位 rs = 1，h = |p×v| 守恒），穿盘时按 Shakura–Sunyaev 温度剖面
 *     + 开普勒速度多普勒 + 引力红移合成观测温度，颜色由 blackbody()
 *     按物理生成。一次穿越成像 = 盘；两次穿越 = 被透镜弯到上下两侧的
 *     远侧盘弧；落入视界 = 阴影。步数按质量档位降，画布由统一后处理
 *     泛光，保持可交互帧率。
 *   - 三种模式全部预建，切换只做 320 ms 不透明度交叉淡入，不重建几何、
 *     不编译 shader。update() 内不 new 对象。
 *
 * 预算（high）：draw call ≈ 24，三角 ≈ 9 万，粒子 ≈ 9 千。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  const U = COSMOS.util;
  if (!THREE || !U) return;

  const PI = Math.PI;
  const TAU = PI * 2;
  const CLAMP = U.clamp;
  const LERP = U.lerp;
  const DAMP = U.damp;
  const GS = (COSMOS.GLSL && COSMOS.GLSL.standard) || '';

  COSMOS.registerStage('compact', function (ctx) {
    const state = (COSMOS.state = COSMOS.state || {});
    if (!state.compact) state.compact = { mode: 'blackhole', mass: 10 };

    const input = ctx.input || COSMOS.input || {};
    const quality = ctx.quality || 'high';
    const reduceMotion = !!ctx.reduceMotion;
    const DPR = Math.min(ctx.pixelRatio || 1, 2);
    const isLow = quality === 'low';
    const isMedium = quality === 'medium';
    const TEX = COSMOS.tex;

    const scene = new THREE.Scene();
    const camera = U.makeCamera(40, ctx.aspect);
    const root = new THREE.Group();
    scene.add(root);

    let vw = ctx.width || 1280;
    let vh = ctx.height || 800;
    let time = 0;
    let entry = 1;

    /* ============================================================
     * 0. 背景星野 + 淡入淡出工具
     * ============================================================ */
    const starfield = COSMOS.builders.makeStarfield({
      count: isLow ? 2200 : (isMedium ? 3600 : 5200),
      rMin: 160,
      rMax: 520
    });
    scene.add(starfield);

    function collectFade(rootObj) {
      const list = [];
      rootObj.traverse(function (o) {
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (m.uniforms && m.uniforms.uFade) list.push({ m: m, u: true });
          else list.push({ m: m, u: false });
        }
      });
      return list;
    }

    function applyFade(rootObj, f) {
      const list = rootObj.userData.__fadeList;
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it.u) it.m.uniforms.uFade.value = f;
        else {
          const b = (it.m.userData && it.m.userData.__base != null) ? it.m.userData.__base : 1;
          it.m.opacity = b * f;
        }
      }
      rootObj.visible = f > 0.004;
    }

    function registerFade(rootObj) {
      rootObj.userData.__fadeList = collectFade(rootObj);
    }

    /* ============================================================
     * 1. 黑洞 —— 全屏测地线光线追踪
     * ============================================================ */
    const bhGroup = new THREE.Group();
    root.add(bhGroup);

    const BH_STEPS = isLow ? 72 : (isMedium ? 96 : 128);

    const BH_FS = `
precision highp float;

uniform vec3 uCamPos;
uniform vec3 uD00;
uniform vec3 uD10;
uniform vec3 uD01;
uniform float uRs;
uniform float uFade;
uniform float uTime;
uniform float uSpeed;
uniform float uTempIn;
uniform float uHdr;
varying vec2 vUv;

${GS}

const float DISK_IN = 3.0;
const float DISK_OUT = 8.8;

/* ---------- 背景天球：极暗星场 + 银河带 ---------- */
vec3 skySample(vec3 d) {
  vec3 axis = normalize(vec3(0.18, 0.9, 0.34));
  float b = dot(d, axis);
  float band = exp(-b * b * 16.0);
  float neb = fbm3(d * 2.6);
  vec3 milky = vec3(0.16, 0.20, 0.34) * band * (0.30 + 0.70 * (neb * 0.5 + 0.5));

  vec3 col = milky;

  // 亮星层
  vec3 q = d * 140.0;
  vec3 id = floor(q);
  vec3 f = fract(q) - 0.5;
  float h = hash13(id);
  if (h > 0.9945) {
    float b2 = (h - 0.9945) / 0.0055;
    float dd = length(f);
    float core = smoothstep(0.30, 0.0, dd);
    float tw = 0.72 + 0.28 * sin(uTime * 1.6 + h * 240.0);
    vec3 tint = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.88, 0.72), hash11(h * 37.0));
    col += tint * core * (0.35 + 1.5 * b2) * tw;
  }
  // 暗星层
  vec3 q2 = d * 300.0;
  vec3 id2 = floor(q2);
  vec3 f2 = fract(q2) - 0.5;
  float h2 = hash13(id2 + 41.0);
  if (h2 > 0.986) {
    float b3 = (h2 - 0.986) / 0.014;
    float dd2 = length(f2);
    col += vec3(0.55, 0.66, 0.95) * smoothstep(0.13, 0.0, dd2) * (0.20 + 0.6 * b3);
  }
  return col;
}

/* ---------- 吸积盘：温度剖面 + 开普勒多普勒 + 引力红移 ---------- */
vec3 diskSample(vec3 p, vec3 rd, float r, float graze) {
  float phi = atan(p.z, p.x);
  float omega = pow(3.0 / max(r, 2.4), 1.35);
  float ang = phi + uTime * omega * uSpeed * 1.55;

  vec2 cs = vec2(cos(ang), sin(ang));
  float lr = log(r);

  // 大尺度云带（低频，给盘以明暗分区）
  float low = fbm(vec3(cos(ang) * 0.55, sin(ang) * 0.55, lr * 4.2), 3, 2.0, 0.5);

  // 丝状结构：径向高频 + 角向低频，并沿螺旋弯曲 —— 细丝顺流被拉长
  float warp = fbm(vec3(cos(ang) * 1.5, sin(ang) * 1.5, lr * 2.0 + uTime * 0.015), 3, 2.0, 0.5);
  float warp2 = fbm(vec3(cos(ang) * 4.2, sin(ang) * 4.2, lr * 6.5), 3, 2.0, 0.5);
  float spiral = ang * 0.5 + lr * 3.0 + warp * 3.5;
  float radial = lr * 52.0 + warp * 14.0 + warp2 * 5.0;
  float rid = ridged(vec3(cos(spiral) * 0.85, sin(spiral) * 0.85, radial), 5);
  float fiber = ridged(vec3(cos(spiral) * 1.6, sin(spiral) * 1.6, radial * 2.7), 2);
  // 沿角向的大尺度明暗斑块，打断规则环
  float patchy = fbm(vec3(cos(ang) * 2.2, sin(ang) * 2.2, lr * 8.0), 2, 2.0, 0.5) * 0.5 + 0.5;

  float turb = (0.26 + 1.65 * clamp(rid * 0.62 + fiber * 0.26 + (low * 0.5 + 0.5) * 0.30, 0.0, 1.0)) * (0.32 + 1.35 * patchy);

  // 温度：Shakura–Sunyaev T ∝ r^(-3/4)，叠加细丝扰动
  float tN = pow(DISK_IN / r, 0.75);
  float T = uTempIn * tN * (0.82 + 0.36 * rid);

  // 开普勒切向速度（几何单位 rs=1，圆轨道 beta = sqrt(1/(2(r-1)))）
  vec3 vhat = normalize(vec3(p.z, 0.0, -p.x));
  float beta = min(0.92, sqrt(0.5 / max(r - 1.0, 0.30)));
  float gam = inversesqrt(max(1.0 - beta * beta, 0.05));
  vec3 nobs = -normalize(rd);
  float dop = 1.0 / max(gam * (1.0 - beta * dot(vhat, nobs)), 0.16);
  float grav = sqrt(max(1.0 - 1.0 / r, 0.05));
  float g = clamp(dop * grav, 0.30, 2.35);

  vec3 bb = blackbody(T * g);

  // 亮度：内缘更亮 + ISCO 热环 + 多普勒增亮（g^2.6）
  float I = pow(DISK_IN / r, 1.22) * 1.55;
  float isco = exp(-pow((r - DISK_IN - 0.30) / 0.50, 2.0)) * 0.85;
  float edge = smoothstep(DISK_IN, DISK_IN + 0.85, r) *
               (1.0 - smoothstep(DISK_OUT * 0.52, DISK_OUT, r));
  float em = I * pow(max(turb, 0.02), 1.55) * (1.0 + isco) * pow(g, 3.1) * edge * graze * uHdr;

  return bb * em;
}

void main() {
  float nu = vUv.x;
  float nv = vUv.y;
  vec3 dir = uD00 * (1.0 - nu) * (1.0 - nv)
           + uD10 * nu * (1.0 - nv)
           + uD01 * (1.0 - nu) * nv
           + (uD10 + uD01 - uD00) * nu * nv;
  dir = normalize(dir);

  // 世界 → 几何单位（rs = 1）
  vec3 p = uCamPos / uRs;
  vec3 vel = dir;
  vec3 hvec = cross(p, vel);
  float h2 = dot(hvec, hvec);

  vec3 diskCol = vec3(0.0);
  float trans = 1.0;
  bool escaped = false;

  for (int i = 0; i < ${BH_STEPS}; i++) {
    float r2 = dot(p, p);
    float r = sqrt(r2);
    if (r < 1.0) break;                        // 落入视界
    if (r > 30.0 && dot(p, vel) > 0.0) { escaped = true; break; }  // 逃逸到无穷远

    // 自适应步长：靠近黑洞时收紧
    float dr = r - 0.85;
    float dl = clamp(0.034 * dr * dr, 0.018, 0.45);

    // 光子轨道加速度（施瓦西，rs = 1）
    float r3 = r2 * r;
    vec3 acc = (-1.5 * h2 / r3) * (p / r2);
    vec3 vNew = vel + acc * dl;

    vec3 p2 = p + vNew * dl;

    // 薄盘穿越检测（y = 0 平面）
    if (p.y * p2.y < 0.0) {
      float tt = p.y / (p.y - p2.y);
      vec3 hit = mix(p, p2, tt);
      float rr = length(hit.xz);
      if (rr > DISK_IN * 0.985 && rr < DISK_OUT) {
        vec3 rdir = normalize(vNew);
        float graze = clamp(1.0 / (abs(rdir.y) * 9.0 + 0.16), 0.55, 3.2);
        vec3 c = diskSample(hit, rdir, rr, graze);
        diskCol += c * trans;
        trans *= (1.0 - clamp(0.20 * (1.0 - graze * 0.2), 0.0, 0.62));
        if (trans < 0.02) { escaped = true; break; }
      }
    }

    p = p2;
    vel = vNew;
  }

  // 步数耗尽仍未逃逸 = 被视界捕获（黑洞附近滞留的光线），阴影内必须纯黑
  vec3 col = escaped ? diskCol : vec3(0.0);

  // 飞向无穷远：方向被引力透镜偏折后采样程序化星空
  float bImp = sqrt(dot(hvec, hvec));
  if (escaped && bImp < 2.66) escaped = false;   // 临界附近的积分误差：按捕获处理
  if (escaped && bImp > 2.56) {
    vec3 outDir = normalize(vel);
    col += skySample(outDir) * (0.35 + 0.65 * trans);
  }

  // 微弱蓝移边缘补光：光子环附近（临界碰撞参数）增亮
  float b2 = dot(hvec, hvec);
  float bc = 2.598076; // 3√3/2
  float ring = exp(-pow((sqrt(b2) - bc) / 0.030, 2.0));
  col += vec3(1.0, 0.92, 0.74) * ring * 4.6;

  // 轻微抖动去 banding
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.006;

  gl_FragColor = vec4(col, uFade);
}
`;

    const bhUniforms = {
      uCamPos: { value: new THREE.Vector3() },
      uD00: { value: new THREE.Vector3() },
      uD10: { value: new THREE.Vector3() },
      uD01: { value: new THREE.Vector3() },
      uRs: { value: 1 },
      uFade: { value: 1 },
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uTempIn: { value: 9500 },
      uHdr: { value: 3.2 }
    };

    const BH_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

    const bhMat = new THREE.ShaderMaterial({
      uniforms: bhUniforms,
      vertexShader: BH_VS,
      fragmentShader: BH_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    const bhRay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bhMat);
    bhRay.frustumCulled = false;
    bhRay.renderOrder = -100;
    bhGroup.add(bhRay);

    /* ---- 近场薄雾：让盘外沿有体积辉光（极淡，加法混合） ---- */
    const bhHazeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 1 },
        uTempIn: { value: 9500 }
      },
      vertexShader: `
        varying vec2 vNdc;
        void main() {
          vNdc = position.xy;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uFade;
        uniform float uTempIn;
        varying vec2 vNdc;
        ${GS}
        void main() {
          vec2 q = vNdc;
          float rlen = length(q);
          float ang = atan(q.y, q.x);
          float band = exp(-pow(abs(q.y) * 3.1, 2.0));
          float streak = fbm(vec3(cos(ang) * 3.0, sin(ang) * 1.2, uTime * 0.05), 3, 2.0, 0.5) * 0.5 + 0.5;
          vec3 col = blackbody(uTempIn * 0.62) * band * (0.32 + 0.68 * streak) * 0.010;
          gl_FragColor = vec4(col, uFade);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const bhHaze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bhHazeMat);
    bhHaze.frustumCulled = false;
    bhHaze.renderOrder = -99;
    bhGroup.add(bhHaze);

    /* ---- 远处一颗小行星/尘埃（参考图左上的黑点） ---- */
    const bhPlanetMat = new THREE.MeshBasicMaterial({ color: 0x050608 });
    const bhPlanet = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), bhPlanetMat);
    bhPlanet.position.set(-6.2, 2.9, -8.0);
    bhGroup.add(bhPlanet);

    registerFade(bhGroup);

    /* ============================================================
     * 2. 中子星
     * ============================================================ */
    const nsGroup = new THREE.Group();
    root.add(nsGroup);

    const nsAxis = new THREE.Group();      // 磁轴倾斜
    nsAxis.rotation.z = 0.42;
    nsAxis.rotation.x = 0.22;
    nsGroup.add(nsAxis);

    const NS_TILT = new THREE.Vector3(0, 1, 0);

    /* ---- 2.1 星体：米粒/裂纹 + 极冠热斑 + 边缘光 ---- */
    const nsUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uPulse: { value: 0.3 },
      uTempK: { value: 16000 }
    };

    const nsBodyMat = new THREE.ShaderMaterial({
      uniforms: nsUniforms,
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          vP = position;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uFade;
        uniform float uPulse;
        uniform float uTempK;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        ${GS}
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(vV);
          vec3 sp = normalize(vP);

          // 主光在视空间左上前方（vN 是 view-space 法线），制造球体明暗交界
          vec3 L = normalize(vec3(-0.62, 0.42, 0.66));
          float diff = clamp(dot(n, L), 0.0, 1.0);
          diff = pow(diff, 1.15);

          // 对流米粒：多尺度元胞
          float g1 = fbm5(sp * 5.0 + vec3(0.0, uTime * 0.014, 0.0));
          float g2 = ridged(sp * 12.0, 4);
          float g3 = fbm(sp * 26.0, 3, 2.0, 0.5);
          float cells = smoothstep(-0.42, 0.40, g1) * (0.62 + 0.38 * g2);
          float speck = 0.80 + 0.20 * g3;

          // 极冠热斑（磁轴 = ±Y，nsAxis 承担倾斜）
          float capA = pow(max(0.0, sp.y), 15.0);
          float capB = pow(max(0.0, -sp.y), 15.0);
          float cap = max(capA, capB) * (0.42 + 0.58 * uPulse);

          // 暗色斑块（结晶壳 / 磁层扰动）
          float dark = smoothstep(-0.18, 0.34, fbm3(sp * 3.6 + vec3(11.0, 4.0, 7.0)));

          float T = uTempK * (0.86 + 0.24 * (g1 * 0.5 + 0.5));
          vec3 base = blackbody(T) * (0.18 + 1.22 * diff);
          base *= mix(vec3(0.38, 0.55, 1.0), vec3(1.0), diff);
          base *= (0.56 + 0.44 * cells) * (0.86 + 0.14 * speck) * vec3(0.86, 0.94, 1.14);
          base *= mix(0.62, 1.0, dark);
          base += blackbody(T) * vec3(2.1) * pow(diff, 8.0);
          // 暗面偏冷蓝，避免死黑
          base += vec3(0.06, 0.14, 0.42) * pow(1.0 - diff, 2.2) * 1.6;

          // 极冠：白热过曝
          base += vec3(0.74, 0.90, 1.38) * cap * 6.5;

          // 边缘光：蓝白、锐利，勾出球体轮廓
          float mu = clamp(dot(v, n), 0.0, 1.0);
          base *= pow(mu, 0.42);
          float rim = pow(1.0 - clamp(dot(v, n), 0.0, 1.0), 3.2);
          base += vec3(0.34, 0.62, 1.30) * rim * 4.6;

          gl_FragColor = vec4(base, uFade);
        }
      `,
      // 必须 transparent：fade 靠 alpha（uFade）过渡，否则模式切换时球体骤现骤隐会闪一下
      transparent: true,
      side: THREE.FrontSide
    });

    const nsBody = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 36), nsBodyMat);
    nsBody.renderOrder = -1;   // 透明队列里先画球体，磁层/喷流仍叠在其上（与原不透明渲染顺序一致）
    nsAxis.add(nsBody);

    /* ---- 2.2 磁层纤维壳：外围细密蓝色丝状结构（背面 + 正面两层） ---- */
    const nsHaloUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uStrength: { value: 1.0 }
    };

    const NS_HALO_FS = `
precision highp float;
uniform float uTime;
uniform float uFade;
uniform float uStrength;
varying vec3 vDir;
varying float vFront;
${GS}
void main() {
  vec3 d = normalize(vDir);
  float theta = acos(clamp(d.y, -1.0, 1.0));
  float phi = atan(d.z, d.x);
  float st = sin(theta);

  // 旋涡坐标：磁层被自转拧成螺旋
  float swirl = phi + theta * 2.3 + uTime * 0.05;
  vec3 q = vec3(cos(swirl) * st, sin(swirl) * st, cos(theta) * 1.55);

  // 三个尺度：大团块 / 中尺度丝 / 细纤维
  float f1 = fbm5(q * 3.0);
  float f2 = ridged(q * 8.5, 4);
  float f3 = ridged(q * 19.0, 3);

  float fiber = smoothstep(0.54, 0.92, f2 * 0.62 + f3 * 0.38);

  // 经线（从极区放射出的细丝）与纬线（分层环带）
  float merid = pow(abs(sin(phi * 13.0 + f1 * 1.6)), 34.0);
  float lat = pow(abs(sin(theta * 17.0 + f2 * 1.2)), 34.0);

  // 越靠赤道越密，形成包裹星体的茧
  float sheath = 0.45 + 0.55 * exp(-pow((theta - 1.42) / 1.0, 2.0));
  float streak = 0.35 + 0.65 * smoothstep(-0.35, 0.55, f1);

  float a = (fiber * 0.80 + merid * 0.62 + lat * 0.40) * sheath * streak;

  vec3 col = vec3(0.06, 0.22, 0.95) * a * 1.45;
  col += vec3(0.40, 0.66, 1.38) * pow(a, 3.0) * 1.15;

  // 正面（靠近相机的一侧）压低，避免糊住星体
  col *= mix(0.34, 1.0, vFront);

  gl_FragColor = vec4(col * uStrength * uFade, uFade);
}
`;

    const NS_HALO_VS = `
varying vec3 vDir;
varying float vFront;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFront = smoothstep(-1.0, 1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

    const nsHaloMat = new THREE.ShaderMaterial({
      uniforms: nsHaloUniforms,
      vertexShader: NS_HALO_VS,
      fragmentShader: NS_HALO_FS,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide
    });
    const nsHalo = new THREE.Mesh(new THREE.SphereGeometry(1.95, 48, 32), nsHaloMat);
    nsAxis.add(nsHalo);

    // 近侧薄纱：让星体表面蒙一层蓝色辉光
    const nsVeilMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPulse: { value: 0.3 } },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          vP = position;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uFade;
        uniform float uPulse;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        ${GS}
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(vV);
          vec3 sp = normalize(vP);
          float theta = acos(clamp(sp.y, -1.0, 1.0));
          float phi = atan(sp.z, sp.x);
          float swirl = phi + theta * 2.0 + uTime * 0.05;
          vec3 q = vec3(cos(swirl) * sin(theta), sin(swirl) * sin(theta), cos(theta) * 1.5);
          float f = fbm5(q * 5.0);
          float fil = smoothstep(0.30, 0.70, f * 0.5 + 0.5);
          float rim = pow(1.0 - max(0.0, dot(v, n)), 1.7);
          vec3 col = vec3(0.18, 0.42, 0.95) * fil * (0.30 + 0.70 * rim) * 0.20;
          gl_FragColor = vec4(col * uFade, uFade);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide
    });
    const nsVeil = new THREE.Mesh(new THREE.SphereGeometry(1.28, 40, 28), nsVeilMat);
    nsAxis.add(nsVeil);

    /* ---- 2.3 偶极磁力线（细线 + 加法混合） ---- */
    const nsFieldLines = (function () {
      const pos = [];
      const col = [];
      const rings = [1.55, 2.05, 2.7, 3.4];
      const perRing = isLow ? 8 : 14;
      const seg = 44;
      const tmpA = new THREE.Vector3();
      for (let ri = 0; ri < rings.length; ri++) {
        const L = rings[ri];
        for (let k = 0; k < perRing; k++) {
          const az = (k / perRing) * TAU + ri * 0.21;
          let prev = null;
          for (let s = 0; s <= seg; s++) {
            const th = 0.10 + (s / seg) * (PI - 0.20);
            const r = L * Math.sin(th) * Math.sin(th);
            const x = r * Math.sin(th) * Math.cos(az);
            const y = r * Math.cos(th);
            const z = r * Math.sin(th) * Math.sin(az);
            tmpA.set(x, y, z);
            if (prev) {
              pos.push(prev.x, prev.y, prev.z, tmpA.x, tmpA.y, tmpA.z);
              const f = 0.20 + 0.55 * (s / seg);
              col.push(0.22 * f, 0.45 * f, 1.0 * f, 0.22 * f, 0.45 * f, 1.0 * f);
            }
            prev = tmpA.clone();
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const m = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      m.userData.__base = 0.42;
      return new THREE.LineSegments(g, m);
    })();
    nsAxis.add(nsFieldLines);

    /* ---- 2.4 极冠射束（极淡的锥形辉光，脉冲时亮） ---- */
    const nsJetMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPulse: { value: 0.3 } },
      vertexShader: `
        varying float vY;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vY = uv.y;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uFade;
        uniform float uPulse;
        varying float vY;
        varying vec3 vN;
        varying vec3 vV;
        ${GS}
        void main() {
          float edge = pow(1.0 - abs(dot(normalize(vV), normalize(vN))), 2.2);
          float fall = pow(1.0 - clamp(vY, 0.0, 1.0), 1.5);
          float flick = 0.55 + 0.45 * sin(uTime * 2.1);
          vec3 col = vec3(0.35, 0.62, 1.25) * edge * fall * (0.25 + 0.75 * uPulse) * flick * 0.34;
          gl_FragColor = vec4(col * uFade, uFade);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    const nsJetGeo = new THREE.ConeGeometry(0.26, 6.0, 24, 1, true);
    const nsJetA = new THREE.Mesh(nsJetGeo, nsJetMat);
    nsJetA.position.y = 3.0;
    nsJetA.rotation.x = PI;
    nsAxis.add(nsJetA);
    const nsJetB = new THREE.Mesh(nsJetGeo, nsJetMat);
    nsJetB.position.y = -3.0;
    nsAxis.add(nsJetB);

    /* ---- 2.5 光晕 sprite / 背景氛围 ---- */
    const nsGlowTex = TEX.glowTexture(256);
    const nsGlowMat = new THREE.SpriteMaterial({
      map: nsGlowTex,
      color: new THREE.Color(0.32, 0.55, 1.0),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    nsGlowMat.userData.__base = 0.55;
    const nsGlow = new THREE.Sprite(nsGlowMat);
    nsGlow.scale.set(4.2, 4.2, 1);
    nsGroup.add(nsGlow);

    // 深蓝背景氛围（很大、很淡）
    const nsBackMat = new THREE.SpriteMaterial({
      map: nsGlowTex,
      color: new THREE.Color(0.10, 0.20, 0.55),
      transparent: true,
      opacity: 0.30,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    nsBackMat.userData.__base = 0.30;
    const nsBack = new THREE.Sprite(nsBackMat);
    nsBack.scale.set(30, 30, 1);
    nsBack.position.z = -6;
    nsGroup.add(nsBack);

    registerFade(nsGroup);

    /* ============================================================
     * 3. 白矮星（双星系统）
     * ============================================================ */
    const wdGroup = new THREE.Group();
    root.add(wdGroup);

    const WD_ORBIT_A = 4.0;
    const WD_ORBIT_E = 0.20;
    const WD_ORBIT_TILT = 0.52;

    /* ---- 3.1 主星：结晶表面 + 强边缘光 ---- */
    const wdUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uTempK: { value: 12000 }
    };

    const wdBodyMat = new THREE.ShaderMaterial({
      uniforms: wdUniforms,
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          vP = position;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uFade;
        uniform float uTempK;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        ${GS}
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(vV);
          vec3 sp = normalize(vP);

          // 光照明暗（视空间主光：左上前方）
          vec3 L = normalize(vec3(-0.55, 0.48, 0.68));
          float diff = pow(clamp(dot(n, L), 0.0, 1.0), 1.10);

          // 简并晶格：多尺度晶粒 + 结晶斑块 + 裂纹
          float g1 = fbm5(sp * 4.2 + vec3(uTime * 0.010, 0.0, uTime * 0.006));
          float g2 = ridged(sp * 9.5, 4);
          float g3 = fbm(sp * 22.0, 3, 2.0, 0.5);
          float facet = smoothstep(-0.30, 0.55, g1 * 0.7 + g2 * 0.3);
          float crack = ridged(sp * 15.0, 5);
          float spot = smoothstep(-0.20, 0.28, fbm3(sp * 2.6 + vec3(5.0, 9.0, 2.0)));

          vec3 base = blackbody(uTempK) * (0.20 + 1.16 * diff);
          base *= mix(vec3(0.42, 0.58, 0.98), vec3(1.0), diff);
          base *= 0.72 + 0.28 * facet;
          base *= 0.62 + 0.38 * spot;
          base *= 1.0 - 0.42 * smoothstep(0.62, 0.96, crack);
          base += blackbody(uTempK) * vec3(1.9) * pow(diff, 8.0);
          base += vec3(0.45, 0.62, 1.10) * pow(max(0.0, g3), 3.0) * 0.55 * (0.30 + 0.70 * diff);

          // 强蓝白边缘光（大气 / 吸积辉光）
          float mu = clamp(dot(v, n), 0.0, 1.0);
          base *= pow(mu, 0.42);
          float rim = pow(1.0 - clamp(dot(v, n), 0.0, 1.0), 2.6);
          base += vec3(0.52, 0.76, 1.48) * rim * 5.2;

          gl_FragColor = vec4(base, uFade);
        }
      `,
      transparent: false
    });

    const wdBody = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 40), wdBodyMat);
    wdGroup.add(wdBody);

    /* ---- 3.2 伴星（暖白小星） ---- */
    const wdCompMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 } },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uFade;
        varying vec3 vN;
        varying vec3 vV;
        ${GS}
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(vV);
          float rim = pow(1.0 - max(0.0, dot(v, n)), 1.8);
          vec3 col = blackbody(8800.0) * 1.30;
          col += vec3(1.0, 0.82, 0.55) * rim * 2.0;
          gl_FragColor = vec4(col, uFade);
        }
      `,
      transparent: false
    });
    const wdComp = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 24), wdCompMat);
    wdGroup.add(wdComp);

    const wdCompGlowMat = new THREE.SpriteMaterial({
      map: nsGlowTex,
      color: new THREE.Color(1.0, 0.86, 0.62),
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    wdCompGlowMat.userData.__base = 0.75;
    const wdCompGlow = new THREE.Sprite(wdCompGlowMat);
    wdCompGlow.scale.set(2.4, 2.4, 1);
    wdGroup.add(wdCompGlow);

    /* ---- 3.3 磁力线 / 吸积流弧（GPU 贝塞尔带状光弧） ---- */
    const WD_STRANDS = isLow ? 2 : 3;
    const wdStrandUniforms = [];
    const wdRibbons = [];

    const WD_RIBBON_VS = `
      uniform vec3 uP0;
      uniform vec3 uP1;
      uniform vec3 uP2;
      uniform float uWidth;
      varying vec2 vUv2;
      varying float vT;
      void main() {
        float t = uv.y;
        vec3 p0 = (modelViewMatrix * vec4(uP0, 1.0)).xyz;
        vec3 p1 = (modelViewMatrix * vec4(uP1, 1.0)).xyz;
        vec3 p2 = (modelViewMatrix * vec4(uP2, 1.0)).xyz;
        float it = 1.0 - t;
        vec3 pos = p0 * it * it + p1 * 2.0 * it * t + p2 * t * t;
        vec3 tang = normalize(2.0 * (1.0 - t) * (p1 - p0) + 2.0 * t * (p2 - p1) + vec3(1e-5));
        vec3 toCam = normalize(-pos);
        vec3 side = normalize(cross(tang, toCam) + vec3(1e-5));
        float taper = 0.28 + 0.72 * sin(t * 3.14159265);
        pos += side * position.x * uWidth * taper;
        vUv2 = uv;
        vT = t;
        gl_Position = projectionMatrix * vec4(pos, 1.0);
      }
    `;

    const WD_RIBBON_FS = `
      precision highp float;
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uColor;
      uniform float uGlow;
      varying vec2 vUv2;
      varying float vT;
      ${GS}
      void main() {
        float across = abs(vUv2.x - 0.5) * 2.0;
        float core = pow(1.0 - across, 2.1);
        float flow = 0.52 + 0.48 * sin((vT * 8.0 - uTime * 1.15) * 3.14159265);
        float ends = smoothstep(0.0, 0.09, vT) * smoothstep(1.0, 0.91, vT);
        float a = core * flow * ends;
        vec3 col = uColor * a * uGlow;
        col += vec3(1.0) * pow(core, 7.0) * a * uGlow * 0.30;
        gl_FragColor = vec4(col * uFade, uFade);
      }
    `;

    const wdRibbonGeo = new THREE.PlaneGeometry(1, 1, 1, 40);
    for (let s = 0; s < WD_STRANDS; s++) {
      const u = {
        uP0: { value: new THREE.Vector3() },
        uP1: { value: new THREE.Vector3() },
        uP2: { value: new THREE.Vector3() },
        uWidth: { value: 0.105 + s * 0.016 },
        uTime: { value: 0 },
        uFade: { value: 1 },
        uColor: { value: new THREE.Color(0.34 + s * 0.05, 0.60, 1.25) },
        uGlow: { value: 6.2 - s * 0.55 }
      };
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: WD_RIBBON_VS,
        fragmentShader: WD_RIBBON_FS,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(wdRibbonGeo, m);
      mesh.frustumCulled = false;
      wdGroup.add(mesh);
      wdStrandUniforms.push(u);
      wdRibbons.push(mesh);
    }

    // 弧上的流动光点
    const WD_PTS = WD_STRANDS * 26;
    const wdPointPos = new Float32Array(WD_PTS * 3);
    const wdPointGeo = new THREE.BufferGeometry();
    wdPointGeo.setAttribute('position', new THREE.BufferAttribute(wdPointPos, 3));
    const wdPointMat = new THREE.PointsMaterial({
      size: 0.085,
      map: nsGlowTex,
      color: new THREE.Color(0.70, 0.86, 1.0),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
    wdPointMat.userData.__base = 0.9;
    const wdPoints = new THREE.Points(wdPointGeo, wdPointMat);
    wdPoints.frustumCulled = false;
    wdGroup.add(wdPoints);

    /* ---- 3.4 轨道环 + 极淡行星状星云壳 ---- */
    const wdOrbitGeo = (function () {
      const pos = [];
      const N = 160;
      for (let i = 0; i < N; i++) {
        const a1 = (i / N) * TAU;
        const a2 = ((i + 1) / N) * TAU;
        const r1 = 1 + WD_ORBIT_E * Math.sin(a1);
        const r2 = 1 + WD_ORBIT_E * Math.sin(a2);
        pos.push(
          Math.cos(a1) * r1 * WD_ORBIT_A, 0, Math.sin(a1) * r1 * WD_ORBIT_A,
          Math.cos(a2) * r2 * WD_ORBIT_A, 0, Math.sin(a2) * r2 * WD_ORBIT_A
        );
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      return g;
    })();
    const wdOrbitMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.30, 0.42, 0.75),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    wdOrbitMat.userData.__base = 0.22;
    const wdOrbit = new THREE.LineSegments(wdOrbitGeo, wdOrbitMat);
    wdOrbit.rotation.x = WD_ORBIT_TILT;
    wdGroup.add(wdOrbit);

    // 极淡行星状星云壳（保留一点"白矮星来自行星状星云"的语境）
    const wdShell = (function () {
      const n = isLow ? 700 : 1500;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const sizes = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u1 = Math.random();
        const u2 = Math.random();
        const th = Math.acos(2 * u1 - 1);
        const ph = TAU * u2;
        const r = 3.4 + (Math.random() - 0.5) * 2.6;
        const x = r * Math.sin(th) * Math.cos(ph);
        const y = r * Math.cos(th) * 0.55;
        const z = r * Math.sin(th) * Math.sin(ph);
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        const mixv = Math.random();
        col[i * 3] = 0.07 + 0.07 * mixv;
        col[i * 3 + 1] = 0.18 + 0.20 * mixv;
        col[i * 3 + 2] = 0.40 + 0.30 * (1 - mixv);
        sizes[i] = 0.02 + Math.random() * 0.05;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPixelRatio: { value: DPR } },
        vertexShader: `
          uniform float uTime;
          uniform float uPixelRatio;
          attribute float aSize;
          varying vec3 vColor;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * uPixelRatio * (900.0 / max(-mv.z, 1.0));
            vColor = color;
          }
        `,
        fragmentShader: `
          precision highp float;
          uniform float uFade;
          varying vec3 vColor;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c) * 2.0;
            float a = 1.0 - smoothstep(0.0, 1.0, d);
            a = pow(a, 2.0);
            gl_FragColor = vec4(vColor, a * uFade);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
        side: THREE.BackSide
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      return pts;
    })();
    wdShell.rotation.x = WD_ORBIT_TILT * 0.7;
    wdGroup.add(wdShell);

    // 主星背景辉光
    const wdGlowMat = new THREE.SpriteMaterial({
      map: nsGlowTex,
      color: new THREE.Color(0.55, 0.75, 1.0),
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    wdGlowMat.userData.__base = 0.45;
    const wdGlow = new THREE.Sprite(wdGlowMat);
    wdGlow.scale.set(6.8, 6.8, 1);
    wdGroup.add(wdGlow);

    registerFade(wdGroup);

    /* ============================================================
     * 4. 相机 / 状态 / 更新
     * ============================================================ */

    // 每种模式的默认机位：主体偏右（左侧留给 .ch-copy 文案）
    const MODES = {
      blackhole: { yaw: 0.62, pitch: 0.068, dist: 18.2 },
      neutronstar: { yaw: 0.30, pitch: 0.18, dist: 8.4 },
      whitedwarf: { yaw: 0.34, pitch: 0.11, dist: 9.9 }
    };

    const FRAMING = 1.04;
    const BASE_FOV = (camera.userData && camera.userData.baseFov) || 40;
    const VIEW_SHIFT = { x: -0.005, y: 0.03 };

    function applyViewShift() {
      if (!camera.setViewOffset) return;
      camera.setViewOffset(
        vw, vh,
        Math.round(vw * VIEW_SHIFT.x),
        Math.round(vh * VIEW_SHIFT.y),
        vw, vh
      );
    }
    applyViewShift();

    const view = {
      yaw: MODES.blackhole.yaw,
      pitch: MODES.blackhole.pitch,
      dist: MODES.blackhole.dist,
      tYaw: MODES.blackhole.yaw,
      tPitch: MODES.blackhole.pitch,
      tDist: MODES.blackhole.dist,
      hold: 0
    };

    const fade = { blackhole: 1, neutronstar: 0, whitedwarf: 0 };
    const fadeTarget = { blackhole: 1, neutronstar: 0, whitedwarf: 0 };
    let curMode = state.compact.mode || 'blackhole';
    let prevMode = curMode;
    let curMass = CLAMP(state.compact.mass || 10, 1, 50);
    let pulse = 0.3;

    // 预分配临时变量（update 内不 new）
    const _v = new THREE.Vector3();
    const _v2 = new THREE.Vector3();
    const _v3 = new THREE.Vector3();
    const _beam = new THREE.Vector3(0, 1, 0);
    const _pole = new THREE.Vector3();
    const _corner = new THREE.Vector3();
    const _comp = new THREE.Vector3();
    const _ca = new THREE.Vector3();
    const _cb = new THREE.Vector3();
    const _cc = new THREE.Vector3();
    const _cp = new THREE.Vector3();

    /* ---- 黑洞：每帧从相机矩阵反投影出三个角方向（含 viewOffset） ---- */
    function updateBhRayDirs() {
      camera.updateMatrixWorld();
      const pi = camera.projectionMatrixInverse;
      const mw = camera.matrixWorld;

      _corner.set(-1, -1, 0.5).applyMatrix4(pi).applyMatrix4(mw).sub(camera.position).normalize();
      bhUniforms.uD00.value.copy(_corner);
      _corner.set(1, -1, 0.5).applyMatrix4(pi).applyMatrix4(mw).sub(camera.position).normalize();
      bhUniforms.uD10.value.copy(_corner);
      _corner.set(-1, 1, 0.5).applyMatrix4(pi).applyMatrix4(mw).sub(camera.position).normalize();
      bhUniforms.uD01.value.copy(_corner);

      bhUniforms.uCamPos.value.copy(camera.position);
      bhHazeMat.uniforms.uTime.value = time;
    }

    function updateFades(dt) {
      fadeTarget.blackhole = curMode === 'blackhole' ? 1 : 0;
      fadeTarget.neutronstar = curMode === 'neutronstar' ? 1 : 0;
      fadeTarget.whitedwarf = curMode === 'whitedwarf' ? 1 : 0;
      fade.blackhole = DAMP(fade.blackhole, fadeTarget.blackhole, 9, dt);
      fade.neutronstar = DAMP(fade.neutronstar, fadeTarget.neutronstar, 9, dt);
      fade.whitedwarf = DAMP(fade.whitedwarf, fadeTarget.whitedwarf, 9, dt);
      applyFade(bhGroup, fade.blackhole);
      applyFade(nsGroup, fade.neutronstar);
      applyFade(wdGroup, fade.whitedwarf);
      // 整组可见性：不在场的模式必须彻底移出渲染（否则未收集到 uFade 的对象会串色）
      bhGroup.visible = fade.blackhole > 0.004;
      nsGroup.visible = fade.neutronstar > 0.004;
      wdGroup.visible = fade.whitedwarf > 0.004;
      starfield.visible = fade.blackhole < 0.996;
      bhRay.visible = fade.blackhole > 0.004;
      bhHaze.visible = false;
    }

    function updateCamera(dt, p) {
      const mode = MODES[curMode] || MODES.blackhole;

      const entryT = U.smoothstep(0.10, 0.86, p || 0);
      entry = LERP(1.14, 1.0, entryT);

      if (input.dragging && input.down && !input.uiTarget) {
        view.tYaw -= input.dx * 0.0048;
        view.tPitch = CLAMP(view.tPitch + input.dy * 0.0038, -0.82, 1.20);
        view.hold = 2.6;
      }
      if (view.hold > 0) view.hold -= dt;
      if (!reduceMotion && view.hold <= 0) view.tYaw += dt * 0.026;

      // 普通滚轮与 Ctrl/⌘+滚轮都缩放（boot.js §3.5 已把非 UI 区域的普通滚轮路由到 input.wheel）
      const wheel = (input.wheelCtrl || 0) + (input.wheel || 0);
      if (wheel) view.tDist = CLAMP(view.tDist + wheel * 0.012, 5.0, 46);
      if (input.pinch) view.tDist = CLAMP(view.tDist / Math.max(0.9, 1 + input.pinch * 0.5), 5.0, 46);
      const keys = input.keys || {};
      if (keys['+'] || keys['=']) view.tDist = CLAMP(view.tDist - dt * 7, 5.0, 46);
      if (keys['-'] || keys['_']) view.tDist = CLAMP(view.tDist + dt * 7, 5.0, 46);

      view.yaw = DAMP(view.yaw, view.tYaw, 7, dt);
      view.pitch = DAMP(view.pitch, view.tPitch, 7, dt);
      view.dist = DAMP(view.dist, view.tDist, 6, dt);

      const d = view.dist * entry;
      const cp = Math.cos(view.pitch);
      camera.position.set(
        d * cp * Math.sin(view.yaw),
        d * Math.sin(view.pitch),
        d * cp * Math.cos(view.yaw)
      );
      camera.lookAt(0, 0, 0);
      void mode;
    }

    /* 缩放控件（.deep-zoom 按钮）→ 视角缩放：与滚轮 / pinch 共用同一个目标距离 */
    if (COSMOS.on) {
      COSMOS.on('cosmos:compact:zoom', function (e) {
        const step = (e && e.step) || 0;
        if (!step) return;
        view.tDist = CLAMP(view.tDist * (step > 0 ? 0.82 : 1.22), 5.0, 46);
      });
    }

    function updateBlackhole(t, dt) {
      const mass = curMass;
      // 视界半径（世界单位）：质量越大，阴影越大
      const rsVis = CLAMP(0.95 * Math.pow(mass / 10, 0.30), 0.52, 1.45);

      const u = bhUniforms;
      u.uRs.value = rsVis;
      u.uTime.value = t;
      u.uSpeed.value = CLAMP(10 / mass, 0.35, 2.4);
      u.uTempIn.value = CLAMP(6100 * Math.pow(mass / 10, 0.10), 5000, 9000);
      u.uHdr.value = 16.0;

      bhHazeMat.uniforms.uTempIn.value = u.uTempIn.value;
      bhHazeMat.uniforms.uFade.value = fade.blackhole * 0.9;

      // 小行星缓慢自转/漂移
      bhPlanet.rotation.y += dt * 0.1;
      updateBhRayDirs();
    }

    function updateNeutronstar(t, dt) {
      // 自转周期 1.4 s 示意（极冠脉冲）
      const spin = (PI * 2) / 1.4;
      nsAxis.rotation.y += dt * spin * 0.32;

      // 极冠是否朝向相机
      _pole.set(0, 1, 0).applyQuaternion(nsAxis.quaternion).applyQuaternion(nsGroup.quaternion);
      _v.copy(camera.position).normalize();
      const alignA = _pole.dot(_v);
      const alignB = -alignA;
      const target = 0.10 + 0.90 * Math.pow(Math.max(alignA, alignB), 12);
      pulse = DAMP(pulse, target, 18, dt);

      nsUniforms.uTime.value = t;
      nsUniforms.uPulse.value = pulse;
      nsVeilMat.uniforms.uTime.value = t;
      nsVeilMat.uniforms.uPulse.value = pulse;
      nsHaloUniforms.uTime.value = t;
      nsFieldLines.material.opacity = 0.30 * (0.55 + 0.45 * pulse) * fade.neutronstar;
      nsJetMat.uniforms.uTime.value = t;
      nsJetMat.uniforms.uPulse.value = pulse;

      nsGlow.material.opacity = (0.42 + 0.30 * pulse) * fade.neutronstar;
      nsBack.material.opacity = 0.35 * fade.neutronstar;
    }

    function updateWhitedwarf(t, dt) {
      wdGroup.rotation.y += dt * 0.05;

      // 主星自转 + 缓慢冷却
      wdBody.rotation.y += dt * 0.055;
      wdUniforms.uTime.value = t;
      wdUniforms.uTempK.value = 12000 - 900 * (0.5 + 0.5 * Math.sin(t * 0.09));

      wdShell.material.uniforms.uTime.value = t;
      wdShell.rotation.y += dt * 0.008;
      wdGlow.material.opacity = (0.52 + 0.12 * Math.sin(t * 0.33)) * fade.whitedwarf;

      // 伴星：固定在画面左上方的视觉位（保证构图），带轻微呼吸摆动
      const ang = t * 0.24 + 2.2;
      _comp.set(-1.68 + 0.20 * Math.sin(t * 0.21), 1.30 + 0.14 * Math.sin(t * 0.33 + 1.1), -0.50 + 0.16 * Math.cos(t * 0.19));
      wdComp.position.copy(_comp);
      wdCompGlow.position.copy(_comp);

      // 磁力线 / 吸积流弧：主星极区弯向伴星（GPU 贝塞尔）
      const phases = [0.0, 2.1, 4.2];
      for (let s = 0; s < WD_STRANDS; s++) {
        const u = wdStrandUniforms[s];
        const a0 = t * 0.10 + phases[s];
        _ca.set(Math.cos(a0) * 0.52, 0.84, Math.sin(a0) * 0.52);
        _cb.copy(_comp);
        _cc.copy(_ca).add(_cb).multiplyScalar(0.5);
        _cc.y += 2.85 + 0.42 * Math.sin(t * 0.35 + s * 1.9);
        _cc.x += 0.42 * Math.sin(t * 0.21 + s * 1.7);
        _cc.z += 0.42 * Math.cos(t * 0.17 + s * 1.3);
        u.uP0.value.copy(_ca);
        u.uP1.value.copy(_cc);
        u.uP2.value.copy(_cb);
        u.uTime.value = t;
        u.uFade.value = fade.whitedwarf;
      }

      // 流动光点：沿贝塞尔弧运动
      let pi2 = 0;
      for (let s = 0; s < WD_STRANDS; s++) {
        const u = wdStrandUniforms[s];
        for (let k = 0; k < 26; k++) {
          const f = (k / 26 + (t * 0.13 + s * 0.31)) % 1;
          const it = 1 - f;
          const w0 = it * it;
          const w1 = 2 * it * f;
          const w2 = f * f;
          wdPointPos[pi2 * 3] = u.uP0.value.x * w0 + u.uP1.value.x * w1 + u.uP2.value.x * w2;
          wdPointPos[pi2 * 3 + 1] = u.uP0.value.y * w0 + u.uP1.value.y * w1 + u.uP2.value.y * w2;
          wdPointPos[pi2 * 3 + 2] = u.uP0.value.z * w0 + u.uP1.value.z * w1 + u.uP2.value.z * w2;
          pi2++;
        }
      }
      wdPointGeo.attributes.position.needsUpdate = true;
      wdPointGeo.computeBoundingSphere();
    }

    function update(t, dt, p) {
      time = t;
      const s = state.compact || {};
      curMode = MODES[s.mode] ? s.mode : 'blackhole';
      curMass = CLAMP(s.mass || 10, 1, 50);

      if (curMode !== prevMode) {
        const nm = MODES[curMode];
        view.tYaw = nm.yaw;
        view.tPitch = nm.pitch;
        view.tDist = nm.dist;
        prevMode = curMode;
      }

      updateCamera(dt, p);
      updateFades(dt);

      if (starfield.material && starfield.material.uniforms) {
        starfield.material.uniforms.uTime.value = t;
        starfield.material.uniforms.uPixelRatio.value = DPR;
        starfield.material.uniforms.uOpacity.value = (1.0 - fade.blackhole) * (1.0 - 0.55 * fade.whitedwarf);
      }

      // 黑洞光追的角方向必须在相机更新之后计算
      updateBlackhole(t, dt);
      updateNeutronstar(t, dt);
      updateWhitedwarf(t, dt);
    }

    function resize(w, h) {
      vw = w || vw;
      vh = h || vh;
      const aspect = vw / Math.max(1, vh);
      camera.aspect = aspect;
      U.fitCamera(camera, BASE_FOV, aspect);
      applyViewShift();
      wdShell.material.uniforms.uPixelRatio.value = DPR;
    }

    function reset() {
      const mode = MODES[curMode] || MODES.blackhole;
      view.tYaw = mode.yaw;
      view.tPitch = mode.pitch;
      view.tDist = mode.dist;
      view.yaw = mode.yaw;
      view.pitch = mode.pitch;
      view.dist = mode.dist;
      view.hold = 0;
    }

    function enter() {
      curMode = MODES[state.compact.mode] ? state.compact.mode : 'blackhole';
      const mode = MODES[curMode];
      view.yaw = mode.yaw;
      view.pitch = mode.pitch;
      view.dist = mode.dist;
      view.tYaw = mode.yaw;
      view.tPitch = mode.pitch;
      view.tDist = mode.dist;
      view.hold = 0;
      fade.blackhole = curMode === 'blackhole' ? 1 : 0;
      fade.neutronstar = curMode === 'neutronstar' ? 1 : 0;
      fade.whitedwarf = curMode === 'whitedwarf' ? 1 : 0;
      applyFade(bhGroup, fade.blackhole);
      applyFade(nsGroup, fade.neutronstar);
      applyFade(wdGroup, fade.whitedwarf);
    }

    function leave() {}

    function dispose() {
      U.disposeGroup(scene);
    }

    // 初始化默认模式的淡入状态
    fade.blackhole = curMode === 'blackhole' ? 1 : 0;
    fade.neutronstar = curMode === 'neutronstar' ? 1 : 0;
    fade.whitedwarf = curMode === 'whitedwarf' ? 1 : 0;
    applyFade(bhGroup, fade.blackhole);
    applyFade(nsGroup, fade.neutronstar);
    applyFade(wdGroup, fade.whitedwarf);

    return {
      scene: scene,
      camera: camera,
      update: update,
      resize: resize,
      enter: enter,
      leave: leave,
      dispose: dispose,
      reset: reset,
      bloom: { strength: 0.72, radius: 0.78, threshold: 1.02 }
    };
  });
})(window.COSMOS);
