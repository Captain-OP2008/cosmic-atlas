/* ============================================================
 * COSMOS ATLAS · 07 恒星的一生 —— 3D 舞台（v4 重做：真的在发光）
 * ------------------------------------------------------------
 * 质量 0.08–40 M☉ + 五个阶段（0 星云 / 1 主序星 / 2 红巨星 /
 * 3 超新星或行星状星云 / 4 残骸）。参数由 widget 写入
 * COSMOS.state.stellar，场景只读，每帧向目标值插值。
 *
 * 视觉结构（全部程序化、GPU 动画，update() 内不重建）：
 *   - 星面：域扭曲细胞噪声（米粒组织 + 超米粒）、物理临边昏暗、
 *     黑体色温随 μ 下降、半影纤维黑子、Hα 色球红边，中心 HDR 1.6–3.5
 *   - 色球壳 + 3 层「冲击参数」日冕壳（冕流 / 盔状流，无洋葱环）
 *   - 日珥：相机朝向 ribbon 带（顶点着色器 billboard），纤维与摆动
 *   - 红巨星：尘埃包层（置于星体后方，只露外缘）+ 更粗的暗缝
 *   - 超新星：全屏 HDR 闪光 + 冲击波环 + 元素分层抛射壳 + 反向激波
 *   - 残骸：白矮星晶面 / 脉冲星磁轴锥束 + 极冠 + 风眼环 / 黑洞多普勒盘
 *     + 光子环 + 透镜上拱
 *
 * 颜色全部来自 COSMOS.GLSL.blackbody()：温度变，颜色才变。
 * 预算（high）：draw call ≤ 48，三角 ≈ 8–9 万，粒子 ≈ 1.2 万。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  const U = COSMOS.util;
  if (!THREE || !U) return;

  const CLAMP = U.clamp;
  const LERP = U.lerp;
  const DAMP = U.damp;
  const SSTEP = U.smoothstep;

  const GLIB = COSMOS.GLSL || {};
  const GLSL_NOISE = GLIB.noise || '';
  const GLSL_FBM = GLIB.fbm || '';
  const GLSL_STANDARD = GLIB.standard || '';

  COSMOS.registerStage('stellar', function (ctx) {
    const M = COSMOS.deepModel;
    const state = (COSMOS.state = COSMOS.state || {});
    if (!state.stellar) state.stellar = { mass: 1, phase: 1 };

    const input = ctx.input || COSMOS.input || {};
    const quality = ctx.quality || 'high';
    const reduceMotion = !!ctx.reduceMotion;
    const DPR = ctx.pixelRatio || 1;
    const isLow = quality === 'low';
    const TEX = COSMOS.tex;

    const scene = new THREE.Scene();
    const camera = U.makeCamera(42, ctx.aspect);
    const root = new THREE.Group();
    scene.add(root);

    const FRAMING = 1.12;
    const BASE_FOV = camera.userData && camera.userData.baseFov ? camera.userData.baseFov : 42;
    const VIEW_SHIFT = { x: -0.09, y: 0.02 };
    let vw = ctx.width || 1280;
    let vh = ctx.height || 800;

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

    /* ============================================================
     * 0. 背景：星野 + 两团远处气体
     * ============================================================ */
    const starfield = COSMOS.builders.makeStarfield({
      count: isLow ? 3000 : (quality === 'medium' ? 4800 : 6400),
      rMin: 120,
      rMax: 420
    });
    scene.add(starfield);

    const backdropMats = [];
    const backdropColors = [0x24384f, 0x3a2436];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.SpriteMaterial({
        map: TEX.cloudTexture(256),
        color: backdropColors[i],
        transparent: true,
        opacity: i === 0 ? 0.12 : 0.09,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const spr = new THREE.Sprite(mat);
      spr.position.set(i === 0 ? -24 : 20, i === 0 ? 12 : -14, -46);
      spr.scale.set(i === 0 ? 60 : 44, i === 0 ? 34 : 28, 1);
      scene.add(spr);
      backdropMats.push(mat);
    }

    /* ============================================================
     * 1. 主星：自发光星面 + 色球 + 日冕 + 日珥 + 耀斑
     * ============================================================ */
    const starGroup = new THREE.Group();
    root.add(starGroup);


    /* ============================================================
     * 0. 程序化星面贴图：米粒组织 / 黑子 / 光斑
     *    等距圆柱投影（UV 与 SphereGeometry 天然一致），x 方向周期。
     *    Canvas 2D 绘制一次，之后只做一次上传，运行时零开销。
     * ============================================================ */
    function makeGranuleTexture(W) {
      const H = W >> 1;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');

      /* 暗底：细胞之间自然留下的暗缝 */
      g.fillStyle = '#2a2a2a';
      g.fillRect(0, 0, W, H);

      /* 超米粒：低频亮度起伏（大块 120–260px 的明暗斑） */
      for (let i = 0; i < 90; i++) {
        const x = Math.random() * W, y = Math.random() * H;
        const r = 60 + Math.random() * 200;
        const a = 0.10 + Math.random() * 0.16;
        const bright = Math.random() > 0.42;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, bright ? 'rgba(190,190,190,' + a + ')' : 'rgba(26,26,26,' + a + ')');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
      }

      /* 米粒：约 2200 个亮心细胞，lighter 叠加 → 细胞壁自动变暗 */
      g.globalCompositeOperation = 'lighter';
      const N = Math.round(W * H / 950);
      for (let i = 0; i < N; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const r = 3.2 + Math.pow(Math.random(), 1.7) * 11.5;
        const v = 96 + Math.random() * 120;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0.00, 'rgba(' + v + ',' + v + ',' + v + ',0.96)');
        grd.addColorStop(0.42, 'rgba(' + (v * 0.74 | 0) + ',' + (v * 0.74 | 0) + ',' + (v * 0.74 | 0) + ',0.62)');
        grd.addColorStop(0.80, 'rgba(' + (v * 0.34 | 0) + ',' + (v * 0.34 | 0) + ',' + (v * 0.34 | 0) + ',0.22)');
        grd.addColorStop(1.00, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
      }
      g.globalCompositeOperation = 'source-over';

      /* 细胞间隙的纤维状暗纹：细长弧 */
      g.globalCompositeOperation = 'multiply';
      for (let i = 0; i < 1200; i++) {
        const x = Math.random() * W, y = Math.random() * H;
        const r = 6 + Math.random() * 26;
        const a0 = Math.random() * 6.2832, a1 = a0 + 0.5 + Math.random() * 1.4;
        g.strokeStyle = 'rgba(74,74,74,' + (0.10 + Math.random() * 0.16).toFixed(3) + ')';
        g.lineWidth = 0.7 + Math.random() * 1.5;
        g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';

      /* 黑子：本影（近黑）+ 半影（暗灰丝） */
      const spots = 3 + (Math.random() * 3 | 0);
      for (let i = 0; i < spots; i++) {
        const x = Math.random() * W;
        const y = H * (0.24 + Math.random() * 0.52);
        const rU = 7 + Math.random() * 13;
        const rP = rU * (1.9 + Math.random() * 0.8);
        const grdP = g.createRadialGradient(x, y, rU * 0.7, x, y, rP);
        grdP.addColorStop(0, 'rgba(24,24,24,0.92)');
        grdP.addColorStop(0.55, 'rgba(70,70,70,0.62)');
        grdP.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grdP;
        g.beginPath(); g.arc(x, y, rP, 0, 6.2832); g.fill();
        const grdU = g.createRadialGradient(x, y, 0, x, y, rU);
        grdU.addColorStop(0, 'rgba(8,8,8,0.97)');
        grdU.addColorStop(0.78, 'rgba(18,18,18,0.95)');
        grdU.addColorStop(1, 'rgba(30,30,30,0.72)');
        g.fillStyle = grdU;
        g.beginPath(); g.arc(x, y, rU, 0, 6.2832); g.fill();
      }

      /* 光斑（faculae）：少量亮斑，主要在活动区附近 */
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 46; i++) {
        const x = Math.random() * W, y = Math.random() * H;
        const r = 10 + Math.random() * 34;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.20)');
        grd.addColorStop(0.5, 'rgba(220,220,220,0.08)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
      }
      g.globalCompositeOperation = 'source-over';

      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      return tex;
    }

    const starUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uIntensity: { value: 1 },
      uGiant: { value: 0 },
      uSpot: { value: 0.35 },
      uFlash: { value: 0 },
      uTempK: { value: 5772 },
      uGranScale: { value: 28 },
      uEdgeRough: { value: 0 },
      uProto: { value: 0 },
      uGranTex: { value: makeGranuleTexture(isLow ? 1024 : 2048) }
    };

    const STAR_VS = GLSL_NOISE + `
uniform float uTime;
uniform float uGiant;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec3 dir = normalize(position);
  float d1 = snoise(dir * 2.4 + vec3(0.0, uTime * 0.025, 0.0));
  float d2 = snoise(dir * 5.6 - vec3(uTime * 0.018, 0.0, 0.0));
  float k = 0.003 + 0.015 * uGiant;
  vec3 pos = position * (1.0 + (d1 + 0.45 * d2) * k);
  vPos = dir;
  vUv = uv;
  vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

    const STAR_FS = 'precision highp float;\n' + GLSL_STANDARD + `
