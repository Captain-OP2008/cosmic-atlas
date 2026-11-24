/* ============================================================
 * COSMOS ATLAS · 终章「暗淡蓝点」(stage: paleblue)
 * ------------------------------------------------------------
 * 1990-02-14，旅行者 1 号在 60 亿公里外回头按下的那一帧。
 * 本章不做操纵，只让地球自己转 —— 交互级别 L1（AGENTS §3.2）。
 *
 * 视觉结构（由远及近）：
 *   0. 星野        球壳 260~900，几乎不动，uTime 只驱动极缓呼吸
 *   1. 地球本体    日面 albedo × 斜射日光 + 海面镜面 + 云影低频压暗
 *   2. 夜面灯光    城市灯光贴图，只在晨昏线外侧点亮，色温 2700–3500 K
 *   3. 云层        半径 1.004 的独立壳，比地表快 5.5%；暗侧半透明，让灯光透出
 *   4. 大气壳      半径 1.055，BackSide + 加法，瑞利散射蓝 + 晨昏线暖橙
 *
 * 构图：地球直径 ≈ 0.86 视口高（竖屏时按视口宽度自动收，不裁切），圆心在画面高度 0.52（略偏下）。
 * 文字块压在画面中部，所以地球是「背景」而不是主体：
 * 中心的文字对比度由 css/main.css 的 .ch-finale .ch-bg 径向遮罩保证，
 * 地球只在四周（上下弧线、左右轮廓、大气光）被真正看见。
 *
 * 约定：颜色写线性空间，> 1.0 交给统一泛光（js/boot.js 的 POST）；
 *       ACES 与 sRGB 由 js/postfx.js 统一处理，这里不做色调映射。
 *       贴图来自 COSMOS.tex 共享缓存，dispose 时不得释放。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  const U = COSMOS.util;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ============================================================
   * TUNE —— 调参集中区（改这里就能整体调，不动着色器）
   * ============================================================ */
  const TUNE = {
    /* 构图 */
    fov: 45,
    earthFrac: 0.86,        // 地球直径 / 视口高度
    maxWidthFrac: 0.95,     // 地球直径 / 视口宽度上限（竖屏时防左右裁切）
    centerY: 0.52,          // 地球圆心在画面中的高度（0 = 顶，1 = 底）
    pushIn: 0.055,          // p 驱动推近的幅度

    /* 时间：100 秒/圈 —— 慢到像呼吸，不像转盘 */
    spinPeriod: 100,
    cloudSpinRatio: 1.055,

    /* 姿态：地轴倾角 23.44°；初相位让镜头正对 60°E（阿拉伯海—印度），
     * 于是夜面落在画面右侧的东亚—东南亚，城市灯光最密的一片正好可见。 */
    tilt: 0.409,
    rot0: -2.618,

    /* 光照：世界空间「地球 → 太阳」方向（从左侧偏上斜照）。
     * 左缘是日面、中央接近晨昏线、右下进入夜面 —— 城市灯光从右下露出来，
     * 而文字区（画面中部）正好落在最暗的过渡带上。 */
    sunDir: [-0.80, 0.32, 0.28],

    /* 亮度（线性空间）。云的上限压到 0.46：线性 0.46 在 sRGB 下仍是白云，
     * 但不会把压在字幕区的文字对比度冲到 4.5:1 以下。 */
    dayGain: 0.95,
    nightGain: 2.20,
    cloudShadow: 0.42,
    spec: 0.70,
    atmoStrength: 0.90,

    /* 星野数量（按 quality 分档，预算远低于 25 万粒子） */
    starCount: { low: 1500, medium: 2300, high: 3200 }
  };

  const SUN = new THREE.Vector3(TUNE.sunDir[0], TUNE.sunDir[1], TUNE.sunDir[2]).normalize();

  /* ============================================================
   * GLSL（ES 1.00：attribute 由 three 注入，只声明 varying）
   * ============================================================ */
  const VS_SURFACE = [
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vUv = uv;',
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  /* 地球：日面 + 夜面 + 海面高光 + 云影 */
  const FS_EARTH = [
    'uniform sampler2D uDay;',
    'uniform sampler2D uNight;',
    'uniform sampler2D uCloud;',
    'uniform vec3 uSunDir;',
    'uniform float uCloudShift;',
    'uniform float uDayGain;',
    'uniform float uNightGain;',
    'uniform float uCloudShadow;',
    'uniform float uSpec;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vec3 albedo = texture2D(uDay, vUv).rgb;',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 L = normalize(uSunDir);',
    '  vec3 V = normalize(cameraPosition - vWorldPos);',
    '  float nl = dot(N, L);',
    /* 真机上的晨昏线被大气散射抹开约几度，所以用宽 smoothstep 而不是二值切换 */
    '  float day = smoothstep(-0.14, 0.20, nl);',
    '  float diff = pow(max(nl, 0.0), 0.92);',
    /* 云影：云层是独立壳，这里只取它的密度做低频压暗（幅度很轻） */
    '  float cl = dot(texture2D(uCloud, vec2(fract(vUv.x + uCloudShift), vUv.y)).rgb,',
    '                 vec3(0.299, 0.587, 0.114));',
    '  diff *= 1.0 - uCloudShadow * smoothstep(0.16, 0.58, cl);',
    '  vec3 color = albedo * diff * uDayGain * vec3(1.04, 1.00, 0.96);',
    /* 海面镜面：只给水体，且只在受光半球（真实海面高光） */
    '  vec3 Hv = normalize(L + V);',
    '  float water = smoothstep(0.04, 0.16, albedo.b - albedo.r);',
    '  float spec = pow(max(dot(N, Hv), 0.0), 72.0) * water * uSpec;',
    '  color += vec3(1.00, 0.95, 0.85) * spec * day;',
    /* 夜面城市灯光：贴图是 sRGB 亮度图，srgb→linear 会把城市光晕压到近零，
       先还原感知亮度，再用阈值只留城市光斑（否则整片海洋会发灰） */
    '  vec3 nightCol = texture2D(uNight, vUv).rgb;',
    '  nightCol = pow(max(nightCol, vec3(0.0)), vec3(0.45));',
    '  float nightLum = dot(nightCol, vec3(0.299, 0.587, 0.114));',
    '  float nightLit = smoothstep(0.06, 0.22, nightLum);',
    '  float nightMask = 1.0 - smoothstep(-0.22, 0.06, nl);',
    '  color += vec3(1.00, 0.74, 0.44) * nightCol * nightLit * nightMask * uNightGain;',
    /* 夜面气辉：极弱，只把纯黑抬起一点点，免得球体下半部死黑消失 */
    '  color += vec3(0.010, 0.020, 0.032) * (1.0 - day);',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  /* 云层：日面受光偏白，暗侧压暗且半透明，让城市灯光透出 */
  const FS_CLOUD = [
    'uniform sampler2D uMap;',
    'uniform vec3 uSunDir;',
    'uniform float uOpacity;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  float m = dot(texture2D(uMap, vUv).rgb, vec3(0.299, 0.587, 0.114));',
    '  float dens = smoothstep(0.08, 0.52, m);',
    '  if (dens < 0.004) discard;',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 L = normalize(uSunDir);',
    '  float lit = smoothstep(-0.24, 0.34, dot(N, L));',
    '  vec3 col = mix(vec3(0.05, 0.06, 0.09), vec3(0.46, 0.47, 0.50), lit);',
    '  gl_FragColor = vec4(col, dens * uOpacity * (0.30 + 0.70 * lit));',
    '}'
  ].join('\n');

  /* 大气壳：菲涅尔一圈轮廓，亮侧冰蓝、晨昏线暖橙 */
  const FS_ATMO = [
    'uniform vec3 uSunDir;',
    'uniform float uStrength;',
    'varying vec2 vUv;',
    'varying vec3 vNormalW;',
    'varying vec3 vWorldPos;',
    'void main() {',
    '  vec3 N = normalize(vNormalW);',
    '  vec3 V = normalize(cameraPosition - vWorldPos);',
    '  vec3 L = normalize(uSunDir);',
    '  float fres = pow(1.0 - abs(dot(N, V)), 3.0);',
    '  float lit = smoothstep(-0.42, 0.35, dot(N, L));',
    '  float fwd = pow(max(dot(V, -L), 0.0), 4.0);',
    /* 瑞利散射：短波段强 → 冰蓝；晨昏线光程长、短波被吸收 → 暖橙 */
    '  vec3 blue = vec3(0.26, 0.52, 1.00);',
    '  vec3 warm = vec3(1.00, 0.44, 0.16);',
    '  float term = 1.0 - smoothstep(0.0, 0.30, abs(dot(N, L)));',
    '  vec3 col = mix(blue, warm, term * 0.55);',
    '  float a = fres * (0.26 + 0.80 * lit) + fwd * 0.10 * lit;',
    '  gl_FragColor = vec4(col * (0.55 + 0.75 * fwd), clamp(a, 0.0, 1.0) * uStrength);',
    '}'
  ].join('\n');

  /* ============================================================
   * stage
   * ============================================================ */
  function finaleStage(ctx) {
    const scene = new THREE.Scene();
    const camera = U.makeCamera(TUNE.fov, ctx.aspect);

    /* ---- 0. 星野（独立材质实例：共享星野的 uTime 没有调用点） ---- */
    const starCount = TUNE.starCount[ctx.quality] || TUNE.starCount.high;
    const stars = COSMOS.builders.makeStarfield({ count: starCount, rMin: 260, rMax: 900 });
    stars.material.uniforms.uPixelRatio.value = ctx.pixelRatio;
    stars.material.uniforms.uOpacity.value = 0.92;
    scene.add(stars);

    /* ---- 贴图（共享缓存，dispose 时不得释放） ---- */
    const dayMap = COSMOS.tex.load('earth_day');
    const nightMap = COSMOS.tex.load('earth_night');
    const cloudMap = COSMOS.tex.load('earth_clouds');

    /* ---- 地球组：地轴固定倾斜 23.44°，自转绕组内 y 轴 ---- */
    const earthGroup = new THREE.Group();
    earthGroup.rotation.z = TUNE.tilt;
    earthGroup.position.y = (0.5 - TUNE.centerY) * 2 / TUNE.earthFrac;
    scene.add(earthGroup);

    const seg = ctx.quality === 'low' ? 64 : (ctx.quality === 'medium' ? 96 : 128);
    const segV = seg >> 1;

    /* ---- 1. 地球本体 ---- */
    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: dayMap },
        uNight: { value: nightMap },
        uCloud: { value: cloudMap },
        uSunDir: { value: SUN },
        uCloudShift: { value: 0 },
        uDayGain: { value: TUNE.dayGain },
        uNightGain: { value: TUNE.nightGain },
        uCloudShadow: { value: TUNE.cloudShadow },
        uSpec: { value: TUNE.spec }
      },
      vertexShader: VS_SURFACE,
      fragmentShader: FS_EARTH
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, seg, segV), earthMat);
    earthGroup.add(earth);

    /* ---- 2. 云层 ---- */
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: cloudMap },
        uSunDir: { value: SUN },
        uOpacity: { value: 1.0 }
      },
      vertexShader: VS_SURFACE,
      fragmentShader: FS_CLOUD,
      transparent: true,
      depthWrite: false
    });
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.004, seg, segV), cloudMat);
    clouds.renderOrder = 1;
    earthGroup.add(clouds);

    /* ---- 3. 大气壳（BackSide + 加法，只留一圈轮廓） ---- */
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: SUN },
        uStrength: { value: TUNE.atmoStrength }
      },
      vertexShader: VS_SURFACE,
      fragmentShader: FS_ATMO,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const atmoSeg = Math.max(48, seg >> 1);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.055, atmoSeg, Math.max(24, segV >> 1)), atmoMat);
    atmo.renderOrder = 2;
    earthGroup.add(atmo);

    /* ---- 时间基准：每次进入本章都从「非洲朝向镜头」重新开始转 ---- */
    let t0 = -1;

    function update(t, dt, p) {
      if (t0 < 0) t0 = t;
      const reduce = ctx.reduceMotion;
      const tt = reduce ? 0 : t - t0;
      const q = p === undefined ? 0 : U.clamp(p, 0, 1);
      const e = U.ease.inOutCubic(q);

      /* 自转：地表 100s/圈，云略快（云相对地表缓慢漂移） */
      const spin = TAU / TUNE.spinPeriod;
      const rot = TUNE.rot0 + tt * spin;
      const cloudRot = TUNE.rot0 + tt * spin * TUNE.cloudSpinRatio;
      earth.rotation.y = rot;
      clouds.rotation.y = cloudRot;

      /* 云影：把云图沿经度搬回地表坐标系（每帧只写一个 uniform） */
      const shift = (rot - cloudRot) / TAU;
      earthMat.uniforms.uCloudShift.value = shift - Math.floor(shift);

      /* 星野呼吸（只动本场景自己的材质实例，不碰共享缓存） */
      stars.material.uniforms.uTime.value = reduce ? 0 : t;

      /* 相机：p 极缓推近，叠加两个不同周期的微小漂移（不是视差，是呼吸）。
       * 距离由「球在屏上的角半径」反解：tan(fov/2) * d 是半屏高二分之一处
       * 的世界高度，球轮廓的角半径为 asin(r/d) —— 用 asin 而不是小角近似，
       * 否则 earthFrac 接近 1 时球会顶出画面。 */
      const tanHalf = Math.tan(camera.fov * DEG * 0.5);
      /* 竖屏（aspect<1）时若只按屏高定直径，球会左右溢出被裁；取「屏高占比」与
       * 「屏宽占比」中更保守的一个 —— 横屏仍是 0.86 屏高，竖屏自动收到不裁切。 */
      const frac = Math.min(TUNE.earthFrac, TUNE.maxWidthFrac * camera.aspect);
      const dBase = 1 / Math.sin(Math.atan(tanHalf * frac));
      camera.position.z = dBase * (1 - TUNE.pushIn * e);
      /* 球心在画面高度 centerY 处（NDC y = 1 - 2*centerY） */
      earthGroup.position.y = (0.5 - TUNE.centerY) * 2 * tanHalf * dBase;
      if (reduce) {
        camera.position.x = 0;
        camera.position.y = 0;
      } else {
        camera.position.x = Math.sin(t * 0.041) * 0.042 + Math.sin(t * 0.0163) * 0.018;
        camera.position.y = Math.cos(t * 0.033) * 0.030;
      }
      camera.updateMatrixWorld();
    }

    function resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      stars.material.uniforms.uPixelRatio.value = ctx.renderer.getPixelRatio();
    }

    function enter() {
      /* 离开再回来恢复默认姿态（AGENTS §3.3「状态」二选一，本章取恢复默认） */
      t0 = -1;
    }

    function dispose() {
      /* 只释放本场景自建的 geometry / material；贴图属于 COSMOS.tex 共享缓存 */
      earthGroup.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      stars.geometry.dispose();
      stars.material.dispose();
      scene.clear();
    }

    return {
      scene: scene,
      camera: camera,
      update: update,
      resize: resize,
      enter: enter,
      dispose: dispose
    };
  }

  COSMOS.registerStage('paleblue', finaleStage);
})(window.COSMOS);