uniform float uTime;
uniform float uFade;
uniform float uIntensity;
uniform float uGiant;
uniform float uSpot;
uniform float uFlash;
uniform float uTempK;
uniform float uGranScale;
uniform float uEdgeRough;
uniform float uProto;
uniform sampler2D uGranTex;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 vdir = normalize(cameraPosition - vWorld);
  float mu = clamp(dot(n, vdir), 0.0, 1.0);

  /* ---- 米粒组织：倍频细胞噪声 ----------------------------------------
     尺度：vPos 在 -1..1（直径 2 单位）。星面直径约 265px 时，
     1 单位 ≈ 132px，细胞 9–13px → 主频 ≈ 13；
     二级 34 频做细胞内碎纹；超米粒 5 频做 ±18% 大尺度调制。 */
  /* 红巨星：米粒尺度平滑放大 4.5 倍，变成"大对流胞"，而不是小米粒放大 */
  vec3 q = vPos * uGranScale;
  q += vec3(sin(uTime * 0.30), 0.0, cos(uTime * 0.27)) * 0.22;
  vec3 wq = q * 0.42 + vec3(0.0, 0.0, uTime * 0.045);
  vec3 warp = vec3(
    snoise(wq),
    snoise(wq + vec3(4.7, 1.3, 0.0)),
    snoise(wq + vec3(9.1, 7.7, 3.3))
  ) * 0.30;                       /* 约 0.3 个细胞宽，别把细胞撕碎 */
  vec3 qw = q + warp;

  /* 细胞核（亮）→ 细胞间隙（暗缝） */
  float n1 = snoise(qw);
  float cell = smoothstep(0.0, 0.38, n1);
  float lane = 1.0 - smoothstep(0.0, 0.16, abs(n1));
  float gran = mix(0.66, 1.00, cell);
  gran *= 1.0 - mix(0.12, 0.30, uGiant) * lane;

  /* 贴图细节：两层不同速度滚动，模拟米粒演化（贴图来自 makeGranuleTexture） */
  /* 三平面采样：彻底消除球面 UV 接缝（接缝会投影成一条亮线） */
  vec3 nn = normalize(vPos);
  vec3 bw = pow(abs(nn) + 0.0015, vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  float fq = uGranScale * 1.55;
  float tx = texture2D(uGranTex, nn.zy * fq + vec2(uTime * 0.0026, 0.0)).r;
  float ty = texture2D(uGranTex, nn.xz * fq + vec2(-uTime * 0.0017, uTime * 0.0011)).r;
  float tz = texture2D(uGranTex, nn.xy * fq + vec2(uTime * 0.0013, -uTime * 0.0009)).r;
  float texGran = tx * bw.x + ty * bw.y + tz * bw.z;
  gran *= 0.56 + 0.92 * texGran;
  /* 细胞内碎纹 */
  float frag = snoise(qw * 2.6 + vec3(0.0, 0.0, uTime * 0.060));
  gran *= 0.95 + 0.09 * frag;
  /* 超米粒：5 频、±18% */
  float sg = smoothstep(-0.25, 0.65, snoise(q * 0.38 + vec3(uTime * 0.050, 0.0, 0.0)));
  gran *= mix(0.82, 1.18, sg);
  gran = clamp(gran, 0.46, 1.30);

  /* ---- 原恒星（诞生阶段）：团块状吸积表面，覆盖掉规则米粒 ---- */
  float proto = clamp(uProto, 0.0, 1.0);
  if (proto > 0.01) {
    float cl = fbm(vPos * 3.1 + vec3(0.0, uTime * 0.045, 0.0), 4, 2.0, 0.5);
    float cl2 = fbm(vPos * 7.3 - vec3(uTime * 0.03, 0.0, 0.0), 3, 2.0, 0.5);
    float lump = 0.52 + 0.78 * cl + 0.24 * cl2;
    gran = mix(gran, clamp(lump, 0.42, 1.45), proto);
  }

  /* ---- 色温：暗缝更冷、临边更冷（黑体色温已含临边下降） ---- */
  float temp = uTempK * mix(0.86, 1.0, sqrt(mu));
  vec3 bb = blackbody(temp);
  vec3 bbLane = blackbody(temp * 0.93);
  vec3 bbSurf = mix(bbLane, bb, smoothstep(0.55, 0.95, gran));

  /* ---- 黑子：本影 + 纤维状半影，只出现在 ±20°–50° 纬度带 ---- */
  float sp = snoise(vec3(vPos.x * 5.6 + 17.0, vPos.y * 7.2 + 3.0, vPos.z * 5.6 + 11.0));
  float band = smoothstep(0.20, 0.38, abs(vPos.y)) * (1.0 - smoothstep(0.72, 0.90, abs(vPos.y)));
  float spot = smoothstep(0.36, 0.62, sp) * uSpot * band;
  float umbra = smoothstep(0.60, 0.80, sp) * uSpot * band;
  float penumbra = max(spot - umbra, 0.0);
  float penFib = 0.82 + 0.18 * snoise(q * 0.55);
  float spotMul = 1.0 - (0.84 * umbra + 0.48 * penumbra * penFib) * mix(1.0, 0.34, uGiant);

  /* ---- 亮度：中心 1.42 / 0.7R ~0.85 / 临边 0.26
     刻意压到 ACES 的线性段（x<1.5），否则米粒 38% 对比会被色调映射压成 2%；
     泛光交给日冕 + 光晕 sprite，不靠日面过曝。 ---- */
  float xm = 1.0 - mu;
  float limbLaw = 1.0 - 0.62 * xm - 0.26 * xm * xm + 0.14 * xm * xm * xm - 0.06 * xm * xm * xm * xm;
  float prof = 2.85 * limbLaw;
  float lum = prof * gran * spotMul;
  float roughness = uEdgeRough * pow(1.0 - mu, 2.0);
  lum *= mix(1.0, 0.80 + 0.36 * snoise(vPos * 3.6 + vec3(uTime * 0.05, 0.0, 0.0)), roughness);

  vec3 col = bbSurf * lum * uIntensity * vec3(1.0, 0.975, 0.94) * 1.0;

  /* ---- 色球：Hα 细边，只占边缘 4–6% 半径 ---- */
  float chrom = pow(1.0 - mu, 4.5) * 0.58;
  chrom *= 0.62 + 0.38 * snoise(vPos * 11.0 + vec3(uTime * 0.25, 0.0, 0.0));
  col += vec3(1.0, 0.33, 0.16) * chrom * uFade;

  /* ---- 光斑：活动区临边的亮纹（faculae） ---- */
  float facN = snoise(vPos * 11.0 + vec3(uTime * 0.02, 3.7, 0.0));
  float fac = pow(1.0 - mu, 3.4) * smoothstep(0.10, 0.62, facN);
  col += bb * fac * 0.85 * uFade;

  /* ---- 闪光 ---- */
  col = mix(col, vec3(3.2, 3.0, 2.6), uFlash * 0.9);

  gl_FragColor = vec4(col, uFade);
}`;

    const starMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, isLow ? 64 : 160, isLow ? 40 : 96),
      new THREE.ShaderMaterial({
        uniforms: starUniforms,
        vertexShader: STAR_VS,
        fragmentShader: STAR_FS,
        transparent: true
      })
    );
    starMesh.renderOrder = 1;
    starGroup.add(starMesh);

    /* ---- 色球壳：1.008R 的 Hα 红边 ---- */
    const chromoUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uIntensity: { value: 1 },
      uOpacity: { value: 0.0 }
    };
    const CHROMO_VS = `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vPos = normalize(position);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
    const CHROMO_FS = 'precision highp float;\n' + GLSL_NOISE + `
uniform float uTime;
uniform float uFade;
uniform float uIntensity;
uniform float uOpacity;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  float mu = clamp(dot(normalize(vNormalW), normalize(cameraPosition - vWorld)), 0.0, 1.0);
  float rim = pow(1.0 - mu, 7.0);
  float n = 0.55 + 0.45 * snoise(vPos * 13.0 + vec3(uTime * 0.06, 0.0, 0.0));
  float a = rim * n * uOpacity * uFade * (0.55 + 0.65 * uIntensity);
  /* 加色混合：颜色预乘 alpha、alpha 输出 1，避免 three 的 SRC_ALPHA 二次衰减 */
  gl_FragColor = vec4(vec3(1.0, 0.30, 0.18) * a * 1.7, 1.0);
}`;
    const chromo = new THREE.Mesh(
      new THREE.SphereGeometry(1, isLow ? 48 : 96, isLow ? 32 : 64),
      new THREE.ShaderMaterial({
        uniforms: chromoUniforms,
        vertexShader: CHROMO_VS,
        fragmentShader: CHROMO_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide
      })
    );
    chromo.renderOrder = 2;
    starGroup.add(chromo);

    /* ---- 日冕：2 层球壳，按「冲击参数」积分出体积感（rimFade 消洋葱环） ---- */
    const coronaShells = [];
    const CORONA_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
    const CORONA_FS = 'precision highp float;\n' + GLSL_NOISE + GLSL_FBM + `
uniform float uTime;
uniform float uFade;
uniform float uSizeR;
uniform float uOpacity;
uniform float uSeed;
varying vec2 vUv;
void main() {
  /* plane 是面向相机的 2x2 单位方片，uv 极坐标 = 真实的「冲击参数」投影。
     球壳的几何轮廓会在投影上变成硬边圆盘，这是白盘/玻璃罩的根因；
     plane 的边界在 b=uSizeR 处、已衰减到 0，因此没有任何硬边。 */
  vec2 pp = vUv * 2.0 - 1.0;
  float r = length(pp);
  float b = r * uSizeR;

  /* 内边界：日面内直接丢弃，1.00-1.07 柔化，避免与日面轮廓产生硬缝 */
  float inner = smoothstep(1.0, 1.07, b);
  float edge = 1.0;
  if (inner <= 0.002) discard;

  float ang = atan(pp.y, pp.x);

  /* 半径剖面：核心 e 指数 + 长尾幂律，近边亮、远处淡 */
  float rb = max(b - 1.0, 0.0);
  float P = 1.18 * exp(-rb * 3.60) + 0.10 / (1.0 + rb * 3.40);

  /* 丝状结构：极坐标上的 3D 噪声（角度 + 半径 = 天然的长条），ridged 出丝 */
  float c = cos(ang), sn = sin(ang);
  /* 三层径向细丝：每层的相位被 3D 噪声扭曲，避免规则光芒 */
  float w1 = fbm(vec3(c, sn, b * 0.30) * 1.9 + vec3(uSeed, 0.0, uTime * 0.008), 2, 2.0, 0.5);
  float w2 = fbm(vec3(c, sn, b * 0.55) * 3.4 - vec3(0.0, uSeed * 1.3, uTime * 0.012), 2, 2.0, 0.5);
  float w3 = fbm(vec3(c, sn, b * 0.90) * 5.6 + vec3(uSeed * 0.7, 0.0, uTime * 0.018), 2, 2.0, 0.5);
  float s1 = sin(ang * 23.0 + w1 * 2.2);
  float s2 = sin(ang * 41.0 - w2 * 3.0);
  float s3 = sin(ang * 67.0 + w3 * 3.8);
  float fil = 0.14 + 0.52 * s1 * s1 + 0.22 * s2 * s2 + 0.12 * s3 * s3;
  fil *= 0.72 + 0.56 * w1;

  /* 赤道带略亮、上下略暗（冕洞） */
  float polar = 0.82 + 0.18 * cos(pp.y * 1.55);
  /* 低频瓣：让整体不是完美圆对称 */
  float lobe = 0.88 + 0.12 * sin(ang * 5.0 + uSeed * 2.1);

  float a = P * fil * polar * lobe * inner * edge * uOpacity * uFade;
  vec3 col = mix(vec3(1.0, 0.985, 0.955), vec3(0.80, 0.89, 1.0), smoothstep(1.08, 3.00, b));
  gl_FragColor = vec4(col * a * 10.0, 1.0);
}`;
    function makeCoronaPlane(sizeR, opacity, seed) {
      const uniforms = {
        uTime: { value: 0 },
        uFade: { value: 1 },
        uSizeR: { value: sizeR },
        uOpacity: { value: opacity },
        uSeed: { value: seed }
      };
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(sizeR * 2, sizeR * 2),
        new THREE.ShaderMaterial({
          uniforms: uniforms,
          vertexShader: CORONA_VS,
          fragmentShader: CORONA_FS,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        })
      );
      mesh.renderOrder = 3 + coronaShells.length;
      mesh.frustumCulled = false;
      (starGroup.parent || starGroup).add(mesh);
      coronaShells.push({ mesh: mesh, u: uniforms, base: opacity });
      return mesh;
    }

    /* 两层：1.30R 贴边冕流 + 2.60R 外延（几何少、无分层边界） */
    makeCoronaPlane(6.10, 0.46, 0.0);
    makeCoronaPlane(14.0, 0.22, 3.7);

    /* ---- 大光晕 + 亮核（两层物理光晕；颜色 = blackbody(uTempK) 归一化） ---- */
    /* JS 版黑体色，与 COSMOS.GLSL.blackbody 同公式，只在 update 里复用同一个 Color，不产生垃圾 */
    function bbColor(kelvin, out) {
      const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
      let r, g, b;
      if (t <= 66) {
        r = 1;
        g = 0.3900815787690196 * Math.log(t) - 0.6318414437886275;
        b = t <= 19 ? 0 : 0.5432067891101961 * Math.log(t - 10) - 1.19625408914;
      } else {
        r = 1.292936186062745 * Math.pow(t - 60, -0.1332047592);
        g = 1.1298908608952941 * Math.pow(t - 60, -0.0755148492);
        b = 1;
      }
      r = Math.pow(Math.min(Math.max(r, 0), 1), 2.2);
      g = Math.pow(Math.min(Math.max(g, 0), 1), 2.2);
      b = Math.pow(Math.min(Math.max(b, 0), 1), 2.2);
      const m = Math.max(r, g, b, 1e-4);
      out.setRGB(r / m, g / m, b / m);
      return out;
    }
    const bbTmp = new THREE.Color();
    bbColor(5772, bbTmp);

    const starGlowMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture(256),
      color: bbTmp.clone(),
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const starGlow = new THREE.Sprite(starGlowMat);
    starGlow.scale.set(4.6, 4.6, 1);
    starGlow.renderOrder = 8;
    starGroup.add(starGlow);

    const starCoreMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture(128),
      color: bbTmp.clone(),
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const starCore = new THREE.Sprite(starCoreMat);
    starCore.scale.set(2.4, 2.4, 1);
    starCore.renderOrder = 8;
    starGroup.add(starCore);

    /* ---- 日珥：相机朝向 ribbon（1 个 draw call，顶点着色器 billboard） ---- */
    const promUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uOpacity: { value: 0.8 }
    };
    const PROM_VS = `
uniform float uTime;
attribute vec3 aTangent;
attribute float aSide;
attribute float aU;
attribute float aWidth;
attribute float aSeed;
varying float vU;
varying float vSide;
varying float vSeed;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 wt = normalize((modelMatrix * vec4(aTangent, 0.0)).xyz);
  vec3 vd = normalize(cameraPosition - wp);
  vec3 sideV = cross(wt, vd);
  float sl = length(sideV);
  sideV = sl > 0.0001 ? sideV / sl : vec3(0.0, 1.0, 0.0);
  float w = aWidth * (1.0 + 0.22 * sin(uTime * 0.8 + aSeed * 6.283));
  wp += sideV * aSide * w;
  vU = aU;
  vSide = aSide;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
    const PROM_FS = 'precision highp float;\n' + GLSL_NOISE + `
uniform float uTime;
uniform float uFade;
uniform float uOpacity;
varying float vU;
varying float vSide;
varying float vSeed;
void main() {
  float taper = pow(max(sin(vU * 3.14159265), 0.0), 0.55);
  float acr = abs(vSide);
  float core = 1.0 - smoothstep(0.10, 1.0, acr);
  float fib = 0.60 + 0.40 * sin(vU * 30.0 + vSeed * 12.0 + uTime * 0.5);
  float a = taper * core * fib * uOpacity * uFade;
  vec3 col = mix(vec3(1.0, 0.20, 0.17), vec3(1.0, 0.56, 0.44), smoothstep(0.0, 1.0, acr) * 0.7 + 0.25 * taper);
  gl_FragColor = vec4(col * a * 9.0, 1.0);
}`;

    function buildProminences() {
      const arcs = isLow ? 3 : 5;
      const SEG = isLow ? 26 : 44;
      const vcount = arcs * (SEG + 1) * 2;
      const positions = new Float32Array(vcount * 3);
      const tangents = new Float32Array(vcount * 3);
      const sides = new Float32Array(vcount);
      const us = new Float32Array(vcount);
      const widths = new Float32Array(vcount);
      const seeds = new Float32Array(vcount);
      const indices = [];
      const tmpT = new THREE.Vector3();
      let vi = 0;
      for (let a = 0; a < arcs; a++) {
        const seed = Math.random();
        const isLong = a < 2;
        const h = isLong ? 0.55 + Math.random() * 0.35 : 0.22 + Math.random() * 0.16;
        const span = isLong ? 0.50 + Math.random() * 0.30 : 0.24 + Math.random() * 0.18;
        const az = Math.random() * Math.PI * 2;
        const lat = (Math.random() * 2 - 1) * 0.55 + 0.12;
        const cl = Math.cos(lat);
        const d0 = new THREE.Vector3(cl * Math.cos(az), Math.sin(lat), cl * Math.sin(az)).normalize();
        const tn = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).normalize();
        tn.addScaledVector(d0, -tn.dot(d0)).normalize();

        const pts = [];
        for (let i = 0; i <= SEG; i++) {
          const t = i / SEG;
          const ang = (t - 0.5) * span;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const dir = new THREE.Vector3(
            d0.x * ca + tn.x * sa,
            d0.y * ca + tn.y * sa,
            d0.z * ca + tn.z * sa
          ).normalize();
          const rise = 1.0 + h * Math.pow(Math.sin(Math.PI * t), 0.85);
          pts.push(new THREE.Vector3(dir.x * rise, dir.y * rise, dir.z * rise));
        }
        const base = vi;
        const width = (isLong ? 0.105 : 0.066) * (0.85 + 0.3 * seed);
        for (let i = 0; i <= SEG; i++) {
          const prev = pts[Math.max(0, i - 1)];
          const next = pts[Math.min(SEG, i + 1)];
          tmpT.subVectors(next, prev);
          if (tmpT.lengthSq() < 1e-9) tmpT.set(0, 1, 0);
          tmpT.normalize();
          for (let s = 0; s < 2; s++) {
            const bi = vi + i * 2 + s;
            positions[bi * 3] = pts[i].x;
            positions[bi * 3 + 1] = pts[i].y;
            positions[bi * 3 + 2] = pts[i].z;
            tangents[bi * 3] = tmpT.x;
            tangents[bi * 3 + 1] = tmpT.y;
            tangents[bi * 3 + 2] = tmpT.z;
            sides[bi] = s === 0 ? -1 : 1;
            us[bi] = i / SEG;
            widths[bi] = width;
            seeds[bi] = seed;
          }
        }
        vi += (SEG + 1) * 2;
        for (let i = 0; i < SEG; i++) {
          const o = base + i * 2;
          indices.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
      geo.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
      geo.setAttribute('aU', new THREE.BufferAttribute(us, 1));
      geo.setAttribute('aWidth', new THREE.BufferAttribute(widths, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      geo.setIndex(indices);
      const mat = new THREE.ShaderMaterial({
        uniforms: promUniforms,
        vertexShader: PROM_VS,
        fragmentShader: PROM_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      return mesh;
    }
    const prominences = buildProminences();
    starGroup.add(prominences);

    /* ---- 耀斑：3 处间歇性亮斑（周期 6–10s） ---- */
    const flares = [];
    const flareDirs = [
      new THREE.Vector3(0.72, 0.52, 0.44).normalize(),
      new THREE.Vector3(-0.62, 0.46, -0.62).normalize(),
      new THREE.Vector3(-0.18, -0.78, 0.60).normalize()
    ];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({
        map: TEX.glowTexture(128),
        color: new THREE.Color(3.0, 1.15, 0.62),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const spr = new THREE.Sprite(mat);
      spr.position.copy(flareDirs[i]).multiplyScalar(1.005);
      spr.scale.set(0.52, 0.52, 1);
      spr.renderOrder = 7;
      starGroup.add(spr);
      flares.push({ spr: spr, mat: mat, phase: i * 2.7, period: 6.0 + i * 1.7 });
    }

    /* ============================================================
     * 2. 诞生：吸积盘 + 原恒星包层
     * ============================================================ */
    const birthUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uBirth: { value: 1 }
    };
    const birthDisk = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 2.05, isLow ? 96 : 144, 1),
      new THREE.ShaderMaterial({
        uniforms: birthUniforms,
        vertexShader: `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: 'precision highp float;\n' + GLSL_NOISE + `
uniform float uTime;
uniform float uFade;
uniform float uBirth;
varying vec2 vLocal;
void main() {
  float r = length(vLocal);
  if (r < 0.72 || r > 2.05) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float phi = ang + uTime * (0.9 / pow(max(r, 0.8), 1.5));
  float n = snoise(vec3(cos(phi) * 2.2, r * 3.4, sin(phi) * 2.2)) * 0.5 + 0.5;
  float ring = smoothstep(0.72, 0.95, r) * (1.0 - smoothstep(1.55, 2.05, r));
  vec3 col = mix(vec3(0.55, 0.70, 1.0), vec3(1.0, 0.86, 0.62), pow(r - 0.7, 1.5));
  float a = ring * (0.35 + 0.65 * n) * uBirth * uFade;
  gl_FragColor = vec4(col * 1.35, clamp(a, 0.0, 1.0));
}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    birthDisk.rotation.x = -Math.PI / 2 + 0.78;
    birthDisk.rotation.z = 0.22;
    birthDisk.renderOrder = 3;
    starGroup.add(birthDisk);

    function buildCradle() {
      const count = isLow ? 700 : 1500;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        const r = 1.05 + Math.random() * 1.9;
        positions[i * 3] = s * Math.cos(phi) * r;
        positions[i * 3 + 1] = u * r * 0.55;
        positions[i * 3 + 2] = s * Math.sin(phi) * r;
        const warm = Math.random();
        colors[i * 3] = 0.58 + warm * 0.42;
        colors[i * 3 + 1] = 0.66 + warm * 0.18;
        colors[i * 3 + 2] = 0.88 + (1 - warm) * 0.12;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.10,
        map: TEX.glowTexture(64),
        vertexColors: true,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      }));
    }
    const cradle = buildCradle();
    cradle.renderOrder = 6;
    starGroup.add(cradle);

    /* ============================================================
     * 3. 老年：质量损失风 + 抛射壳层
     * ============================================================ */
    const windUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uOpacity: { value: 0.0 },
      uPixelRatio: { value: DPR }
    };
    function buildWind() {
      const count = isLow ? 1200 : 2400;
      const dirs = new Float32Array(count * 3);
      const seeds = new Float32Array(count);
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        dirs[i * 3] = s * Math.cos(phi);
        dirs[i * 3 + 1] = u * 0.78;
        dirs[i * 3 + 2] = s * Math.sin(phi);
        seeds[i] = Math.random();
        sizes[i] = 0.6 + Math.random() * 1.9;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: windUniforms,
        vertexShader: `
attribute vec3 aDir;
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uPixelRatio;
varying float vLife;
void main() {
  float t = fract(aSeed + uTime * 0.050);
  float r = 1.02 + t * 2.8;
  vec3 p = aDir * r;
  p.x += sin(t * 4.0 + aSeed * 12.0) * 0.10 * t;
  p.z += cos(t * 3.4 + aSeed * 9.0) * 0.10 * t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vLife = 1.0 - t;
  gl_PointSize = aSize * uPixelRatio * (82.0 / max(-mv.z, 0.1)) * (0.35 + 0.9 * vLife);
}`,
        fragmentShader: `precision highp float;
uniform float uFade;
uniform float uOpacity;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float m = 1.0 - smoothstep(0.08, 0.5, d);
  if (m < 0.01) discard;
  vec3 col = mix(vec3(0.85, 0.20, 0.07), vec3(1.0, 0.70, 0.42), vLife);
  gl_FragColor = vec4(col * 1.15, m * vLife * uOpacity * uFade);
}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 7;
      return pts;
    }
    const wind = buildWind();
    starGroup.add(wind);

    /* ---- 抛射壳：元素分层 + RT 指状 + 反向激波 ---- */
    const shellUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uShell: { value: 0.0 },
      uFlash: { value: 0.0 },
      uPne: { value: 0.0 }
    };
    const SHELL_VS = GLSL_NOISE + `
uniform float uTime;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(position);
  float d = snoise(dir * 3.1 + vec3(uTime * 0.01, 0.0, 0.0));
  vec3 pos = position * (1.0 + d * 0.06);
  vPos = dir;
  vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;
    const SHELL_FS = 'precision highp float;\n' + GLSL_STANDARD + `
uniform float uTime;
uniform float uFade;
uniform float uShell;
uniform float uFlash;
uniform float uPne;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 p = vPos;
  float t = uTime;

  /* ---- 丝状网络 + Rayleigh-Taylor 指状 ---- */
  float fil = fbm3(p * 8.2 + vec3(0.0, t * 0.02, 0.0));
  float fingers = ridged(p * 5.6 + vec3(t * 0.015, 0.0, 0.0), 4);
  float web = pow(clamp(1.0 - abs(fil * 2.0 - 1.0), 0.0, 1.0), 1.7);

  /* ---- 元素分层：O III 青绿 / Hα 红 / Fe 蓝 ---- */
  /* 元素分层用 max 混合，避免叠加去饱和成灰白 */
  float o3 = smoothstep(0.50, 0.68, fbm3(p * 2.2 + vec3(31.0)));
  float ha = smoothstep(0.46, 0.64, fbm3(p * 1.9 + vec3(57.0)));
  float fe = smoothstep(0.56, 0.74, fbm3(p * 2.6 + vec3(83.0)));
  /* 取主导元素定色，避免多元素叠加去饱和成灰白 */
  float wDom = max(max(o3, ha), fe);
  vec3 colSN = vec3(0.16, 0.95, 0.80);
  if (ha >= o3 && ha >= fe) colSN = vec3(1.00, 0.17, 0.20);
  else if (fe >= o3 && fe >= ha) colSN = vec3(0.34, 0.46, 1.00);
  colSN *= 1.30 + 0.95 * wDom;
  /* 丝状网络：只保留高密度脊线，形成膨胀的发光网而非实心球 */
  float net = smoothstep(0.47, 0.66, fil);
  float densSN = (net * 0.92 + web * 0.26) * (0.22 + 0.78 * fingers);

  /* ---- 行星状星云：赤道环 + 极向花瓣，内青绿外红 ---- */
  float az = atan(p.z, p.x);
  float eq = exp(-pow(p.y / 0.42, 2.0));
  float pole = smoothstep(0.55, 0.95, abs(p.y));
  float petal = 0.55 + 0.45 * sin(az * 7.0 + fbm3(p * 4.0) * 3.0);
  float densPN = (eq * 0.9 + pole * 0.45) * petal * (0.55 + 0.45 * fingers);
  vec3 colPN = mix(vec3(0.28, 0.90, 0.85), vec3(1.0, 0.34, 0.30), smoothstep(0.15, 0.85, abs(p.y)));

  float dens = mix(densSN, densPN, uPne);
  vec3 col = mix(colSN, colPN, uPne);

  /* ---- 体积感：正反两面都加、边缘路径更长 ---- */
  vec3 vd = normalize(cameraPosition - vWorld);
  float mu = abs(dot(normalize(vNormalW), vd));
  float thick = 0.45 + 0.55 * pow(1.0 - mu, 1.2);

  float a = dens * thick * uShell * uFade;
  col = mix(col, vec3(2.4, 2.2, 1.9), clamp(uFlash, 0.0, 1.0) * 0.7);
  gl_FragColor = vec4(col * a * 1.75, 1.0);
}`;
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, isLow ? 48 : 72, isLow ? 32 : 48),
      new THREE.ShaderMaterial({
        uniforms: shellUniforms,
        vertexShader: SHELL_VS,
        fragmentShader: SHELL_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    shell.scale.setScalar(0.1);
    shell.renderOrder = 3;
    root.add(shell);

    /* ---- 反向激波：壳内 0.46R 的细亮环 ---- */
    const revUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uOpacity: { value: 0.0 },
      uPne: { value: 0.0 }
    };
    const revShell = new THREE.Mesh(
      new THREE.SphereGeometry(1, isLow ? 32 : 48, isLow ? 24 : 32),
      new THREE.ShaderMaterial({
        uniforms: revUniforms,
        vertexShader: `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vPos = normalize(position);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: 'precision highp float;\n' + GLSL_NOISE + `
uniform float uTime;
uniform float uFade;
uniform float uOpacity;
uniform float uPne;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 vd = normalize(cameraPosition - vWorld);
  float mu = abs(dot(normalize(vNormalW), vd));
  float ring = pow(1.0 - mu, 5.0);
  float n = 0.55 + 0.45 * snoise(vPos * 6.0 + vec3(uTime * 0.03, 0.0, 0.0));
  float a = ring * n * uOpacity * uFade;
  vec3 col = mix(vec3(0.55, 0.95, 1.0), vec3(1.0, 0.55, 0.42), uPne * 0.7);
  gl_FragColor = vec4(col * a * 2.0, a);
}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    revShell.scale.setScalar(0.1);
    revShell.renderOrder = 4;
    root.add(revShell);

    /* ---- 冲击波环 ---- */
    const shockRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.2, 1.95, 1.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const shockRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1.0, 128), shockRingMat);
    shockRing.renderOrder = 9;
    root.add(shockRing);

    /* ---- 超新星闪光：核心 + 外晕 + 全屏白闪 ---- */
    const flashCoreMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture(256),
      color: new THREE.Color(4.0, 3.7, 3.2),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const flashCore = new THREE.Sprite(flashCoreMat);
    flashCore.renderOrder = 9;
    root.add(flashCore);
    const flashHaloMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture(256),
      color: new THREE.Color(2.2, 1.75, 1.25),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const flashHalo = new THREE.Sprite(flashHaloMat);
    flashHalo.renderOrder = 8;
    root.add(flashHalo);

    const flashQuadUniforms = { uFlash: { value: 0 } };
    const flashQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: flashQuadUniforms,
        vertexShader: `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `precision highp float;
uniform float uFlash;
void main() {
  float v = clamp(uFlash, 0.0, 1.0);
  gl_FragColor = vec4(vec3(3.0, 2.8, 2.4) * v * v, 1.0);
}`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    flashQuad.frustumCulled = false;
    flashQuad.renderOrder = 999;
    scene.add(flashQuad);

    /* ---- 抛射碎片：元素着色的点云 ---- */
    const debrisUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uBurst: { value: 0.0 },
      uPixelRatio: { value: DPR }
    };
    function buildDebris() {
      const count = isLow ? 700 : 1500;
      const dirs = new Float32Array(count * 3);
      const seeds = new Float32Array(count);
      const sizes = new Float32Array(count);
      const tints = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        dirs[i * 3] = s * Math.cos(phi);
        dirs[i * 3 + 1] = u;
        dirs[i * 3 + 2] = s * Math.sin(phi);
        seeds[i] = 0.35 + Math.random() * 0.65;
        sizes[i] = 0.35 + Math.random() * 0.85;
        tints[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: debrisUniforms,
        vertexShader: `
attribute vec3 aDir;
attribute float aSeed;
attribute float aSize;
attribute float aTint;
uniform float uTime;
uniform float uBurst;
uniform float uPixelRatio;
varying float vLife;
varying float vTint;
void main() {
  float t = clamp(uBurst * aSeed, 0.0, 1.0);
  float r = 0.25 + pow(t, 0.55) * 5.0;
  vec3 p = aDir * r;
  p.x += sin(t * 5.0 + aSeed * 20.0) * 0.12 * t;
  p.y += cos(t * 4.0 + aSeed * 13.0) * 0.12 * t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vLife = t;
  vTint = aTint;
  gl_PointSize = aSize * uPixelRatio * (28.0 / max(-mv.z, 0.1)) * (1.0 - 0.55 * t);
}`,
        fragmentShader: `precision highp float;
uniform float uFade;
uniform float uBurst;
varying float vLife;
varying float vTint;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float m = 1.0 - smoothstep(0.08, 0.5, d);
  if (m < 0.01) discard;
  vec3 cA = vec3(0.30, 0.72, 0.66);
  vec3 cB = vec3(0.80, 0.36, 0.28);
  vec3 cC = vec3(0.48, 0.54, 0.84);
  vec3 col = mix(mix(cA, cB, smoothstep(0.0, 0.55, vTint)), cC, smoothstep(0.62, 1.0, vTint));
  col = mix(vec3(2.2, 1.9, 1.5), col, smoothstep(0.0, 0.12, vLife));
  float a = m * (1.0 - 0.55 * vLife) * uBurst * uFade;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 7;
      return pts;
    }
    const debris = buildDebris();
    root.add(debris);

    /* ============================================================
     * 4. 红巨星尘埃包层（放在星体后方，只露外缘）
     * ============================================================ */
    const dustGroup = new THREE.Group();
    root.add(dustGroup);
    const dustSprites = [];
    const dustSpec = [
      { x: -0.6, y: 0.45, s: 3.3, o: 0.20 },
      { x: 0.55, y: -0.35, s: 2.9, o: 0.17 },
      { x: 0.1, y: 0.55, s: 3.7, o: 0.13 }
    ];
    for (let i = 0; i < dustSpec.length; i++) {
      const d = dustSpec[i];
      const mat = new THREE.SpriteMaterial({
        map: TEX.cloudTexture(256),
        color: new THREE.Color(0.46, 0.15, 0.07),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const spr = new THREE.Sprite(mat);
      spr.position.set(d.x, d.y, 0);
      spr.scale.set(d.s, d.s, 1);
      spr.renderOrder = 0;
      dustGroup.add(spr);
      dustSprites.push({ spr: spr, mat: mat, base: d.o, x: d.x, y: d.y });
    }

    /* ============================================================
     * 5. 三种结局：白矮星 / 中子星 / 黑洞（预建，按命运淡入）
     * ============================================================ */
    /* ---- 白矮星：结晶/刻面表面，12000–20000K ---- */
    const wdRem = new THREE.Group();
    root.add(wdRem);
    const wdRemUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uTempK: { value: 15500.0 }
    };
    const wdRemBody = new THREE.Mesh(
      new THREE.SphereGeometry(1, isLow ? 32 : 64, isLow ? 24 : 48),
      new THREE.ShaderMaterial({
        uniforms: wdRemUniforms,
        vertexShader: `
varying vec3 vNormalW;
varying vec3 vPos;
varying vec3 vWorld;
void main() {
  vPos = normalize(position);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: 'precision highp float;\n' + GLSL_STANDARD + `
uniform float uTime;
uniform float uFade;
uniform float uTempK;
varying vec3 vNormalW;
varying vec3 vPos;
varying vec3 vWorld;
void main() {
  vec3 vd = normalize(cameraPosition - vWorld);
  float mu = clamp(dot(normalize(vNormalW), vd), 0.0, 1.0);
  float f = ridged(vPos * 7.0, 3);
  float crack = smoothstep(0.62, 0.80, ridged(vPos * 11.0, 2));
  vec3 col = blackbody(uTempK * (0.94 + 0.10 * f));
  col *= (1.35 + 0.55 * f);
  col *= 1.0 - 0.35 * crack;
  col *= 0.55 + 0.55 * pow(mu, 0.5);
  col += vec3(0.60, 0.80, 1.0) * pow(1.0 - mu, 3.0) * 0.9;
  gl_FragColor = vec4(col, uFade);
}`,
        transparent: true
      })
    );
    wdRemBody.scale.setScalar(0.115);
    wdRemBody.renderOrder = 1;
    wdRem.add(wdRemBody);
    const wdGlowIn = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glowTexture(128),
      color: new THREE.Color(1.5, 1.9, 2.8),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    wdGlowIn.scale.setScalar(0.78);
    wdGlowIn.renderOrder = 5;
    wdRem.add(wdGlowIn);
    const wdGlowOut = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glowTexture(256),
      color: new THREE.Color(0.55, 0.75, 1.3),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    wdGlowOut.scale.setScalar(1.7);
    wdGlowOut.renderOrder = 4;
    wdRem.add(wdGlowOut);

    /* ---- 中子星：极亮小球 + 磁轴锥束 + 极冠 + 风眼环 ---- */
    const nsRem = new THREE.Group();
    root.add(nsRem);
    const nsAxis = new THREE.Group();
    nsAxis.rotation.z = 0.45;
    nsRem.add(nsAxis);

    const nsBodyUniforms = { uTime: { value: 0 }, uFade: { value: 1 }, uPulse: { value: 0.5 } };
    const nsRemBody = new THREE.Mesh(
      new THREE.SphereGeometry(1, isLow ? 24 : 40, isLow ? 18 : 28),
      new THREE.ShaderMaterial({
        uniforms: nsBodyUniforms,
        vertexShader: `
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: `precision highp float;
uniform float uFade;
uniform float uPulse;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 vd = normalize(cameraPosition - vWorld);
  float mu = clamp(dot(normalize(vNormalW), vd), 0.0, 1.0);
  vec3 col = vec3(2.6, 3.0, 3.6) * (0.55 + 0.45 * pow(mu, 0.6));
  col += vec3(2.2, 2.6, 3.2) * pow(1.0 - mu, 2.0) * 0.8;
  gl_FragColor = vec4(col * (0.85 + 0.3 * uPulse), uFade);
}`,
        transparent: true
      })
    );
    nsRemBody.scale.setScalar(0.10);
    nsRemBody.renderOrder = 1;
    nsAxis.add(nsRemBody);

    const nsBeamUniforms = { uTime: { value: 0 }, uFade: { value: 1 }, uPulse: { value: 0.5 } };
    const nsBeamMat = new THREE.ShaderMaterial({
      uniforms: nsBeamUniforms,
      vertexShader: `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `precision highp float;
uniform float uFade;
uniform float uPulse;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 vd = normalize(cameraPosition - vWorld);
  float face = clamp(abs(dot(normalize(vNormalW), vd)), 0.0, 1.0);
  float along = pow(clamp(vUv.y, 0.0, 1.0), 1.7);   /* 极冠处最亮，向远端衰减 */
  float a = along * pow(face, 1.1) * (0.20 + 0.80 * uPulse) * uFade;
  vec3 col = mix(vec3(0.55, 0.72, 1.0), vec3(0.95, 0.97, 1.0), vUv.y);
  gl_FragColor = vec4(col * a * 0.62, a);
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const nsBeamGeo = new THREE.ConeGeometry(0.055, 1.9, 20, 1, true);
    const nsBeamA = new THREE.Mesh(nsBeamGeo, nsBeamMat);
    nsBeamA.position.y = 0.0;
    nsBeamA.rotation.x = Math.PI;
    nsBeamA.renderOrder = 3;
    nsAxis.add(nsBeamA);
    const nsBeamB = new THREE.Mesh(nsBeamGeo, nsBeamMat);
    nsBeamB.position.y = 0.0;
    nsBeamB.renderOrder = 3;
    nsAxis.add(nsBeamB);

    const nsCapMatA = new THREE.SpriteMaterial({
      map: TEX.glowTexture(64),
      color: new THREE.Color(2.6, 3.0, 3.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const nsCapA = new THREE.Sprite(nsCapMatA);
    nsCapA.position.set(0, 0.10, 0);
    nsCapA.scale.setScalar(0.16);
    nsCapA.renderOrder = 5;
    nsAxis.add(nsCapA);
    const nsCapMatB = nsCapMatA.clone();
    const nsCapB = new THREE.Sprite(nsCapMatB);
    nsCapB.position.set(0, -0.10, 0);
    nsCapB.scale.setScalar(0.16);
    nsCapB.renderOrder = 5;
    nsAxis.add(nsCapB);

    const nsRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.25, 1.65, 2.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const nsRing = new THREE.Mesh(new THREE.RingGeometry(0.155, 0.175, 96), nsRingMat);
    nsRing.rotation.x = -Math.PI / 2 + 0.18;
    nsRing.renderOrder = 2;
    nsRem.add(nsRing);

    const nsGlowMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture(128),
      color: new THREE.Color(1.1, 1.5, 2.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const nsGlow = new THREE.Sprite(nsGlowMat);
    nsGlow.scale.setScalar(1.1);
    nsGlow.renderOrder = 4;
    nsRem.add(nsGlow);

    /* ---- 黑洞：视界 + 多普勒吸积盘 + 光子环 + 透镜上拱 ---- */
    const bhRem = new THREE.Group();
    root.add(bhRem);
    /* ===== 黑洞：单张 billboard plane + 屏幕空间 shader 一次画完
       事件视界 / 光子环 / 倾斜吸积盘 / 上下引力透镜双弧 / 多普勒不对称。
       旧的 RingGeometry 方案会露出环的实体厚度，像「甜甜圈」，全部停用。 ===== */
    const bhVoidUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uRs: { value: 0.265 },
      uIncl: { value: 0.075 },
      uRin: { value: 0.135 },
      uRout: { value: 0.860 },
      uLift: { value: 0.215 }
    };
    const BH_VOID_FS = 'precision highp float;\n' + GLSL_STANDARD + `
uniform float uTime;
uniform float uFade;
uniform float uRs;
uniform float uIncl;
uniform float uRin;
uniform float uRout;
uniform float uLift;
varying vec2 vUv;

float band(float d, out float heat) {
  heat = clamp((d - uRin) / max(uRout - uRin, 1e-4), 0.0, 1.0);
  float inner = smoothstep(uRin, uRin + 0.045, d);
  float outer = 1.0 - smoothstep(uRout - 0.30, uRout, d);
  return inner * outer;
}

float diskTex(float d, float ang) {
  float phi = ang + uTime * 1.6 / pow(max(d, 0.30), 1.5);
  float t1 = fbm3(vec3(cos(phi) * 2.6, d * 9.0, sin(phi) * 2.6));
  float t2 = fbm3(vec3(cos(phi) * 7.5, d * 32.0, sin(phi) * 7.5));
  float fibre = 0.55 + 0.45 * sin(d * 210.0 + t1 * 7.0 + uTime * 0.5) * 0.30;
  float streak = 0.62 + 0.38 * sin(d * 420.0 + t2 * 11.0);
  return 0.72 + 0.46 * t1 + 0.22 * (fibre - 0.55) + 0.13 * (streak - 0.62);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);

  float Ry = max(uIncl, 0.02);
  float dMain = length(vec2(p.x, p.y / Ry));

  float heatMain;
  float mainBand = band(dMain, heatMain);
  float occl = 1.0;
  mainBand *= occl;

  float dUp = length(vec2(p.x, (p.y - uLift) / Ry));
  float heatUp;
  float upBand = band(dUp, heatUp);
  upBand *= smoothstep(uRs * 0.55, uRs * 1.05, r) * step(0.0, p.y);

  float dDn = length(vec2(p.x, (p.y + uLift) / Ry));
  float heatDn;
  float dnBand = band(dDn, heatDn);
  dnBand *= smoothstep(uRs * 0.55, uRs * 1.05, r) * step(p.y, 0.0);

  float side = smoothstep(0.55, -0.60, p.x);
  float dopp = mix(0.42, 2.25, side);
  float dopp2 = mix(0.55, 2.60, side);

  float heat = max(max(heatMain, heatUp * 0.85), heatDn * 0.85);
  float temp = mix(16000.0, 3600.0, pow(heat, 0.55));
  vec3 col = blackbody(temp) * vec3(1.0, 0.955, 0.905);

  float tex = diskTex(max(dMain, 1e-3), ang);
  float diskLum = (mainBand * 1.00 + upBand * 0.34 + dnBand * 0.26) * tex;

  float ring = exp(-pow((r - uRs * 1.012) / 0.0028, 2.0));
  ring += exp(-pow((r - uRs * 1.012) / 0.014, 2.0)) * 0.07;

  float insideVoid = 1.0 - smoothstep(uRs * 0.985, uRs * 1.012, r);
  /* 阴影内部：远侧（p.y>0）被挡住，近侧（p.y<0）盘从前方穿过 */
  if (r < uRs * 0.985 && vUv.y > 0.5) { gl_FragColor = vec4(0.0); return; }


  vec3 outCol = col * diskLum * dopp * 1.70;
  outCol += vec3(1.0, 0.955, 0.88) * ring * dopp2 * 1.6;

  float haze = exp(-max(dMain - uRout, 0.0) * 8.0) * (1.0 - smoothstep(uRout, uRout + 0.30, dMain));
  haze *= (1.0 - insideVoid);
  outCol += vec3(0.55, 0.40, 0.34) * haze * 0.16;

  gl_FragColor = vec4(outCol * uFade, 1.0);
}`;
    const bhVoid = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: bhVoidUniforms,
        vertexShader: "varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: BH_VOID_FS,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    bhVoid.scale.setScalar(0.82);
    bhVoid.renderOrder = 6;
    bhVoid.frustumCulled = false;
    bhRem.add(bhVoid);

    const bhRemBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.20, 40, 28),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    bhRem.add(bhRemBody);

    const bhDiskUniforms = {
      uTime: { value: 0 },
      uFade: { value: 1 }
    };
    const BH_DISK_FS = 'precision highp float;\n' + GLSL_STANDARD + `
uniform float uTime;
uniform float uFade;
varying vec2 vLocal;
void main() {
  float r = length(vLocal);
  if (r < 0.206 || r > 0.985) discard;
  float ang = atan(vLocal.y, vLocal.x);

  /* 内热外冷：ISCO 处 20000K 蓝白 → 外缘 3000K 橙红 */
  float sA = smoothstep(0.206, 0.275, r);
  float sB = smoothstep(0.40, 0.985, r);
  float t = mix(19000.0, 4200.0, sA);
  t = mix(t, 2400.0, sB);
  vec3 col = blackbody(t) * vec3(1.0, 0.935, 0.835);

  /* 多普勒不对称：朝向观察者一侧炽白，背离一侧暗橙 */
  float dopp = 0.35 + 0.65 * cos(ang);
  col *= 0.34 + 2.05 * dopp;
  col = mix(col, vec3(1.35, 1.28, 1.16) * 3.4, smoothstep(0.82, 1.0, dopp) * 0.60);

  /* 细密湍流条纹（开普勒旋转，内快外慢） */
  float phi = ang + uTime * 2.4 / pow(max(r, 0.40), 1.5);
  float turb = fbm3(vec3(cos(phi) * 3.0, r * 26.0, sin(phi) * 3.0));
  float streak = 0.66 + 0.34 * sin(r * 240.0 + turb * 6.0);
  float fil = 0.62 + 0.38 * sin(r * 430.0 + turb * 9.0 + uTime * 0.7);
  col *= 0.76 + 0.44 * turb + 0.30 * (streak - 0.66) + 0.16 * (fil - 0.62);

  float edge = smoothstep(0.206, 0.250, r) * (1.0 - smoothstep(0.930, 0.985, r));
  float a = edge * uFade;
  gl_FragColor = vec4(col * a * 0.80, a);
}`;
    const bhRemDisk = new THREE.Mesh(
      new THREE.RingGeometry(0.206, 0.985, isLow ? 96 : 192, 12),
      new THREE.ShaderMaterial({
        uniforms: bhDiskUniforms,
        vertexShader: `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: BH_DISK_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    bhRemDisk.rotation.x = -Math.PI / 2 + 0.26;
    bhRemDisk.renderOrder = 2;
    bhRem.add(bhRemDisk);

    const bhRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4.6, 4.4, 4.0),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const bhPhoton = new THREE.Mesh(new THREE.RingGeometry(0.207, 0.222, 160), bhRingMat);
    bhPhoton.renderOrder = 4;
    bhRem.add(bhPhoton);

    const bhArcMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.6, 1.5, 1.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const bhArc = new THREE.Mesh(
      new THREE.RingGeometry(0.258, 0.272, 64, 1, Math.PI * 0.20, Math.PI * 0.60),
      bhArcMat
    );
    bhArc.position.z = 0.02;
    bhArc.renderOrder = 3;
    bhRem.add(bhArc);

    /* ---- 引力透镜像：吸积盘背面被弯折到黑洞上下，形成上下光环 ---- */
    const BH_LENS_VS = "varying vec2 vLocal;\nvoid main() {\n  vLocal = position.xy;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}";
    const BH_LENS_COMMON = 'precision highp float;\n' + GLSL_STANDARD + "\nuniform float uFade;\nvarying vec2 vLocal;\n";
    const BH_LENS_TOP_FS = BH_LENS_COMMON + [
      "void main() {",
      "  float r = length(vLocal);",
      "  float rr = (r - 0.238) / 0.084;",
      "  if (rr < 0.0 || rr > 1.0) discard;",
      "  float thick = pow(1.0 - abs(rr * 2.0 - 1.0), 0.58);",
      "  float ang = atan(vLocal.y, vLocal.x);",
      "  float t = mix(11000.0, 4200.0, clamp(abs(vLocal.x) / 0.34, 0.0, 1.0));",
      "  vec3 col = blackbody(t) * vec3(1.0, 0.945, 0.855);",
      "  float asym = 0.56 + 0.44 * cos(ang);",
      "  col *= 1.05 + 1.95 * asym;",
      "  float shimmer = 0.84 + 0.16 * sin(r * 560.0 + ang * 9.0);",
      "  gl_FragColor = vec4(col * thick * asym * shimmer * uFade * 1.30, 1.0);",
      "}"
    ].join("\n");
    const BH_LENS_BOT_FS = BH_LENS_COMMON + [
      "void main() {",
      "  float r = length(vLocal);",
      "  float rr = (r - 0.238) / 0.084;",
      "  if (rr < 0.0 || rr > 1.0) discard;",
      "  float thick = pow(1.0 - abs(rr * 2.0 - 1.0), 0.58);",
      "  float ang = atan(vLocal.y, vLocal.x);",
      "  float t = mix(4200.0, 1800.0, clamp(abs(vLocal.x) / 0.34, 0.0, 1.0));",
      "  vec3 col = blackbody(t) * vec3(1.0, 0.945, 0.855);",
      "  float asym = 0.50 + 0.50 * cos(ang);",
      "  col *= 1.05 + 1.95 * asym;",
      "  float shimmer = 0.84 + 0.16 * sin(r * 560.0 + ang * 9.0);",
      "  gl_FragColor = vec4(col * thick * asym * shimmer * uFade * 1.95, 1.0);",
      "}"
    ].join("\n");
    const bhLensTopMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 } },
      vertexShader: BH_LENS_VS,
      fragmentShader: BH_LENS_TOP_FS,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const bhLensBotMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 } },
      vertexShader: BH_LENS_VS,
      fragmentShader: BH_LENS_BOT_FS,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const bhLensTop = new THREE.Mesh(
      new THREE.RingGeometry(0.238, 0.322, isLow ? 72 : 132, 8, Math.PI * 0.10, Math.PI * 0.80),
      bhLensTopMat
    );
    bhLensTop.renderOrder = 5;
    bhRem.add(bhLensTop);
    const bhLensBot = new THREE.Mesh(
      new THREE.RingGeometry(0.238, 0.322, isLow ? 72 : 132, 8, Math.PI * 1.10, Math.PI * 0.80),
      bhLensBotMat
    );
    bhLensBot.renderOrder = 5;
    bhRem.add(bhLensBot);

    const bhGlowMat = new THREE.SpriteMaterial({
      map: TEX.glowTexture(256),
      color: new THREE.Color(1.35, 0.82, 0.42),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const bhGlow = new THREE.Sprite(bhGlowMat);
    bhGlow.scale.setScalar(1.7);
    bhGlow.renderOrder = 4;
    bhRem.add(bhGlow);
    /* 旧「甜甜圈」方案整体停用，仅保留黑球做遮挡 */
    bhRemDisk.visible = false;
    bhPhoton.visible = false;
    bhArc.visible = false;
    bhLensTop.visible = false;
    bhLensBot.visible = false;
    bhGlow.visible = false;

    /* ============================================================
     * 6. 相机 / 状态 / 每帧更新
     * ============================================================ */
    const STAGE_CAM = [
      { dist: 9.2, pitch: 0.15 },
      { dist: 7.2, pitch: 0.10 },
      { dist: 23.0, pitch: 0.16 },
      { dist: 16.0, pitch: 0.18 },
      { dist: 7.4, pitch: 0.16 }
    ];

    function camFor(stage, fate) {
      const si = CLAMP(Math.round(stage), 0, 4);
      let dist = STAGE_CAM[si].dist;
      let pitch = STAGE_CAM[si].pitch;
      if (si === 3) dist = fate === 'whitedwarf' ? 7.0 : 13.5;
      if (si === 4) {
        if (fate === 'blackhole') { dist = 3.5; pitch = 0.065; }
        else if (fate === 'neutronstar') { dist = 5.8; pitch = 0.14; }
        else { dist = 5.2; }
      }
      return { dist: dist, pitch: pitch };
    }
    const DEFAULT_YAW = 0.30;

    const _cam0 = camFor(1, 'whitedwarf');
    const view = {
      yaw: DEFAULT_YAW,
      pitch: _cam0.pitch,
      dist: _cam0.dist * FRAMING,
      tYaw: DEFAULT_YAW,
      tPitch: _cam0.pitch,
      tDist: _cam0.dist * FRAMING,
      hold: 0
    };

    let curMass = CLAMP(state.stellar.mass || 1, 0.08, 40);
    let curPhase = CLAMP(state.stellar.phase || 0, 0, 4);
    let prevStage = Math.round(curPhase);
    let prevFate = '';
    let time = 0;
    let flashEnergy = 0;
    let flashArmed = true;
    let entry = 1;
    let remPulse = 0.5;

    // 复用对象（update 内不 new）
    const _dir = new THREE.Vector3();
    const _camDir = new THREE.Vector3();
    const _starProj = new THREE.Vector3();
    const _q = new THREE.Quaternion();

    function updateCamera(dt, p) {
      const entryT = SSTEP(0.10, 0.86, p || 0);
      entry = LERP(1.16, 1.0, entryT);

      if (input.dragging && input.down && !input.uiTarget) {
        view.tYaw -= input.dx * 0.0048;
        view.tPitch = CLAMP(view.tPitch + input.dy * 0.0038, -0.82, 1.18);
        view.hold = 2.6;
      }
      if (view.hold > 0) view.hold -= dt;
      if (!reduceMotion && view.hold <= 0) view.tYaw += dt * 0.026;

      const wheel = input.wheelCtrl || 0;
      if (wheel) view.tDist = CLAMP(view.tDist + wheel * 0.012, 3.2, 40);
      if (input.pinch) view.tDist = CLAMP(view.tDist / Math.max(0.9, 1 + input.pinch * 0.5), 3.2, 40);
      const keys = input.keys || {};
      if (keys['+'] || keys['=']) view.tDist = CLAMP(view.tDist - dt * 7, 3.2, 40);
      if (keys['-'] || keys['_']) view.tDist = CLAMP(view.tDist + dt * 7, 3.2, 40);

      view.yaw = DAMP(view.yaw, view.tYaw, 7, dt);
      view.pitch = DAMP(view.pitch, view.tPitch, 7, dt);
      view.dist = DAMP(view.dist, view.tDist, 5, dt);

      const d = view.dist * FRAMING * entry;
      const cp = Math.cos(view.pitch);
      camera.position.set(
        d * cp * Math.sin(view.yaw),
        d * Math.sin(view.pitch),
        d * cp * Math.cos(view.yaw)
      );
      camera.lookAt(0, 0, 0);
    }

    function setStageCamera(stage, fate) {
      const cam = camFor(stage, fate);
      view.tPitch = CLAMP(cam.pitch, -0.82, 1.18);
      view.tDist = CLAMP(cam.dist * FRAMING, 3.2, 40);
    }

    function update(t, dt, p) {
      time = t;
      const s = state.stellar || {};
      curMass = DAMP(curMass, CLAMP(s.mass || 1, 0.08, 40), 3.2, dt);
      curPhase = DAMP(curPhase, CLAMP(s.phase || 0, 0, 4), 7.5, dt);

      const st = M.stellarState(curMass, curPhase);
      const fate = st.fate;

      // 超新星闪光：一次约 1 秒的亮度峰（st.flash 由模型按阶段给出）
      if (st.flash > 0.55 && flashArmed) {
        flashEnergy = 1.0;
        flashArmed = false;
      }
      if (st.flash < 0.20) flashArmed = true;
      if (flashEnergy > 0) flashEnergy = Math.max(0, flashEnergy - dt * 1.05);
      const flashNow = Math.max(st.flash * 0.30, flashEnergy);

      const visualR = CLAMP(1.15 * Math.pow(Math.max(st.radiusSun, 1e-6), 0.40), 0.10, 7.0);
      // 亮度：对数光度映射（主序太阳 ≈0.62，超新星接近 1.9）
      const intensity = CLAMP(0.95 + 0.16 * Math.log10(Math.max(st.lumSun, 1e-12)), 0.45, 2.1);
      const giant = CLAMP((st.radiusSun - 2.5) / 40.0, 0.0, 1.0);

      const starFade = 1.0 - SSTEP(0.30, 0.80, st.remnant);
      const isSN = fate !== 'whitedwarf';
      // 超新星爆发后星体收缩，让抛射壳露出来
      const explode = isSN ? SSTEP(2.58, 3.05, curPhase) : 0.0;
      const starScale = visualR * (1.0 - 0.955 * explode) + 0.085 * explode;

      /* ---- 主星：星面 / 色球 / 日冕 / 光晕 ---- */
      starGroup.visible = starFade > 0.01;
      starGroup.scale.setScalar(starScale);
      const _minDist = starScale * 3.6;
      if (view.tDist < _minDist) view.tDist = _minDist;
      if (view.dist < _minDist) view.dist = _minDist;
      starGroup.rotation.y += dt * (0.18 + 0.10 * intensity);

      const su = starUniforms;
      su.uTime.value = t;
      su.uFade.value = starFade;
      /* 星面增益：主序太阳 1.0 → 中心线性 1.42（ACES 线性段，米粒可见）；红巨星压到 0.4 */
      const starGain = CLAMP(1.0 + 0.22 * Math.log10(Math.max(st.lumSun, 1e-9)), 0.55, 1.6) *
        (1.0 - 0.55 * giant);
      su.uIntensity.value = starGain;
      su.uGiant.value = giant;
      su.uSpot.value = CLAMP(
        0.42 + 0.46 * CLAMP((curMass - 0.8) / 1.6, 0, 1) + 0.26 * CLAMP((curPhase - 1.3) / 0.8, 0, 1),
        0, 1
      );
      su.uFlash.value = flashNow;
      su.uTempK.value = st.tempK > 500 ? st.tempK : 6000;
      su.uGranScale.value = LERP(9.0, 2.2, giant);
      su.uEdgeRough.value = giant;
      su.uProto.value = 1.0 - SSTEP(0.50, 0.95, curPhase);

      chromo.scale.setScalar(1.004 + 0.006 * giant);
      chromoUniforms.uTime.value = t;
      chromoUniforms.uFade.value = starFade;
      chromoUniforms.uIntensity.value = intensity;
      chromoUniforms.uOpacity.value = 0.0;

      /* 恒星在 NDC（y 轴单位）里的屏幕半径：b 的归一化基准，
         与星面轮廓严格对齐（透视除法已由投影矩阵完成） */
      const camDist = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
      const tanHalf = Math.tan(camera.fov * 0.5 * Math.PI / 180);
      const starNdc = starScale / Math.max(camDist * tanHalf, 1e-4);
      /* 恒星中心的 NDC：日冕 discard 圆必须以它为心，否则会以屏幕中心为心、
         在恒星偏离画面中心时露出一块硬边黑盘。 */
      camera.updateMatrixWorld();
      _starProj.set(0, 0, 0).project(camera);

      for (let i = 0; i < coronaShells.length; i++) {
        const cs = coronaShells[i];
        cs.u.uTime.value = t;
        cs.u.uFade.value = starFade;
        cs.u.uOpacity.value = cs.base * (0.55 + 0.65 * intensity) * (1.0 - 0.25 * giant);
        cs.mesh.visible = starFade > 0.01;
        /* plane 挂在 root 下（无父级旋转），直接正对相机 */
        cs.mesh.lookAt(camera.position);
        cs.mesh.scale.setScalar(starScale);
      }

      starGlowMat.opacity = 0.13 * starFade * (0.70 + 0.55 * intensity) * (1.0 - 0.30 * giant);
      starGlow.scale.setScalar((2.6 * (1.0 - 0.78 * explode)) / Math.max(starScale, 0.5));
      starCoreMat.opacity = 0.0;
      starCore.scale.setScalar((1.5 * (1.0 - 0.70 * explode)) / Math.max(starScale, 0.5));
      /* 光晕颜色跟随黑体色温（红巨星 → 橙红，蓝白星 → 冷白） */
      bbColor(su.uTempK.value, bbTmp);
      starGlowMat.color.setRGB(2.6, 2.42, 2.20);
      starCoreMat.color.setRGB(5.2, 4.90, 4.55);

      promUniforms.uTime.value = t;
      promUniforms.uFade.value = starFade;
      promUniforms.uOpacity.value = 0.95 * (0.70 + 0.30 * Math.sin(t * 0.45));

      for (let i = 0; i < flares.length; i++) {
        const f = flares[i];
        const ph = (t / f.period + i * 0.37) % 1;
        const pulse = Math.pow(Math.max(0.0, Math.sin(ph * Math.PI)), 6.0);
        f.mat.opacity = 0.0;
        f.spr.scale.setScalar(0.30 + 0.55 * pulse);
      }

      /* ---- 诞生盘 / 包层 ---- */
      const birth = CLAMP(1.0 - curPhase / 0.72, 0.0, 1.0);
      birthUniforms.uTime.value = t;
      birthUniforms.uBirth.value = birth;
      birthUniforms.uFade.value = starFade;
      birthDisk.visible = birth > 0.01 && curPhase < 0.78;
      cradle.material.opacity = 0.48 * CLAMP(1.0 - curPhase / 0.62, 0.0, 1.0) * starFade;
      cradle.visible = cradle.material.opacity > 0.01;

      /* ---- 红巨星质量损失与尘埃包层 ---- */
      const windFade = CLAMP(SSTEP(1.65, 2.35, curPhase), 0.0, 1.0) * (1.0 - st.remnant);
      windUniforms.uTime.value = t;
      windUniforms.uOpacity.value = windFade * 0.95;
      wind.visible = windFade > 0.01;

      const dustFade = SSTEP(1.45, 2.15, curPhase) * (1.0 - SSTEP(2.30, 2.80, curPhase)) * starFade;
      dustGroup.visible = dustFade > 0.01;
      if (dustGroup.visible) {
        dustGroup.scale.setScalar(Math.min(starScale, 1.7));
        // 整体放在星体后方，只让外缘露出来（厚度感）
        _camDir.copy(camera.position).normalize();
        dustGroup.position.copy(_camDir).multiplyScalar(-Math.min(starScale, 1.7) * 0.55);
        for (let i = 0; i < dustSprites.length; i++) {
          const ds = dustSprites[i];
          ds.mat.opacity = ds.base * dustFade * (0.7 + 0.3 * Math.sin(t * 0.21 + i * 2.0));
          ds.mat.rotation = Math.sin(t * 0.05 + i) * 0.25;
        }
      }

      /* ---- 抛射壳层（行星状星云 / 超新星遗迹） ---- */
      const shellProgress = CLAMP((curPhase - 2.45) / 1.55, 0, 1);
      const shellGate = CLAMP(SSTEP(2.05, 2.55, curPhase), 0.0, 1.0);
      const shellAmt = CLAMP(
        shellGate * Math.max(0.86, st.envelope * 1.05 + flashNow * 0.55) +
        (fate === 'whitedwarf' ? 0.32 : 0.95 * (1.0 - SSTEP(3.55, 3.95, curPhase))) * st.remnant,
        0.0, 1.5
      );
      const shellScale = fate === 'whitedwarf'
        ? (1.55 + 1.30 * shellProgress + 0.45 * st.remnant)
        : (2.05 + 2.75 * shellProgress + 0.55 * st.remnant);

      shell.scale.setScalar(shellScale);
      shellUniforms.uTime.value = t;
      shellUniforms.uShell.value = shellAmt;
      shellUniforms.uFlash.value = flashNow;
      shellUniforms.uPne.value = fate === 'whitedwarf' ? 1.0 : 0.0;
      shellUniforms.uFade.value = 1.0 - 0.60 * SSTEP(3.45, 4.0, curPhase);
      shell.visible = shellAmt > 0.02;

      revUniforms.uTime.value = t;
      revUniforms.uOpacity.value = shellAmt * (0.55 + 0.45 * flashNow) * 0.30;
      revUniforms.uPne.value = fate === 'whitedwarf' ? 1.0 : 0.0;
      revShell.scale.setScalar(shellScale * 0.46);
      revShell.visible = shellAmt > 0.15;

      /* ---- 冲击波环 / 闪光 / 碎片 ---- */
      const ringScale = Math.max(0.01, visualR) * (1.0 + (1.0 - flashEnergy) * 7.0);
      shockRing.scale.setScalar(ringScale);
      shockRingMat.opacity = flashEnergy * 0.75;
      shockRing.visible = flashEnergy > 0.01;
      shockRing.quaternion.copy(camera.quaternion);

      // 闪光只跟瞬态能量，尺寸跟 starScale：phase 3 全程的 st.flash 不再撑出全屏白雾
      flashCoreMat.opacity = CLAMP(flashEnergy, 0, 1);
      flashCore.scale.setScalar(Math.max(0.01, starScale * 2.6 + 1.0));
      flashHaloMat.opacity = CLAMP(flashEnergy * 0.55, 0, 1);
      flashHalo.scale.setScalar(Math.max(0.01, starScale * 5.0 + 2.0));
      flashCore.visible = flashEnergy > 0.02;
      flashHalo.visible = flashEnergy > 0.02;
      flashQuadUniforms.uFlash.value = CLAMP(flashEnergy * 0.42, 0, 1);

      const burst = CLAMP((curPhase - 2.75) / 1.05, 0.0, 1.0);
      debrisUniforms.uTime.value = t;
      debrisUniforms.uBurst.value = burst * (st.remnant > 0.02 ? 1.0 : 0.75);
      debris.visible = burst > 0.02;
      debris.rotation.y += dt * 0.05;

      /* ---- 三种结局 ---- */
      const remFade = CLAMP(st.remnant, 0, 1);
      wdRem.visible = fate === 'whitedwarf' && curPhase > 3.45 && remFade > 0.05;
      nsRem.visible = fate === 'neutronstar' && curPhase > 3.45 && remFade > 0.05;
      bhRem.visible = fate === 'blackhole' && curPhase > 3.45 && remFade > 0.05;

      if (wdRem.visible) {
        wdRemUniforms.uTime.value = t;
        wdRemUniforms.uFade.value = remFade;
        _dir.set(0, 0, 1);
        wdRemBody.scale.setScalar(0.10 + 0.035 * remFade);
        wdGlowIn.material.opacity = 0.75 * remFade;
        wdGlowIn.scale.setScalar(0.62 + 0.28 * remFade);
        wdGlowOut.material.opacity = 0.30 * remFade;
        wdGlowOut.scale.setScalar(1.35 + 0.5 * remFade);
      }

      if (nsRem.visible) {
        nsRem.scale.setScalar(3.4);
        nsRem.rotation.y += dt * (Math.PI * 2) / 1.4;
        remPulse = DAMP(remPulse, 0.15 + 0.85 * Math.pow(Math.abs(Math.sin(nsRem.rotation.y)), 8), 20, dt);
        nsBodyUniforms.uTime.value = t;
        nsBodyUniforms.uFade.value = remFade;
        nsBodyUniforms.uPulse.value = remPulse;
        nsBeamUniforms.uTime.value = t;
        nsBeamUniforms.uFade.value = remFade;
        nsBeamUniforms.uPulse.value = remPulse;
        nsCapMatA.opacity = (0.45 + 0.55 * remPulse) * remFade;
        nsCapMatB.opacity = (0.45 + 0.55 * remPulse) * remFade;
        nsRingMat.opacity = (0.28 + 0.50 * remPulse) * remFade;
        nsGlowMat.opacity = (0.22 + 0.45 * remPulse) * remFade;
      }

      if (bhRem.visible) {
        bhVoidUniforms.uTime.value = t;
        bhVoidUniforms.uFade.value = remFade;
        bhVoid.quaternion.copy(camera.quaternion);
        bhDiskUniforms.uTime.value = t;
        bhDiskUniforms.uFade.value = remFade;
        bhRemDisk.rotation.z += dt * 0.55;
        bhRingMat.opacity = 1.0 * remFade;
        bhArcMat.opacity = 0.26 * remFade;
        bhGlowMat.opacity = 0.20 * remFade;
        bhPhoton.quaternion.copy(camera.quaternion);
        bhArc.quaternion.copy(camera.quaternion);
        bhLensTopMat.uniforms.uFade.value = remFade;
        bhLensBotMat.uniforms.uFade.value = remFade;
        bhLensTop.quaternion.copy(camera.quaternion);
        bhLensBot.quaternion.copy(camera.quaternion);
        bhRem.scale.setScalar(2.35 * (0.60 + 0.40 * remFade));
      }

      /* ---- 相机：按阶段自动构图，拖拽可覆盖 ---- */
      const stageNow = Math.round(curPhase);
      if (stageNow !== prevStage || fate !== prevFate) {
        setStageCamera(stageNow, fate);
        prevStage = stageNow;
        prevFate = fate;
      }
      updateCamera(dt, p);

      /* ---- 背景 ---- */
      if (starfield.material && starfield.material.uniforms) {
        starfield.material.uniforms.uTime.value = t;
        starfield.material.uniforms.uPixelRatio.value = DPR;
      }
      const drift = 0.5 + 0.5 * Math.sin(t * 0.07);
      backdropMats[0].opacity = 0.10 + 0.04 * drift;
      backdropMats[1].opacity = 0.08 + 0.03 * (1.0 - drift);
    }

    function resize(w, h) {
      vw = w || vw;
      vh = h || vh;
      const aspect = vw / Math.max(1, vh);
      camera.aspect = aspect;
      U.fitCamera(camera, BASE_FOV, aspect);
      applyViewShift();
      windUniforms.uPixelRatio.value = DPR;
      debrisUniforms.uPixelRatio.value = DPR;
    }

    function reset() {
      const cam = camFor(Math.round(curPhase), M.fateOf(curMass));
      view.tYaw = DEFAULT_YAW;
      view.tPitch = cam.pitch;
      view.tDist = cam.dist * FRAMING;
      view.yaw = DEFAULT_YAW;
      view.pitch = cam.pitch;
      view.dist = cam.dist * FRAMING;
      view.hold = 0;
    }

    function enter() {
      prevStage = Math.round(curPhase);
      prevFate = M.fateOf(curMass);
      const cam = camFor(prevStage, prevFate);
      view.yaw = DEFAULT_YAW;
      view.pitch = cam.pitch;
      view.dist = cam.dist * FRAMING;
      view.tYaw = DEFAULT_YAW;
      view.tPitch = cam.pitch;
      view.tDist = cam.dist * FRAMING;
      view.hold = 0;
      flashEnergy = 0;
      flashArmed = true;
    }

    function leave() {}

    function dispose() {
      U.disposeGroup(scene);
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
      bloom: true
    };
  });
})(window.COSMOS);
